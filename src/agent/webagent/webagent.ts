/**
 * WebAgent — DOM-grounded narrator agent.
 *
 * Shape:
 *   - `runStream(task)` / `continueStream(task)` / `resumeStream()` are
 *     **async generators** yielding `AgentEvent`s. The orchestrator pumps
 *     the stream with a single `for await` and routes each event to its
 *     UI slot.
 *   - Session is an append-only `turns[]` log persisted to sessionStorage.
 *     Same-tab SPA nav: the running generator survives. Full reload:
 *     orchestrator calls `resumeStream()` from onMount; the loop picks up
 *     where the saved session left off.
 *   - LLM is streamed end-to-end. Text deltas yield `text-delta`; a
 *     completed tool call yields `tool-start`, dispatches the handler,
 *     yields `tool-end`. No `done` tool, no `show_subtitle` — the loop
 *     ends when the model emits a turn with no tool call.
 *
 * Override layers — most → least common host need:
 *   1. `brand` — productName / voice / constraints[]
 *   2. `appendSystemPrompt` — appended to default
 *   3. `systemPrompt` as function — receives default + ctx
 *   4. `systemPrompt` as string — hard replace
 */

import type {
  WebAgentConfig,
  AgentSession,
  AgentTurn,
  AgentEvent,
  ActionDefinition,
  ActionResult,
  RunOptions,
  SelectionContext,
  AgentStatus,
} from './types';
import type { CompleteResult, LLMMessage, ToolDefinition, ToolCall } from '../llm/types';
import type { StreamingProvider, StreamChunk } from '../llm/stream';
import { resolveLLM } from '../llm/router';
import {
  createSession,
  loadSession,
  saveSession,
  clearSession,
  pushUserTurn,
  pushAgentStep,
  pushAgentFinal,
  lastUserTurn,
  isSessionLive,
  shouldAutoResume,
  DEFAULT_SESSION_KEY,
} from './session';
import {
  assembleSystemPrompt,
  renderSitemap,
  renderSelectionBlock,
  renderPageStateBlock,
  renderUserReminder,
} from './prompt';
import { builtinActions, presentSurface } from './actions';
import { readDOM } from './dom-reader';
import { captureScreenshots, type ScreenshotConfig } from './screenshot';
import { setupCrossTabSync, publishCrossTab } from './cross-tab';
import { executeAction } from './execute-action';
import { DEFAULT_DESTRUCTIVE_PATTERNS, isDestructiveByPattern } from './destructive';
import { sdkString } from '../../utils/sdk-i18n';
import {
  AGENT_TURN_TOOL,
  buildAgentTurnTool,
  parseTurnResponse,
  renderToolReference,
  isNarrateAction,
  isToolAction,
  isTaskFinishAction,
  type CotToolRef,
} from './cot';

const DEFAULT_MAX_STEPS = 30;
const DEFAULT_MAX_ERRORS = 3;
const DEFAULT_LLM_TIMEOUT_MS = 60_000;
const DEFAULT_CONTINUITY_MS = 5 * 60 * 1000;

/**
 * Per-LLM-call performance sample emitted to the orchestrator after each
 * streaming call. The orchestrator decorates with `runId` and forwards as
 * an `agent_llm_call` IntentEvent for the analytics dashboard.
 */
export interface LlmCallInfo {
  role: 'webagent' | 'webagentWithSelection';
  /** Time-to-first-token in ms (request issued → first non-empty delta). */
  ttftMs: number;
  /** Total stream wall-time in ms (request issued → final chunk). */
  durationMs: number;
  /** Provider-reported output tokens (if available). */
  outputTokens?: number;
  /** Provider-reported input tokens (if available). */
  inputTokens?: number;
  /** Resolved model id, when the provider exposes it. */
  model?: string;
}

export class WebAgent {
  private config: WebAgentConfig & Required<Pick<
    WebAgentConfig,
    'locale' | 'maxSteps' | 'maxErrors' | 'llmTimeoutMs' | 'agentName' |
    'sessionStorageKey' | 'sessionContinuityMs' | 'sessionScope'
  >>;
  private actions: Map<string, ActionDefinition> = new Map();
  private session: AgentSession | null = null;
  private currentAbort: AbortController | null = null;
  private pendingResolvers: Map<string, (raw: string) => void> = new Map();
  private pendingOrder: string[] = [];
  private currentSelection: SelectionContext | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private crossTabKey: string;
  private pendingCounter = 0;
  private destructivePatterns: RegExp[];
  /** Callback the orchestrator wires to actually navigate the host SPA.
   *  Hosts may return a Promise (most SPA routers do). When they do,
   *  the webagent awaits it before the DOM-settle window — so the next
   *  `readDOM()` sees the new page, not the old one half-replaced. */
  private navigateBridge: ((path: string) => void | Promise<void>) | null = null;
  /** Fires once per LLM streaming call so the orchestrator can emit
   *  an `agent_llm_call` IntentEvent with TTFT / tokens-per-sec. */
  private llmCallListener: ((info: LlmCallInfo) => void) | null = null;
  /** Host signalled "end continuity now" — next runStream() starts fresh. */
  private continuityEnded = false;

  constructor(config: WebAgentConfig) {
    this.config = {
      // Locale auto-detect from navigator.language is fine to PROVIDE as
      // a default. The system prompt framing (see prompt.ts language
      // section) makes clear the user's actual input language overrides
      // this hint on every turn — so the locale is "starting guess",
      // not a hard signal that biases the model.
      // Spread INPUT FIRST so the defaults below win for any property
      // the host left undefined. Previously the spread came LAST and
      // would overwrite the defaults with `undefined` when the host
      // passed a partial config — this is why navigate confirm dialogs
      // were rendering in English even when the host was clearly on
      // a Chinese page (the locale default was being clobbered by the
      // host's missing `locale` field).
      ...config,
      locale:
        config.locale ??
        ((typeof navigator !== 'undefined' && navigator.language?.startsWith('zh')
          ? 'zh-TW'
          : 'en')),
      maxSteps: config.maxSteps ?? DEFAULT_MAX_STEPS,
      maxErrors: config.maxErrors ?? DEFAULT_MAX_ERRORS,
      llmTimeoutMs: config.llmTimeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
      agentName: config.agentName ?? 'Agent',
      sessionStorageKey: config.sessionStorageKey ?? DEFAULT_SESSION_KEY,
      sessionContinuityMs: config.sessionContinuityMs ?? DEFAULT_CONTINUITY_MS,
      sessionScope: config.sessionScope ?? 'time',
    };

    // Filter builtins by host's `disableBuiltinActions` list. Use a Set
    // for O(1) lookup; missing entry = include the action. Hosts that
    // know their site doesn't need (say) select_option / ask_user / pause
    // pass those names here and the agent never sees them — fewer tools
    // in the schema = less attention pressure on small models.
    const disabled = new Set(config.disableBuiltinActions ?? []);
    for (const action of builtinActions) {
      if (!disabled.has(action.name)) this.actions.set(action.name, action);
    }
    // Opt-in: surface presentation. Only registered when the host enables
    // it AND will wire `setSurfaceMounter` — otherwise the action exists
    // in the registry but execute-action's intercept fails-fast. Still
    // respects disableBuiltinActions for symmetry.
    if (config.allowPresent && !disabled.has(presentSurface.name)) {
      this.actions.set(presentSurface.name, presentSurface as ActionDefinition);
    }
    for (const action of config.customActions ?? []) this.actions.set(action.name, action);

    this.destructivePatterns = config.destructivePatterns ?? DEFAULT_DESTRUCTIVE_PATTERNS;

    this.crossTabKey = `${this.config.sessionStorageKey}.crosstab`;
    if (config.crossTabSync) {
      this.broadcastChannel = setupCrossTabSync({
        crossTabKey: this.crossTabKey,
        getCurrentSessionId: () => this.session?.id,
        isLocalRunActive: () => this.isRunning(),
        getLocalUpdatedAt: () => this.session?.updatedAt,
        adoptSession: (s) => { this.session = s; },
      });
    }
  }

  // ─── public API ─────────────────────────────────────────────────

  registerAction(action: ActionDefinition): void {
    this.actions.set(action.name, action);
  }

  /** Update the locale used for confirmation copy + system-prompt
   *  output-language hint. Called by the orchestrator when the host
   *  flips language at runtime. The currently-running turn keeps its
   *  prompt; the next turn picks up the new locale. */
  setLocale(locale: string): void {
    this.config.locale = locale;
  }

  /** Set by the orchestrator — called when the agent picks `navigate`.
   *  Hosts may return a Promise (most SPA routers do); the webagent
   *  awaits it before declaring the navigation complete. */
  setNavigateBridge(fn: (path: string) => void | Promise<void>): void {
    this.navigateBridge = fn;
  }

  /** Orchestrator wires this to emit `agent_llm_call` IntentEvents. */
  setLlmCallListener(fn: (info: LlmCallInfo) => void): void {
    this.llmCallListener = fn;
  }

