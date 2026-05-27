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
import type { LLMMessage, ToolDefinition, ToolCall } from '../llm/types';
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
import { builtinActions } from './actions';
import { readDOM } from './dom-reader';
import { captureScreenshots, type ScreenshotConfig } from './screenshot';
import { setupCrossTabSync, publishCrossTab } from './cross-tab';
import { executeAction } from './execute-action';
import { DEFAULT_DESTRUCTIVE_PATTERNS, isDestructiveByPattern } from './destructive';

const DEFAULT_MAX_STEPS = 30;
const DEFAULT_MAX_ERRORS = 3;
const DEFAULT_LLM_TIMEOUT_MS = 60_000;
const DEFAULT_CONTINUITY_MS = 5 * 60 * 1000;

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
  /** Host signalled "end continuity now" — next runStream() starts fresh. */
  private continuityEnded = false;

  constructor(config: WebAgentConfig) {
    this.config = {
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
      ...config,
    };

    for (const action of builtinActions) this.actions.set(action.name, action);
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

  /** Set by the orchestrator — called when the agent picks `navigate`.
   *  Hosts may return a Promise (most SPA routers do); the webagent
   *  awaits it before declaring the navigation complete. */
  setNavigateBridge(fn: (path: string) => void | Promise<void>): void {
    this.navigateBridge = fn;
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
    if (typeof target === 'number') return this.currentIndexMap.get(target) ?? null;
    if (typeof target !== 'string') return null;
    const trimmed = target.trim();
    const m = /^[↑↓]?\s*\[?(\d+)\]?$/.exec(trimmed);
    if (m) {
      const idx = parseInt(m[1]!, 10);
      const el = this.currentIndexMap.get(idx);
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
    return this.executeLoop(this.currentAbort.signal);
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
        const message = matched?.confirmationMessage?.(toolCall.arguments as never)
          ?? narrateAction(toolCall.name, toolCall.arguments);
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
            session: this.session,
            defaultPauseNote: this.config.defaultPauseNote,
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

    // maxSteps hit.
    this.setStatus('failed');
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
    };

    const streamProvider = llm as unknown as StreamingProvider;
    const hasStreaming = typeof streamProvider.streamComplete === 'function';

    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort('llm timeout'), this.config.llmTimeoutMs);
    const composedSignal = composeSignals(signal, timeoutCtrl.signal);

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
            if (newDelta) yield { kind: 'text-delta', delta: newDelta };
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
      } else {
        const result = await llm.complete({ ...completeOpts, signal: composedSignal });
        if (result.content) yield { kind: 'text-delta', delta: result.content };
        if (result.toolCalls) {
          for (const tc of result.toolCalls) yield { kind: 'tool-call', call: tc };
        }
      }
    } finally {
      clearTimeout(timer);
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
            if (typeof target === 'number') return this.currentIndexMap.get(target) ?? null;
            const trimmed = target.trim();
            const m = /^\[?(\d+)\]?$/.exec(trimmed);
            if (m) {
              const idx = parseInt(m[1]!, 10);
              const el = this.currentIndexMap.get(idx);
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
   *  resolve `[N]` style numeric targets back to live elements. */
  private currentIndexMap: Map<number, Element> = new Map();

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

    const systemPrompt = assembleSystemPrompt({
      locale: this.config.locale,
      agentName: this.config.agentName,
      siteName: this.config.siteName,
      systemPrompt: this.config.systemPrompt,
      brand: this.config.brand,
      appendSystemPrompt: this.config.appendSystemPrompt,
      sitemap: this.config.sitemap,
      session: this.session,
      pageContext,
      selection: this.currentSelection ?? undefined,
      previousUrl: undefined,
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

    // Per-turn environment block: sitemap + reminder + current page state.
    // Appended as the LAST user message so the model always re-grounds on
    // the latest reality before its next emission.
    const envParts: string[] = [];
    if (this.config.sitemap) envParts.push(renderSitemap(this.config.sitemap));
    const latestUser = lastUserTurn(this.session);
    envParts.push(renderUserReminder({
      latestUserText: latestUser?.text ?? '',
      stepsSoFar: this.session.turns,
      currentUrl: this.session.currentPage,
    }));
    envParts.push(renderPageStateBlock({
      currentPage: this.session.currentPage,
      pageContext,
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

  private buildToolDefinitions(): ToolDefinition[] {
    if (this.config.toolDefinitions) return this.config.toolDefinitions;
    const defs: ToolDefinition[] = [];
    for (const action of this.actions.values()) {
      defs.push({
        name: action.name,
        description: action.description,
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
 * SDK-default confirmation copy for built-in actions. English-only by
 * design; hosts that want localised or fully custom prompts override
 * per-action via `ActionDefinition.confirmationMessage(params)`.
 */
function narrateAction(
  actionName: string,
  params: Record<string, unknown>,
): string {
  const str = (k: string): string => (typeof params[k] === 'string' ? (params[k] as string) : '');
  const trim = (s: string, n = 40): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const path = trim(str('path'), 50);
  const target = trim(str('selector') || str('target') || str('element'), 50);
  switch (actionName) {
    case 'navigate':    return path ? `Take you to ${path} — press space to confirm` : 'Switch page — press space to confirm';
    case 'click':       return target ? `Click ${target} — press space to confirm` : 'Click — press space to confirm';
    case 'fill_input':  return `Fill ${target || 'field'} — press space to confirm`;
    case 'delete':      return `Delete ${target} — press space to confirm`;
    default:            return `Run ${actionName}${target ? ` → ${target}` : ''} — press space to confirm`;
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