  getSession(): AgentSession | null {
    return this.session;
  }

  clearSession(): void {
    this.session = null;
    this.continuityEnded = false;
    clearSession(this.config.sessionStorageKey);
  }

  /**
   * Resolve a tool-call selector argument to a live element. Accepts
   * either a numeric index from the latest indexed DOM dump (`3` /
   * `"3"` / `"[3]"` / `"↓3"`) or a CSS selector string. Returns null
   * for invalid CSS, unknown indexes, or pre-DOM (SSR) environments.
   *
   * Public so the host orchestrator can resolve `tool-start` event
   * `targetSelector` strings to highlight the right element before the
   * action handler dispatches.
   */
  resolveSelector(target: string | number): Element | null {
    if (typeof target === 'number') return this.currentIndexMap.get(String(target)) ?? null;
    if (typeof target !== 'string') return null;
    const trimmed = target.trim();
    const m = /^[↑↓]?\s*\[?([A-Za-z0-9_-]+)\]?$/.exec(trimmed);
    if (m) {
      const el = this.currentIndexMap.get(m[1]!);
      if (el) return el;
    }
    if (typeof document === 'undefined') return null;
    try { return document.querySelector(trimmed); } catch { return null; }
  }

  isRunning(): boolean {
    if (!this.session) return false;
    return this.session.status === 'thinking'
      || this.session.status === 'executing'
      || this.session.status === 'navigating'
      || this.session.status === 'waiting';
  }

  /** End the continuity window now — next runStream() starts fresh. */
  endContinuity(): void {
    this.continuityEnded = true;
  }

  stop(): void {
    if (this.currentAbort) {
      this.currentAbort.abort('user_stopped');
      this.currentAbort = null;
    }
    for (const id of this.pendingOrder) {
      const r = this.pendingResolvers.get(id);
      if (r) r('');
    }
    this.pendingResolvers.clear();
    this.pendingOrder = [];
    if (this.session) {
      this.session.status = 'idle';
      this.persistSession();
    }
  }

  /**
   * Soft stop the loop while keeping the session "live" so the next
   * `runStream(task)` appends to it as a follow-up turn instead of
   * starting fresh. Use this when the user interrupts the agent to
   * deliver a NEW prompt mid-task (opens the palette, holds Space for
   * voice) — the new prompt is naturally a continuation of the same
   * conversation even if the prior task was abandoned.
   *
   * Differs from `stop()`: status is set to `waiting` (which counts
   * as live in `isSessionLive`) instead of `idle`, so a host with
   * `sessionContinuityMs: 0` still gets continuity across the
   * intentional interrupt.
   */
  interruptForFollowup(): void {
    if (this.currentAbort) {
      this.currentAbort.abort('user_followup');
      this.currentAbort = null;
    }
    for (const id of this.pendingOrder) {
      const r = this.pendingResolvers.get(id);
      if (r) r('');
    }
    this.pendingResolvers.clear();
    this.pendingOrder = [];
    if (this.session) {
      this.session.status = 'waiting';
      this.persistSession();
    }
  }

  destroy(): void {
    this.stop();
    this.broadcastChannel?.close();
    this.broadcastChannel = null;
  }

  /**
   * Resolve the oldest pending host interaction (ask_user / ask_user_choice).
   */
  respond(answer: string | Record<string, unknown>): void {
    const id = this.pendingOrder.shift();
    if (!id) return;
    const resolver = this.pendingResolvers.get(id);
    if (!resolver) return;
    this.pendingResolvers.delete(id);
    resolver(typeof answer === 'string' ? answer : JSON.stringify(answer));
  }

  /**
   * Run a fresh task. If a session is still live within the continuity
   * window AND `opts.freshSession` is not set, the task is appended as a
   * follow-up user turn to the existing session instead.
   */
  runStream(task: string, opts: RunOptions = {}): AsyncIterable<AgentEvent> {
    const currentPath = typeof location !== 'undefined' ? location.pathname + location.search : '/';

    const fresh = opts.freshSession === true || this.continuityEnded ||
      !this.session ||
      !isSessionLive(this.session, this.config.sessionContinuityMs) ||
      (this.config.sessionScope === 'palette' && this.continuityEnded);

    if (fresh) {
      this.stop();
      this.session = createSession(currentPath);
      this.continuityEnded = false;
    }

    pushUserTurn(this.session!, { text: task, selection: opts.selection });
    this.currentSelection = opts.selection ?? null;
    this.persistSession();

    return this.startLoop();
  }

  /** Force-append as a follow-up turn (no continuity check). */
  continueStream(task: string, opts: RunOptions = {}): AsyncIterable<AgentEvent> {
    return this.runStream(task, { ...opts, freshSession: false });
  }

  /**
   * Resume a saved session — used by the host's onMount when the page
   * reloaded mid-task or after SPA nav. Reads `loadSession()` first; if
   * the loaded session has a non-terminal status AND its `currentPage`
   * differs from the current URL, the loop picks back up.
   */
  resumeStream(): AsyncIterable<AgentEvent> {
    if (!this.session) {
      const saved = loadSession(this.config.sessionStorageKey);
      if (!saved) return emptyStream();
      this.session = saved;
    }
    const currentPath = typeof location !== 'undefined' ? location.pathname + location.search : '/';
    if (!shouldAutoResume(this.session, currentPath)) return emptyStream();
    // Update page in session so the loop knows we navigated.
    return this.startLoop();
  }

  // ─── loop ───────────────────────────────────────────────────────

  private startLoop(): AsyncIterable<AgentEvent> {
    this.currentAbort = new AbortController();
    return this.config.cotMode
      ? this.executeCotLoop(this.currentAbort.signal)
      : this.executeLoop(this.currentAbort.signal);
  }

  private async *executeLoop(signal: AbortSignal): AsyncIterable<AgentEvent> {
    if (!this.session) return;
    let errorCount = 0;

    for (let stepIdx = 0; stepIdx < this.config.maxSteps; stepIdx++) {
      if (signal.aborted) {
        this.setStatus('idle');
        return;
      }

      // Detect SPA nav between iterations.
      const nowUrl = typeof location !== 'undefined' ? location.pathname + location.search : null;
      if (nowUrl && this.session.currentPage !== nowUrl) {
        const from = this.session.currentPage;
        this.session.currentPage = nowUrl;
        this.persistSession();
        yield { kind: 'navigated', from, to: nowUrl };
      }

      this.setStatus('thinking');
      yield { kind: 'thinking' };

      let toolCall: ToolCall | undefined;
      let textBuffer = '';
      try {
        for await (const ev of this.callLlmStream(signal)) {
          if (signal.aborted) { this.setStatus('idle'); return; }
          if (ev.kind === 'text-delta' && ev.delta) {
            textBuffer += ev.delta;
            yield ev;
          } else if (ev.kind === 'tool-call') {
            toolCall = ev.call;
            // Don't break the stream — let it finish so finishReason / usage land,
            // but no more text deltas matter once we know the tool we're calling.
          }
        }
        errorCount = 0;
      } catch (err) {
        if (signal.aborted) { this.setStatus('idle'); return; }
        errorCount += 1;
        const retrying = errorCount < this.config.maxErrors;
        yield { kind: 'error', error: err as Error, retrying };
        if (!retrying) {
          this.setStatus('failed');
          return;
        }
        await sleep(400 * Math.pow(2, errorCount - 1));
        continue;
      }

      // No tool call → final paragraph. Done.
      if (!toolCall) {
        if (textBuffer) pushAgentFinal(this.session, textBuffer);
        this.setStatus('idle');
        yield { kind: 'final' };
        return;
      }

      const matched = this.actions.get(toolCall.name);

      // Confirm gate for destructive actions.
      const needsConfirm = await this.needsConfirmation(toolCall, matched, signal);
      if (needsConfirm) {
        const locale = this.config.locale ?? 'en';
        // Precedence: per-action override → host-level override → SDK default.
        const message = matched?.confirmationMessage?.(toolCall.arguments as never)
          ?? this.config.buildConfirmMessage?.(toolCall.name, toolCall.arguments, locale)
          ?? narrateAction(toolCall.name, toolCall.arguments, locale);
        let resolveConfirm!: (ok: boolean) => void;
        const approvedPromise = new Promise<boolean>((r) => { resolveConfirm = r; });
        this.setStatus('waiting');
        yield {
          kind: 'confirm',
          actionName: toolCall.name,
          args: toolCall.arguments,
          message,
          decide: resolveConfirm,
        };
        const approved = await Promise.race([
          approvedPromise,
          new Promise<boolean>((_, reject) => {
            const onAbort = (): void => { signal.removeEventListener('abort', onAbort); reject(new Error('aborted')); };
            signal.addEventListener('abort', onAbort, { once: true });
          }),
        ]).catch(() => false);
        if (!approved) {
          // Record as a tool result so the model can adapt; loop continues.
          const result: ActionResult = { ok: false, reason: 'user_declined' };
          pushAgentStep(this.session, {
            preText: textBuffer || undefined,
            toolCall: { name: toolCall.name, arguments: toolCall.arguments },
            toolCallId: toolCall.id,
            result,
          });
          this.persistSession();
          yield { kind: 'tool-end', name: toolCall.name, result, toolCallId: toolCall.id };
          continue;
        }
      }

      // Dispatch the tool.
      const targetSelector = extractTargetSelector(toolCall.arguments);
      yield {
        kind: 'tool-start',
        name: toolCall.name,
        args: toolCall.arguments,
        targetSelector,
        toolCallId: toolCall.id,
      };

      let result: ActionResult;
      if (toolCall.name === 'navigate') {
        this.setStatus('navigating');
        const path = String(toolCall.arguments.path ?? '');
        const from = this.session.currentPage;
        // Surface the "page is loading" beat to the host BEFORE the
        // router fires. The host shows a loading indicator that stays
        // visible until `navigated` arrives.
        yield { kind: 'navigating', from, to: path };
        try {
          const bridgeResult = this.navigateBridge?.(path);
          // Hosts whose router returns a Promise give us the real
          // "render complete" signal — wait on it before declaring
          // nav done.
          if (bridgeResult && typeof (bridgeResult as Promise<void>).then === 'function') {
            await bridgeResult;
          }
        } catch (err) {
          result = { ok: false, reason: 'navigation', message: (err as Error).message };
          yield { kind: 'tool-end', name: 'navigate', result, toolCallId: toolCall.id };
          pushAgentStep(this.session, {
            preText: textBuffer || undefined,
            toolCall: { name: toolCall.name, arguments: toolCall.arguments },
            toolCallId: toolCall.id,
            result,
          });
          this.persistSession();
          continue;
        }
        // Final stabilization — even after the router resolves, components
        // may still be hydrating / lazy chunks fetching. Idle-watch the
        // DOM with a 250ms quiet window and a 2.5s ceiling.
        await awaitNavSettle(2500);
        yield { kind: 'navigated', from, to: path };
        // Continuation hint embedded in the tool result so the next LLM
        // turn sees, in the tool message itself, that arrival is not
        // the end of the task. Without this, smaller models often emit
        // finish_reason=stop right after the navigate succeeds.
        result = {
          ok: true,
          data: {
            path,
            arrivedAt: path,
            note: 'Navigation complete — you are NOW at this URL. The user\'s original task is not done yet; the navigate was a means to an end. Continue immediately: read the new page DOM in the next message, pick the first subject in reading order, border it, narrate 1-3 sentences quoting the actual visible text, then call pause. Do NOT stop the loop here.',
          },
        };
      } else {
        const wasUserFacing = toolCall.name === 'ask_user' || toolCall.name === 'ask_user_choice';
        this.setStatus(wasUserFacing ? 'waiting' : 'executing');
        result = await executeAction(
          {
            actions: this.actions,
            indexMap: this.currentIndexMap,
            registerPendingResolver: (r) => this.registerPendingResolver(r),
            emitAskUser: (payload) => {
              if (this.askUserHandler) this.askUserHandler(payload);
              else payload.resolve('');
            },
            emitAskUserChoice: (payload) => {
              if (this.askUserChoiceHandler) this.askUserChoiceHandler(payload);
              else payload.resolve('');
            },
            emitPause: (payload) => {
              if (this.pauseHandler) this.pauseHandler(payload);
              // Fallback: if no host pauseHandler is wired, fall back
              // to the ask_user envelope so the gesture still works
              // (the user sees a regular subtitle prompt). Hosts SHOULD
              // wire `setPauseHandler` to keep the streaming bar visible.
              else if (this.askUserHandler) {
                this.askUserHandler({ question: payload.hint, resolve: payload.resolve });
              } else {
                payload.resolve('');
              }
            },
            emitPresentSurface: this.surfaceMounter ? (payload) => this.surfaceMounter!(payload) : undefined,
            session: this.session,
            defaultPauseNote:
              this.config.defaultPauseNote ?? sdkString(this.config.locale, 'agent.press_space_continue'),
          },
          toolCall.name,
          toolCall.arguments,
          signal,
        );
      }

      yield { kind: 'tool-end', name: toolCall.name, result, toolCallId: toolCall.id };

      pushAgentStep(this.session, {
        preText: textBuffer || undefined,
        toolCall: { name: toolCall.name, arguments: toolCall.arguments },
        toolCallId: toolCall.id,
        result,
      });
      this.persistSession();

      if (!result.ok) {
        errorCount += 1;
        if (errorCount >= this.config.maxErrors) {
          this.setStatus('failed');
          return;
        }
      } else {
        errorCount = 0;
      }
    }

    // maxSteps hit. Yield `final` so the orchestrator's closure hook
    // still renders the closing UI (otherwise the subtitle bar just
    // disappears, which reads as broken).
    this.setStatus('failed');
    yield { kind: 'final' };
  }

  /**
   * CoT-mode loop — every turn returns a single `agent_turn` tool call
   * whose args carry `{ memory, todos_remaining, actions[]? }`. The runtime
   * parses the envelope, then iterates actions in order:
   *   - `narrate` → typewriter-stream to the subtitle bar
   *   - `tool` → confirm-gate (if destructive) + dispatch through the
   *     same `executeAction` path as the classic loop
   * Empty `actions[]` signals task complete (no need for an explicit
   * `done` tool — the empty array IS the done signal).
   */
  private async *executeCotLoop(signal: AbortSignal): AsyncIterable<AgentEvent> {
    if (!this.session) return;
    let errorCount = 0;

    // ─── Planning phase (one-shot, optional) ─────────────────────
    // When `config.planner` is set AND this session has no plan yet,
    // run a single planning call before entering the turn loop. The
    // resulting TaskPlan is stored on session.plan so subsequent turns
    // can render `# Master plan` in the system prompt and mutate via
    // todo_adjust. Planning is fail-loud: a thrown error propagates to
    // the consumer's runStream() iterator. Hosts handle fallback.
    if (this.config.planner && !this.session.plan) {
      this.setStatus('thinking');
      yield { kind: 'thinking' };
      const latestUser = lastUserTurn(this.session);
      const taskText = latestUser?.text ?? '';
      console.info('[dddk webagent] planning start', { task: taskText });
      try {
        const plan = await this.config.planner({
          task: taskText,
          sitemap: this.config.sitemap,
          brand: this.config.brand,
          persona: this.config.persona,
          locale: this.config.locale,
          selection: this.currentSelection ?? undefined,
        });
        this.session.plan = plan;
        this.persistSession();
        console.info('[dddk webagent] planning result', {
          task_summary: plan.task_summary,
          todoCount: plan.todos.length,
          todos: plan.todos,
        });
        if (this.config.announcePlan && plan.task_summary?.trim()) {
          yield {
            kind: 'text-delta',
            delta: plan.task_summary.trim() + '\n',
          };
          // Wait for user ack before turn 1 starts — otherwise the
          // first turn's confirm dialog (navigate, destructive tool)
          // covers the announce before the user can read it.
          if (this.pauseHandler) {
            this.setStatus('waiting');
            const pauseHint = sdkString(this.config.locale, 'agent.press_space_continue');
            const resolution = await new Promise<string>((resolve) => {
              this.pauseHandler!({ hint: pauseHint, resolve });
            });
            if (signal.aborted || resolution === '') {
              this.setStatus('idle');
              return;
            }
          }
        }
      } catch (err) {
        if (signal.aborted) { this.setStatus('idle'); return; }
        console.warn('[dddk webagent] planning failed', err);
        yield { kind: 'error', error: err as Error, retrying: false };
        this.setStatus('failed');
        return;
      }
    }

    for (let stepIdx = 0; stepIdx < this.config.maxSteps; stepIdx++) {
      if (signal.aborted) { this.setStatus('idle'); return; }

      // SPA nav detection between iterations.
      const nowUrl = typeof location !== 'undefined' ? location.pathname + location.search : null;
      if (nowUrl && this.session.currentPage !== nowUrl) {
        const from = this.session.currentPage;
        this.session.currentPage = nowUrl;
        this.persistSession();
        yield { kind: 'navigated', from, to: nowUrl };
      }

      this.setStatus('thinking');
      yield { kind: 'thinking' };

      // Single forced tool call to `agent_turn`. Stray text deltas are
      // ignored — the schema doesn't allow them, but we tolerate misbehaving
      // providers.
      let agentTurnCall: ToolCall | undefined;
      try {
        for await (const ev of this.callLlmStream(signal)) {
          if (signal.aborted) { this.setStatus('idle'); return; }
          if (ev.kind === 'tool-call' && ev.call.name === AGENT_TURN_TOOL) {
            agentTurnCall = ev.call;
          }
        }
        errorCount = 0;
      } catch (err) {
        if (signal.aborted) { this.setStatus('idle'); return; }
        errorCount += 1;
        const retrying = errorCount < this.config.maxErrors;
        yield { kind: 'error', error: err as Error, retrying };
        if (!retrying) { this.setStatus('failed'); return; }
        await sleep(400 * Math.pow(2, errorCount - 1));
        continue;
      }

      if (!agentTurnCall) {
        // Provider didn't comply with toolChoice — treat as done so the
        // user isn't stuck in an empty loop.
        this.setStatus('idle');
        yield { kind: 'final' };
        return;
      }

      const turn = parseTurnResponse(agentTurnCall.arguments);
      if (!turn) {
        errorCount += 1;
        const result: ActionResult = { ok: false, reason: 'unknown', message: 'invalid agent_turn envelope' };
        // Debug surface for invalid envelopes — the user can copy this
        // from devtools console to diagnose why a turn failed parse.
        console.warn('[dddk webagent] turn parse failed', {
          rawArguments: agentTurnCall.arguments,
        });
        if (typeof window !== 'undefined') {
          const w = window as unknown as { __dddkDebug?: { lastParseFailure?: unknown; lastParseFailureAt?: string } };
          w.__dddkDebug = w.__dddkDebug ?? {};
          w.__dddkDebug.lastParseFailure = agentTurnCall.arguments;
          w.__dddkDebug.lastParseFailureAt = new Date().toISOString();
        }
        pushAgentStep(this.session, {
          toolCall: { name: AGENT_TURN_TOOL, arguments: agentTurnCall.arguments },
          toolCallId: agentTurnCall.id,
          result,
        });
        this.persistSession();
        yield { kind: 'tool-end', name: AGENT_TURN_TOOL, result, toolCallId: agentTurnCall.id };
        if (errorCount >= this.config.maxErrors) { this.setStatus('failed'); return; }
        continue;
      }

      // Per-turn debug log. Prints a structured row to the devtools
      // console (the user can right-click → "Copy object" or screenshot)
      // AND appends it to window.__dddkDebug.turnLog for later inspection.
      // Diagnostics goal: when the agent loops on the same content the
      // user can SEE that todos_remaining never empties despite the
      // page already being fully covered in action_results.
      // Per-turn summary — fields present only when the envelope mode
      // actually populates them. Legacy mode has `todos_remaining`;
      // planned mode has `turn_planning` + `todo_adjust` + the live
      // master `plan.todos`. Don't emit `undefined` placeholders.
      const turnSummary: Record<string, unknown> = {
        turn: stepIdx + 1,
        url: this.session.currentPage,
        memory: turn.memory,
      };
      if (turn.todos_remaining !== undefined) turnSummary.todos_remaining = turn.todos_remaining;
      if (turn.turn_planning) turnSummary.turn_planning = turn.turn_planning;
      if (turn.todo_adjust) turnSummary.todo_adjust = turn.todo_adjust;
      if (this.session.plan) {
        turnSummary.master_todos = this.session.plan.todos.map((t) => `${t.id}:${t.intent}:${t.description}`);
      }
      turnSummary.actions = turn.actions.map((a) => {
        if (isNarrateAction(a)) {
          return { narrate: a.narrate.length > 100 ? a.narrate.slice(0, 100) + '…' : a.narrate };
        }
        if (isTaskFinishAction(a)) return { task_finish: true };
        return { tool: (a as { tool: string }).tool, args: (a as { args?: unknown }).args };
      });
      console.info('[dddk webagent] turn', turnSummary);
      if (typeof window !== 'undefined') {
        const w = window as unknown as { __dddkDebug?: { turnLog?: unknown[]; lastTurnResponse?: unknown; lastTurnAt?: string } };
        w.__dddkDebug = w.__dddkDebug ?? {};
        w.__dddkDebug.turnLog = w.__dddkDebug.turnLog ?? [];
        (w.__dddkDebug.turnLog as unknown[]).push(turnSummary);
        // Cap log at 50 entries so long sessions don't bloat memory.
        if ((w.__dddkDebug.turnLog as unknown[]).length > 50) {
          w.__dddkDebug.turnLog = (w.__dddkDebug.turnLog as unknown[]).slice(-50);
        }
        w.__dddkDebug.lastTurnResponse = turn;
        w.__dddkDebug.lastTurnAt = new Date().toISOString();
      }

      // Structural normalization. Historically when `todos_remaining` is
      // empty we forced `actions = []` (band-aid for models that signalled
      // done via empty todos but still emitted actions). Now that the
      // schema has explicit `{task_finish: true}` for end-of-loop, model
      // CAN legitimately emit `[narrate, narrate, ..., task_finish]` as a
      // wrap-up — todos already empty because the work is done, but the
      // narrates carry the closing message. We only normalize away when
      // the model has NEITHER an explicit task_finish NOR any narrate —
      // i.e. it left orphan tool calls without a closing signal.
      // Apply todo_adjust mutations BEFORE dispatching actions — the
      // adjustments describe what the PREVIOUS turn completed / how the
      // plan needs to morph based on observed reality. So the master
      // plan is up-to-date before this turn's actions[] runs.
      if (turn.todo_adjust && this.session.plan) {
        if (turn.todo_adjust.remove?.length) {
          for (const id of turn.todo_adjust.remove) {
            this.session.plan.todos = this.session.plan.todos.filter((t) => t.id !== id);
          }
        }
        if (turn.todo_adjust.replace?.length) {
          for (const r of turn.todo_adjust.replace) {
            const idx = this.session.plan.todos.findIndex((t) => t.id === r.id);
            if (idx < 0) continue;
            this.session.plan.todos[idx] = {
              ...this.session.plan.todos[idx]!,
              description: r.new_description,
              ...(r.new_intent ? { intent: r.new_intent } : {}),
            };
          }
        }
        this.persistSession();
      }

      // In legacy mode `todos_remaining` carries the plan; in planned
      // mode it's absent (master plan lives on session.plan.todos and
      // mutates via `todo_adjust`). Only apply this normalisation in
      // legacy mode — planned mode trusts the schema's structural
      // distinction.
      if (turn.todos_remaining !== undefined && turn.todos_remaining.length === 0 && turn.actions.length > 0) {
        const hasTaskFinish = turn.actions.some((a) => isTaskFinishAction(a));
        const hasNarrate = turn.actions.some((a) => isNarrateAction(a));
        if (!hasTaskFinish && !hasNarrate) {
          if (typeof console !== 'undefined') {
            console.info('[dddk webagent] todos empty + actions has only tools without task_finish → ' + turn.actions.length + ' queued actions normalized away; loop ends');
          }
          turn.actions = [];
        }
      }

      if (turn.actions.length === 0) {
        // Empty actions[] = task complete. Record the envelope so history
        // replays cleanly, then end the loop.
        pushAgentStep(this.session, {
          toolCall: { name: AGENT_TURN_TOOL, arguments: agentTurnCall.arguments },
          toolCallId: agentTurnCall.id,
          result: {
            ok: true,
            data: {
              memory: turn.memory,
              todos_remaining: turn.todos_remaining,
              action_count: 0,
              action_results: [],
            },
          },
        });
        this.persistSession();
        this.setStatus('idle');
        yield { kind: 'final' };
        return;
      }

      // Iterate actions in order. Collect per-action outcomes into
      // `actionResults` so the next LLM turn can see what actually happened
      // (not just "action_count: N") and reason about it. Without this, the
      // model re-issues actions it already executed.
      const actionResults: Array<{ type: 'narrate'; text: string } | { type: 'tool'; name: string; ok: boolean; reason?: string; data?: unknown } | { type: 'done' }> = [];
      let actionErrorThisTurn = 0;
      let pageChanged = false;
      // Set by an explicit `{done: true}` action item. When true, the outer
      // loop ends right after this turn's dispatch finishes — saves the
      // wasted "I'm done" round-trip otherwise needed when the model has
      // already finished the work this turn.
      let endLoopRequested = false;
      // Track whether this turn ran an action whose RESULT the model still
      // needs to read before declaring the run finished. Used to drop a
      // mis-placed `{task_finish: true}` in the SAME turn.
      //
      // Scope is deliberately narrow:
      //   - `ask_user_choice` / `ask_user` — answer is genuinely pending; the
      //     model has no idea what the user will pick until the next turn.
      //   - `navigate` — destination page DOM is brand new; declaring the
      //     task done before reading it is almost always wrong.
      //
      // NOT in this set: `click`, `fill_input`, `select_option`,
      // `open_palette`, `submit`. Those CAN be terminal (a palette row
      // click commits + closes; a submit posts a form). Trust the model
      // to decide whether task_finish belongs after them.
      const TOOLS_REQUIRING_NEXT_REACTION = new Set(['ask_user_choice', 'ask_user', 'navigate']);
      let executedReactionRequiringTool = false;
      for (let ai = 0; ai < turn.actions.length; ai++) {
        const action = turn.actions[ai]!;
        if (signal.aborted) { this.setStatus('idle'); return; }

        if (isTaskFinishAction(action)) {
          if (executedReactionRequiringTool) {
            // Model emitted `task_finish` after a tool whose outcome it
            // hasn't yet processed (asked the user → answer pending,
            // navigated → new DOM not seen, etc.). Treat as a mis-use,
            // log, drop.
            console.warn('[dddk webagent] dropping {task_finish:true} — turn included a reaction-requiring tool; the run is not actually finished yet');
            continue;
          }
          endLoopRequested = true;
          actionResults.push({ type: 'done' });
          // No further action items matter once task_finish lands — the
          // model is signalling the run is over. Break out of the action loop.
          break;
        }

        if (isNarrateAction(action)) {
          this.setStatus('executing');
          // Auto-border the element this narrate is "about" BEFORE streaming
          // the text. Putting the framing in the same {narrate, about} payload
          // means the model can't forget to chain a separate border action —
          // structurally enforced rather than rule-enforced. Synthesises the
          // same tool-start / tool-end events the explicit `border` path emits
          // so highlight pipelines (resolveSelector → host highlight) still
          // observe the framing.
          const about = (action as { about?: string }).about;
          if (about && about.trim().length > 0) {
            const borderAction = this.actions.get('border');
            if (borderAction) {
              const synthId = `cot_about_${stepIdx}_${ai}_${Math.random().toString(36).slice(2, 6)}`;
              yield {
                kind: 'tool-start',
                name: 'border',
                args: { selector: about },
                targetSelector: about,
                toolCallId: synthId,
              };
              const borderResult = await executeAction(
                {
                  actions: this.actions,
                  indexMap: this.currentIndexMap,
                  registerPendingResolver: (r) => this.registerPendingResolver(r),
                  emitAskUser: () => {},
                  emitAskUserChoice: () => {},
                  emitPause: () => {},
                  emitPresentSurface: undefined,
                  session: this.session,
                  defaultPauseNote: '',
                },
                'border',
                { selector: about },
                signal,
              );
              yield { kind: 'tool-end', name: 'border', result: borderResult, toolCallId: synthId };
              actionResults.push({
                type: 'tool',
                name: 'border',
                ok: borderResult.ok,
                reason: borderResult.ok ? undefined : borderResult.reason,
                data: borderResult.ok ? borderResult.data : undefined,
              });
            }
          }

          // Throttle the typewriter feel. `agent_turn` arrives complete, so
          // we slice the narrate into small chunks and pace them out — fast
          // enough to feel responsive, slow enough that readers can follow
          // as it appears (instant-blit feels like a wall-of-text drop).
          // 4ms per char ≈ 250 chars/sec; chunking 2 chars at a time so the
          // event loop overhead doesn't dominate at that rate.
          const NARRATE_CHUNK_SIZE = 2;
          const NARRATE_CHUNK_DELAY_MS = 8;
          for (let i = 0; i < action.narrate.length; i += NARRATE_CHUNK_SIZE) {
            if (signal.aborted) { this.setStatus('idle'); return; }
            yield { kind: 'text-delta', delta: action.narrate.slice(i, i + NARRATE_CHUNK_SIZE) };
            await sleep(NARRATE_CHUNK_DELAY_MS);
          }
          actionResults.push({ type: 'narrate', text: action.narrate });

          // Auto-pause after every narration — the rhythm the user expects
          // is `border → narrate → pause → ...`. Runtime inserts the pause
          // so the model never has to manage cadence with explicit `pause`
          // tool calls.
          //
          // We deliberately DO NOT skip the pause when the next action is
          // a confirm-required tool (navigate, destructive). Earlier the
          // skip was an optimisation against "two Space presses for one
          // decision", but in practice the confirm dialog covers the
          // narrate the user is still reading. Better: pause first so
          // the user acks the narrate context, THEN show the confirm.
          //
          // One skip condition kept: focus inside the open palette's
          // input. The palette is the one place where the user is
          // expected to be typing INTO the SDK's own surface while the
          // agent is running (e.g. the agent opened the palette to let
          // the user pick / fill). Skipping pause here lets the loop
          // continue while the user types.
          //
          // Deliberately NOT skipped for page-level inputs — the user
          // can leave a page form temporarily, blur it, and Space then
          // advances the agent normally. Always-skip would mean Space
          // "has no effect" when the user finishes filling, which is
          // confusing.
          let skipPause = false;
          if (isUserEditingInPalette()) {
            skipPause = true;
          }

          if (!skipPause && this.pauseHandler) {
            this.setStatus('waiting');
            const pauseHint = sdkString(this.config.locale, 'agent.press_space_continue');
            const resolution = await new Promise<string>((resolve) => {
              this.pauseHandler!({ hint: pauseHint, resolve });
            });
            if (signal.aborted || resolution === '') {
              this.setStatus('idle');
              return;
            }
          }
          continue;
        }

        if (isToolAction(action)) {
          // Synthesize a ToolCall and route through the same confirm-gate
          // + dispatch path the classic loop uses. We don't extract this
          // into a shared helper yet — once CoT mode is the default we
          // can collapse classic into a thin wrapper.
          const synth: ToolCall = {
            id: `cot_${stepIdx}_${Math.random().toString(36).slice(2, 8)}`,
            name: action.tool,
            arguments: action.args ?? {},
          };
          if (TOOLS_REQUIRING_NEXT_REACTION.has(synth.name)) {
            executedReactionRequiringTool = true;
          }
          const matched = this.actions.get(synth.name);

          const needsConfirm = await this.needsConfirmation(synth, matched, signal);
          if (needsConfirm) {
            const locale = this.config.locale ?? 'en';
            const message = matched?.confirmationMessage?.(synth.arguments as never)
              ?? this.config.buildConfirmMessage?.(synth.name, synth.arguments, locale)
              ?? narrateAction(synth.name, synth.arguments, locale);
            let resolveConfirm!: (ok: boolean) => void;
            const approvedPromise = new Promise<boolean>((r) => { resolveConfirm = r; });
            this.setStatus('waiting');
            yield {
              kind: 'confirm',
              actionName: synth.name,
              args: synth.arguments,
              message,
              decide: resolveConfirm,
            };
            const approved = await Promise.race([
              approvedPromise,
              new Promise<boolean>((_, reject) => {
                const onAbort = (): void => { signal.removeEventListener('abort', onAbort); reject(new Error('aborted')); };
                signal.addEventListener('abort', onAbort, { once: true });
              }),
            ]).catch(() => false);
            if (!approved) {
              const result: ActionResult = { ok: false, reason: 'user_declined' };
              yield { kind: 'tool-end', name: synth.name, result, toolCallId: synth.id };
              actionResults.push({ type: 'tool', name: synth.name, ok: false, reason: 'user_declined' });
              continue;
            }
          }

          const targetSelector = extractTargetSelector(synth.arguments);
          yield { kind: 'tool-start', name: synth.name, args: synth.arguments, targetSelector, toolCallId: synth.id };

          let result: ActionResult;
          if (synth.name === 'navigate') {
            const path = String(synth.arguments.path ?? '').trim();
            if (!path) {
              // Model called navigate without a path. Reject loudly so
              // the next turn sees the failure in history and self-corrects
              // (rather than the bridge silently no-op'ing and the user
              // staring at a hung confirm).
              result = { ok: false, reason: 'unknown', message: 'navigate requires a non-empty `path` arg (e.g. "/docs")' };
              yield { kind: 'tool-end', name: 'navigate', result, toolCallId: synth.id };
              actionResults.push({ type: 'tool', name: 'navigate', ok: false, reason: 'missing path' });
              actionErrorThisTurn += 1;
              continue;
            }
            this.setStatus('navigating');
            const from = this.session.currentPage;
            yield { kind: 'navigating', from, to: path };
            try {
              const bridgeResult = this.navigateBridge?.(path);
              if (bridgeResult && typeof (bridgeResult as Promise<void>).then === 'function') {
                await bridgeResult;
              }
            } catch (err) {
              result = { ok: false, reason: 'navigation', message: (err as Error).message };
              yield { kind: 'tool-end', name: 'navigate', result, toolCallId: synth.id };
              actionResults.push({ type: 'tool', name: synth.name, ok: false, reason: 'navigation' });
              actionErrorThisTurn += 1;
              continue;
            }
            await awaitNavSettle(2500);
            yield { kind: 'navigated', from, to: path };
            result = { ok: true, data: { path, arrivedAt: path } };
            // Page has changed — the remaining actions in this envelope
            // were planned against the OLD DOM and would mis-target. Mark
            // the turn as page-changed; we break the action loop below
            // and let the next outer iteration re-read DOM + re-plan.
            pageChanged = true;
          } else {
            const wasUserFacing = synth.name === 'ask_user' || synth.name === 'ask_user_choice';
            this.setStatus(wasUserFacing ? 'waiting' : 'executing');
            result = await executeAction(
              {
                actions: this.actions,
                indexMap: this.currentIndexMap,
                registerPendingResolver: (r) => this.registerPendingResolver(r),
                emitAskUser: (payload) => {
                  if (this.askUserHandler) this.askUserHandler(payload);
                  else payload.resolve('');
                },
                emitAskUserChoice: (payload) => {
                  if (this.askUserChoiceHandler) this.askUserChoiceHandler(payload);
                  else payload.resolve('');
                },
                emitPause: (payload) => {
                  if (this.pauseHandler) this.pauseHandler(payload);
                  else if (this.askUserHandler) {
                    this.askUserHandler({ question: payload.hint, resolve: payload.resolve });
                  } else {
                    payload.resolve('');
                  }
                },
                emitPresentSurface: this.surfaceMounter ? (payload) => this.surfaceMounter!(payload) : undefined,
                session: this.session,
                defaultPauseNote:
                  this.config.defaultPauseNote ?? sdkString(this.config.locale, 'agent.press_space_continue'),
              },
              synth.name,
              synth.arguments,
              signal,
            );
          }

          yield { kind: 'tool-end', name: synth.name, result, toolCallId: synth.id };
          actionResults.push({
            type: 'tool',
            name: synth.name,
            ok: result.ok,
            reason: result.ok ? undefined : result.reason,
            data: result.ok ? result.data : undefined,
          });
          if (!result.ok) actionErrorThisTurn += 1;
        }
      }

      // Record the whole envelope + per-action outcomes as ONE history
      // step. The next LLM turn sees the agent_turn assistant message,
      // the tool reply with these results, and can reason about what
      // actually happened — without this the model re-issues actions it
      // already executed (e.g. re-asking to navigate after the page
      // already switched).
      const envelopeData = {
        memory: turn.memory,
        todos_remaining: turn.todos_remaining,
        action_results: actionResults,
        page_changed: pageChanged,
      };
      pushAgentStep(this.session, {
        toolCall: { name: AGENT_TURN_TOOL, arguments: agentTurnCall.arguments },
        toolCallId: agentTurnCall.id,
        result: actionErrorThisTurn === 0
          ? { ok: true, data: envelopeData }
          : { ok: false, reason: 'unknown', message: JSON.stringify(envelopeData) },
      });
      this.persistSession();

      if (actionErrorThisTurn > 0) {
        errorCount += 1;
        if (errorCount >= this.config.maxErrors) {
          this.setStatus('failed');
          return;
        }
      } else {
        errorCount = 0;
      }

      // Explicit `{done: true}` action — model signalled this turn closes
      // the loop. Skip the wasted "I'm done" round-trip the empty-actions
      // path would otherwise require.
      if (endLoopRequested) {
        this.setStatus('idle');
        yield { kind: 'final' };
        return;
      }
    }

    // maxSteps hit. Yield `final` so the orchestrator's loop-closure
    // hook still renders the "✓ done" UI — without this the subtitle
    // bar just disappears when the agent caps out.
    this.setStatus('failed');
    yield { kind: 'final' };
  }

  // ─── ask_user wiring — surfaced via a second-channel host hook ──
  //
  // executeAction's `emitAskUser` / `emitAskUserChoice` need a way to reach
  // the orchestrator UI even though the generator is currently awaiting on
  // the action's Promise. We register a host callback at construction so
  // the action can fire it directly.

  private askUserHandler: ((payload: import('./execute-action').AskUserPayload) => void) | null = null;
  private askUserChoiceHandler: ((payload: import('./execute-action').AskUserChoicePayload) => void) | null = null;
  private pauseHandler: ((payload: import('./execute-action').PausePayload) => void) | null = null;
  private surfaceMounter: ((payload: import('./execute-action').PresentSurfacePayload) => void) | null = null;

  /** Orchestrator wires the UI route for ask_user. */
  setAskUserHandler(fn: (payload: import('./execute-action').AskUserPayload) => void): void {
    this.askUserHandler = fn;
  }
  setAskUserChoiceHandler(fn: (payload: import('./execute-action').AskUserChoicePayload) => void): void {
    this.askUserChoiceHandler = fn;
  }
  /** Orchestrator wires the UI route for the `pause` tool. Default
   *  behaviour (no handler set) falls back to the ask_user envelope. */
  setPauseHandler(fn: (payload: import('./execute-action').PausePayload) => void): void {
    this.pauseHandler = fn;
  }
  /** Orchestrator wires the host mounter for `present_surface`. The
   *  mounter receives a PieceSurface + placement and is expected to
   *  render the surface and call `resolve({ value, cancelled })` once
   *  the user picks or dismisses. Only consulted when the agent's
   *  `allowPresent: true`. */
  setSurfaceMounter(fn: (payload: import('./execute-action').PresentSurfacePayload) => void): void {
    this.surfaceMounter = fn;
  }

  private registerPendingResolver(resolver: (raw: string) => void): string {
    const id = `pr_${++this.pendingCounter}_${Date.now().toString(36)}`;
    this.pendingResolvers.set(id, resolver);
    this.pendingOrder.push(id);
    return id;
  }

  // ─── LLM streaming wrapper ─────────────────────────────────────

  /**
   * Wraps the provider's streamComplete (or falls back to complete()) into
   * a unified iterable yielding text-delta / tool-call events. Also enforces
   * the per-call timeout.
   */
  private async *callLlmStream(signal: AbortSignal): AsyncIterable<
    { kind: 'text-delta'; delta: string } | { kind: 'tool-call'; call: ToolCall }
  > {
    if (!this.session) return;

    // Pick the vision-capable provider when this turn carries images
    // (selection screenshots, drag-cropped frames, dwell context) OR the
    // host has enabled `screenshot` for every turn. The router returns the
    // dedicated `webagentWithSelection` provider if one is registered,
    // otherwise falls back to `webagent` — so hosts that only set the
    // main slot still work.
    const messages = await this.buildMessages();
    const hasImages = this.config.screenshot != null && this.config.screenshot !== false
      ? true
      : messageContentHasImage(messages);
    const role = hasImages ? 'webagentWithSelection' as const : 'webagent' as const;
    const llm = resolveLLM(this.config.llm, role);
    const tools = this.buildToolDefinitions();
    const completeOpts = {
      messages,
      tools,
      signal,
      thinking: this.config.thinking ?? 'off' as const,
      // CoT mode forces the model to call the single wrapping tool every
      // turn. Without this, smaller models occasionally emit a free-text
      // turn that has no actions to dispatch.
      toolChoice: this.config.cotMode
        ? ({ name: AGENT_TURN_TOOL } as const)
        : undefined,
    };

    const streamProvider = llm as unknown as StreamingProvider;
    const hasStreaming = typeof streamProvider.streamComplete === 'function';

    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort('llm timeout'), this.config.llmTimeoutMs);
    const composedSignal = composeSignals(signal, timeoutCtrl.signal);

    // Per-call perf instrumentation. Consumer-side measurement so it
    // reflects what the agent actually saw, not what the producer cached.
    const startedAt = Date.now();
    let firstDeltaAt: number | undefined;
    let usage: { promptTokens: number; completionTokens: number } | undefined;
    const modelId = (llm as { name?: string; model?: string }).model
      ?? (llm as { name?: string }).name;

    try {
      if (hasStreaming) {
        const handle = streamProvider.streamComplete!({ ...completeOpts, signal: composedSignal });
        let lastText = '';
        const yieldedToolIds = new Set<string>();
        for await (const chunk of handle as AsyncIterable<StreamChunk>) {
          // Text delta is `chunk.text - lastText` since `chunk.delta` may
          // be empty on tool-call-only chunks.
          if (chunk.text.length > lastText.length) {
            const newDelta = chunk.text.slice(lastText.length);
            lastText = chunk.text;
            if (newDelta) {
              if (firstDeltaAt === undefined) firstDeltaAt = Date.now();
              yield { kind: 'text-delta', delta: newDelta };
            }
          }
          if (chunk.toolCalls) {
            for (const tc of chunk.toolCalls) {
              if (yieldedToolIds.has(tc.id)) continue;
              // Only surface a tool call when it has a name + parsable args.
              if (!tc.name) continue;
              yieldedToolIds.add(tc.id);
              yield { kind: 'tool-call', call: tc };
            }
          }
          if (chunk.error) throw chunk.error;
        }
        // After iteration, await the handle (already resolved) to grab
        // usage. Closure state is frozen at this point so the read is safe.
        try {
          const final = await (handle as unknown as Promise<CompleteResult>);
          usage = final.usage;
        } catch { /* error already surfaced via chunk.error above */ }
      } else {
        const result = await llm.complete({ ...completeOpts, signal: composedSignal });
        if (result.content) {
          if (firstDeltaAt === undefined) firstDeltaAt = Date.now();
          yield { kind: 'text-delta', delta: result.content };
        }
        if (result.toolCalls) {
          for (const tc of result.toolCalls) yield { kind: 'tool-call', call: tc };
        }
        usage = result.usage;
      }
    } finally {
      clearTimeout(timer);
      const endedAt = Date.now();
      if (this.llmCallListener && firstDeltaAt !== undefined) {
        const ttftMs = firstDeltaAt - startedAt;
        const durationMs = endedAt - startedAt;
        try {
          this.llmCallListener({
            role,
            ttftMs,
            durationMs,
            outputTokens: usage?.completionTokens,
            inputTokens: usage?.promptTokens,
            model: modelId,
          });
        } catch { /* listener errors must never break the agent loop */ }
      }
    }
  }

  // ─── confirm-gate decision ─────────────────────────────────────

  private async needsConfirmation(
    toolCall: ToolCall,
    matched: ActionDefinition | undefined,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (!this.session) return false;
    const explicit = matched?.requireConfirmation;
    if (explicit === false) return false;
    if (explicit === true) return true;
    if (typeof explicit === 'function') {
      try {
        return await explicit(toolCall.arguments as never, {
          session: this.session,
          signal,
          resolveTarget: (target: string | number) => {
            if (typeof target === 'number') return this.currentIndexMap.get(String(target)) ?? null;
            const trimmed = target.trim();
            const m = /^\[?([A-Za-z0-9_-]+)\]?$/.exec(trimmed);
            if (m) {
              const el = this.currentIndexMap.get(m[1]!);
              if (el) return el;
            }
            try { return document.querySelector(trimmed); } catch { return null; }
          },
        });
      } catch {
        return true; // fail-safe
      }
    }
    return isDestructiveByPattern(toolCall.name, this.destructivePatterns);
  }

  // ─── messages assembly ─────────────────────────────────────────

  /** Last DOM index map from readDOM — used by action handlers to
   *  resolve `[id]` style hash targets back to live elements. */
  private currentIndexMap: Map<string, Element> = new Map();

  private async buildMessages(): Promise<LLMMessage[]> {
    if (!this.session) return [];

    const domResult = readDOM({
      filter: this.config.domFilter,
      maxLength: this.config.domMaxLength,
    });
    const pageContext = domResult.text;
    this.currentIndexMap = domResult.indexMap;

    // Optional screenshot — silently no-ops when disabled, when the
    // peer dependency isn't installed, or when capture throws. The loop
    // continues text-only.
    let screenshotImages: string[] = [];
    if (this.config.screenshot) {
      const sCfg: ScreenshotConfig = this.config.screenshot === true
        ? { mode: 'viewport' }
        : this.config.screenshot;
      try {
        screenshotImages = await captureScreenshots(sCfg);
      } catch {
        screenshotImages = [];
      }
    }

    const toolReference = this.config.cotMode
      ? renderToolReference(this.buildCotToolRefs())
      : undefined;

    const systemPrompt = assembleSystemPrompt({
      locale: this.config.locale,
      agentName: this.config.agentName,
      siteName: this.config.siteName,
      systemPrompt: this.config.systemPrompt,
      brand: this.config.brand,
      persona: this.config.persona,
      appendSystemPrompt: this.config.appendSystemPrompt,
      sitemap: this.config.sitemap,
      session: this.session,
      pageContext,
      selection: this.currentSelection ?? undefined,
      previousUrl: undefined,
      cotMode: this.config.cotMode,
      toolReference,
    });

    const messages: LLMMessage[] = [{ role: 'system', content: systemPrompt }];

    // (Continued below — messages get fully assembled then exposed for
    // debug at the end. See window.__dddkDebug.lastLlmMessages.)

    // History capping. Two orthogonal limits:
    //   - `maxTurnsInPrompt`: count-based slice (cheap, predictable)
    //   - `maxPromptTokens` : token-budget walk from newest backward
    // Both default to off. When both are set, count-cap runs first
    // then token-cap trims further if still over.
    //
    // Leading non-user turns are stripped — LLM APIs (OpenAI, DeepSeek)
    // reject conversations that start with an orphan assistant / tool
    // message right after the system prompt.
    let turnsToSerialize: AgentTurn[] = this.session.turns;
    const turnLimit = this.config.maxTurnsInPrompt;
    if (turnLimit && turnLimit > 0 && turnsToSerialize.length > turnLimit) {
      turnsToSerialize = turnsToSerialize.slice(-turnLimit);
    }
    const tokenLimit = this.config.maxPromptTokens;
    if (tokenLimit && tokenLimit > 0 && turnsToSerialize.length > 0) {
      // Reserve ~3000 tokens for the system prompt + env block. The
      // remaining budget is split across turns starting from newest.
      const baseReserve = 3000;
      let budgetChars = (tokenLimit - baseReserve) * CHARS_PER_TOKEN;
      const kept: AgentTurn[] = [];
      for (let i = turnsToSerialize.length - 1; i >= 0; i--) {
        const t = turnsToSerialize[i]!;
        const c = estimateTurnChars(t);
        if (budgetChars - c < 0 && kept.length > 0) break;
        kept.unshift(t);
        budgetChars -= c;
      }
      turnsToSerialize = kept;
    }
    const firstUserIdx = turnsToSerialize.findIndex((t) => t.kind === 'user');
    if (firstUserIdx > 0) {
      turnsToSerialize = turnsToSerialize.slice(firstUserIdx);
    }

    // Walk turns in order.
    for (const turn of turnsToSerialize) {
      if (turn.kind === 'user') {
        const parts: string[] = [turn.text];
        if (turn.selection) parts.push(renderSelectionBlock(turn.selection));
        // For the user turn that carries images (from spotter screenshot),
        // attach them as content parts.
        const images = turn.selection?.images ?? [];
        if (images.length > 0) {
          messages.push({
            role: 'user',
            content: [
              { type: 'text', text: parts.join('\n\n') },
              ...images.map((img: string) => ({ type: 'image' as const, image: img })),
            ],
          });
        } else {
          messages.push({ role: 'user', content: parts.join('\n\n') });
        }
      } else if (turn.kind === 'agent_step') {
        messages.push({
          role: 'assistant',
          content: turn.preText ?? '',
          toolCalls: [{
            id: turn.toolCallId,
            name: turn.toolCall.name,
            arguments: turn.toolCall.arguments,
          }],
        });
        messages.push({
          role: 'tool',
          toolCallId: turn.toolCallId,
          name: turn.toolCall.name,
          content: JSON.stringify(turn.result),
        });
      } else if (turn.kind === 'agent_final') {
        messages.push({ role: 'assistant', content: turn.text });
      }
    }

    // Per-turn environment block: current page state + fresh DOM dump.
    // Appended as the LAST user message so the model always re-grounds on
    // the latest reality before its next emission. In classic (non-CoT)
    // mode the legacy reminder + sitemap still ride along; in CoT mode
    // both live on the system prompt and the env block stays minimal.
    const envParts: string[] = [];
    if (!this.config.cotMode) {
      if (this.config.sitemap) envParts.push(renderSitemap(this.config.sitemap));
      const latestUser = lastUserTurn(this.session);
      envParts.push(renderUserReminder({
        latestUserText: latestUser?.text ?? '',
        stepsSoFar: this.session.turns,
        currentUrl: this.session.currentPage,
        cotMode: false,
      }));
    }
    envParts.push(renderPageStateBlock({
      currentPage: this.session.currentPage,
      pageContext,
      plan: this.session.plan,
    }));
    const envText = envParts.join('\n\n');
    if (screenshotImages.length > 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: envText },
          ...screenshotImages.map((img) => ({ type: 'image' as const, image: img })),
        ],
      });
    } else {
      messages.push({ role: 'user', content: envText });
    }

    // Debug exposure — every LLM call records its full message array so
    // a developer can pop devtools and inspect what the model literally
    // saw: `window.__dddkDebug.lastLlmMessages`. Especially useful when
    // diagnosing "the agent said it saw no content" — you can verify
    // the DOM dump made it into the payload.
    if (typeof window !== 'undefined') {
      const w = window as unknown as { __dddkDebug?: { lastLlmMessages?: unknown; lastLlmAt?: string } };
      w.__dddkDebug = w.__dddkDebug ?? {};
      w.__dddkDebug.lastLlmMessages = messages;
      w.__dddkDebug.lastLlmAt = new Date().toISOString();
    }

    return messages;
  }

  /**
   * Resolve the effective description for an action, applying any
   * `actionOverrides` entry. Hard `description` wins over
   * `appendDescription`; both unset returns the SDK default verbatim.
   *
   * Centralised so CoT (`buildCotToolRefs`) and classic (`buildToolDefinitions`)
   * paths can't drift in override behaviour.
   */
  private resolveActionDescription(action: ActionDefinition): string {
    const ov = this.config.actionOverrides?.[action.name];
    if (!ov) return action.description;
    if (typeof ov.description === 'string') return ov.description;
    if (typeof ov.appendDescription === 'string' && ov.appendDescription.length > 0) {
      return action.description + '\n' + ov.appendDescription;
    }
    return action.description;
  }

  /**
   * Build the CoT tool reference list once per turn. Shared by:
   *   - `buildToolDefinitions()` — wraps refs in a single `agent_turn` tool
   *   - `buildMessages()` — renders refs as the system prompt's `# Tools`
   *
   * Skipped from the model's tool reference:
   *   - `pause` — CoT auto-pauses after every narrate; exposing the tool
   *     invites double-pauses.
   *   - `border` — element framing is done structurally via `narrate.about`
   *     (runtime auto-borders). Exposing the standalone tool creates two
   *     ways to do the same thing and the model picks inconsistently.
   *
   * The actions still live in `this.actions` so internal dispatch
   * (narrate.about, legacy executeLoop, host customActions) keeps working.
   *
   * Per-action `actionOverrides` are applied so the model sees host-
   * customised descriptions instead of (or appended to) the SDK defaults.
   */
  private buildCotToolRefs(): CotToolRef[] {
    const refs: CotToolRef[] = [];
    for (const action of this.actions.values()) {
      if (action.name === 'pause' || action.name === 'border') continue;
      refs.push({
        name: action.name,
        description: this.resolveActionDescription(action),
        parameters: action.parameters,
      });
    }
    return refs;
  }

  private hasPlan(): boolean {
    return !!this.session?.plan;
  }

  private buildToolDefinitions(): ToolDefinition[] {
    if (this.config.toolDefinitions) return this.config.toolDefinitions;

    if (this.config.cotMode) {
      return [buildAgentTurnTool(this.buildCotToolRefs(), { planned: this.hasPlan() })];
    }

    // Classic (non-CoT) mode: each action becomes a top-level tool.
    // Same override policy as CoT.
    const defs: ToolDefinition[] = [];
    for (const action of this.actions.values()) {
      defs.push({
        name: action.name,
        description: this.resolveActionDescription(action),
        parameters: action.parameters,
      });
    }
    return defs;
  }

  // ─── status + persistence helpers ──────────────────────────────

  private setStatus(status: AgentStatus): void {
    if (!this.session) return;
    if (this.session.status === status) return;
    this.session.status = status;
    this.persistSession();
  }

  private persistSession(): void {
    if (!this.session) return;
    saveSession(this.session, this.config.sessionStorageKey);
    publishCrossTab(this.session, this.crossTabKey, this.broadcastChannel);
  }
}

// ─── helpers ────────────────────────────────────────────────────────

function extractTargetSelector(params: Record<string, unknown>): string | undefined {
  for (const key of ['selector', 'target', 'element']) {
    const v = params[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/**
 * SDK-default confirmation copy for built-in actions. Bundled in
 * en + zh-TW (via `sdk-i18n`); other locales fall back to en. Hosts
 * that ship other languages override at the config level via
 * `WebAgentConfig.buildConfirmMessage(action, params, locale)`, or
 * per-action via `ActionDefinition.confirmationMessage(params)`.
 */
function narrateAction(
  actionName: string,
  params: Record<string, unknown>,
  locale: string,
): string {
  const str = (k: string): string => (typeof params[k] === 'string' ? (params[k] as string) : '');
  const trim = (s: string, n = 40): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const path = trim(str('path'), 50);
  const target = trim(str('selector') || str('target') || str('element'), 50);
  const suffix = ` ${sdkString(locale, 'agent.confirm.suffix')}`;
  switch (actionName) {
    case 'navigate':
      return (path
        ? sdkString(locale, 'agent.confirm.navigate.with_path', { path })
        : sdkString(locale, 'agent.confirm.navigate.no_path')) + suffix;
    case 'click':
      return (target
        ? sdkString(locale, 'agent.confirm.click.with_target', { target })
        : sdkString(locale, 'agent.confirm.click.no_target')) + suffix;
    case 'fill_input':
      return (target
        ? sdkString(locale, 'agent.confirm.fill_input.with_target', { target })
        : sdkString(locale, 'agent.confirm.fill_input.no_target')) + suffix;
    case 'delete':
      return (target
        ? sdkString(locale, 'agent.confirm.delete.with_target', { target })
        : sdkString(locale, 'agent.confirm.delete.no_target')) + suffix;
    default:
      return (target
        ? sdkString(locale, 'agent.confirm.generic.with_target', { action: actionName, target })
        : sdkString(locale, 'agent.confirm.generic.no_target', { action: actionName })) + suffix;
  }
}

/**
 * Wait for an SPA navigation to "settle" — both the URL has changed AND
 * the DOM has stopped mutating for a short idle window. Returns when:
 *   1. A MutationObserver on `body` has gone quiet for `idleMs` (default
 *      250ms — long enough for framework route-transition re-render to
 *      flush, short enough to keep latency low), OR
 *   2. The hard `maxMs` ceiling fires (default 2500ms — covers a
 *      code-split chunk on a slow connection).
 *
 * Without this, `readDOM` on the next turn often reads the OLD page or
 * a half-rendered new page (just the route shell with headings) — which
 * shows up as the agent saying "I only see the title, no content".
 */
/**
 * `true` when the user currently has focus on an editable surface
 * INSIDE the open command palette specifically. Used by the CoT
 * auto-pause to skip the "press Space to continue" gate ONLY in that
 * narrow case.
 *
 * Why scope it to palette and not all inputs: the space-gesture handler
 * intercepts Space inside any input as literal typing, so the pause
 * watcher would never resolve. Skipping in any input would mean the
 * agent never waits if the user happens to have focus on a page form
 * field — which is the wrong behaviour for normal page forms (the user
 * expects to click outside or blur the field, then Space advances the
 * agent like usual).
 *
 * Palette is the one place where "user has focus in input + agent is
 * mid-run" is the explicit, persistent state. So scope the skip there.
 */
function isUserEditingInPalette(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
  if (!isEditable) return false;
  // Must be inside the open palette panel — keyed by the data-dddk-ui
  // attribute the palette stamps on its root.
  return !!el.closest('[data-dddk-ui="palette"]');
}

async function awaitNavSettle(maxMs: number): Promise<void> {
  if (typeof window === 'undefined') return;
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    // No observer → fall back to a fixed wait.
    await new Promise<void>((r) => setTimeout(r, Math.min(maxMs, 1200)));
    return;
  }
  const idleMs = 250;
  await new Promise<void>((resolve) => {
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (idleTimer !== null) clearTimeout(idleTimer);
      clearTimeout(hardCap);
      resolve();
    };
    const resetIdle = (): void => {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, idleMs);
    };
    const observer = new MutationObserver(resetIdle);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const hardCap = setTimeout(finish, maxMs);
    // Prime the idle timer in case no mutation fires (the route is
    // already cached and renders synchronously).
    resetIdle();
  });
  await new Promise<void>((r) => {
    if (typeof requestAnimationFrame === 'undefined') return r();
    requestAnimationFrame(() => r());
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function composeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  const onA = (): void => ctrl.abort(a.reason);
  const onB = (): void => ctrl.abort(b.reason);
  if (a.aborted) ctrl.abort(a.reason);
  else a.addEventListener('abort', onA, { once: true });
  if (b.aborted) ctrl.abort(b.reason);
  else b.addEventListener('abort', onB, { once: true });
  return ctrl.signal;
}

async function* emptyStream(): AsyncIterable<AgentEvent> {
  return;
}

/**
 * Coarse chars-per-token approximation across mixed CJK + English.
 * - English / code: ~4 chars per token
 * - Han / Kana   : ~1.5–2 chars per token (one CJK char ≈ 1 token in BPE)
 * 3.5 averages the two; the truncation uses this only to decide which
 * turn to drop, so close-enough beats precise.
 */
const CHARS_PER_TOKEN = 3.5;

/** Cost estimate for one session turn, used by the token-budget
 *  truncation in buildMessages. Image content parts get a flat
 *  ~1000 token charge (vendors vary; this is a safe upper bound). */
function estimateTurnChars(t: AgentTurn): number {
  if (t.kind === 'user') {
    let n = t.text.length;
    if (t.selection?.text) n += t.selection.text.length;
    if (t.selection?.elements) n += t.selection.elements.join(' ').length;
    if (t.selection?.images) n += t.selection.images.length * 3500;
    return n + 50;
  }
  if (t.kind === 'agent_step') {
    return (t.preText?.length ?? 0)
      + JSON.stringify(t.toolCall.arguments).length
      + JSON.stringify(t.result).length
      + 200; // tool_call + tool message envelope overhead
  }
  if (t.kind === 'agent_final') return t.text.length + 20;
  return 0;
}

/**
 * Scan the message array for any image content part. Used to decide
 * whether to route this turn to a vision-capable provider
 * (`webagentWithSelection`) or the text-only main one.
 */
function messageContentHasImage(messages: LLMMessage[]): boolean {
  for (const m of messages) {
    if (typeof m.content === 'string') continue;
    for (const part of m.content) {
      if (part.type === 'image') return true;
    }
  }
  return false;
}
