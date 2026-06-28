/**
 * WebAgent — DOM-grounded narrator agent.
 *
 * Public surface: constructor / configure (via setter helpers) / runStream
 * / continueStream / resumeStream / session lifecycle / handler setters.
 *
 * Loop bodies, message assembly, and `__dddkDebug` writes live under
 * ./runtime so this file stays focused on state + public API. The runtime
 * modules consume the agent through `@internal` accessors below.
 */

import type {
  WebAgentConfig,
  AgentSession,
  AgentEvent,
  ActionDefinition,
  RunOptions,
  SelectionContext,
  AgentStatus,
} from './types';
import type { ToolDefinition, ToolCall } from '../llm/types';
import {
  createSession,
  loadSession,
  saveSession,
  clearSession,
  pushUserTurn,
  isSessionLive,
  shouldAutoResume,
  DEFAULT_SESSION_KEY,
} from './session';
import { builtinActions, presentSurface } from './actions';
import { setupCrossTabSync, publishCrossTab } from './cross-tab';
import { DEFAULT_DESTRUCTIVE_PATTERNS, isDestructiveByPattern } from './destructive';
import {
  buildAgentTurnTool,
  type CotToolRef,
} from './cot';
import type {
  AskUserPayload,
  AskUserChoicePayload,
  PausePayload,
  PresentSurfacePayload,
} from './execute-action';
import { executeLoop, executeCotLoop } from './runtime/loops';
import { emptyStream } from './runtime/helpers';

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
  role: 'webagent' | 'vision';
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

type ResolvedConfig = WebAgentConfig & Required<Pick<
  WebAgentConfig,
  'locale' | 'maxSteps' | 'maxErrors' | 'llmTimeoutMs' | 'agentName' |
  'sessionStorageKey' | 'sessionContinuityMs' | 'sessionScope'
>>;

export class WebAgent {
  /** @internal */ config: ResolvedConfig;
  /** @internal */ actions: Map<string, ActionDefinition> = new Map();
  /** @internal */ session: AgentSession | null = null;
  /**
   * True when the host injected a `session` via config — disables
   * the agent's own auto-create / auto-load + auto-persist paths
   * because the session is owned upstream (typically `dddk.sessions`).
   * @internal
   */
  private sessionInjected = false;
  /** @internal */ currentSelection: SelectionContext | null = null;
  /** @internal */ currentIndexMap: Map<string, Element> = new Map();
  /** @internal */ navigateBridge: ((path: string) => void | Promise<void>) | null = null;
  /** @internal */ llmCallListener: ((info: LlmCallInfo) => void) | null = null;
  /** @internal */ askUserHandler: ((payload: AskUserPayload) => void) | null = null;
  /** @internal */ askUserChoiceHandler: ((payload: AskUserChoicePayload) => void) | null = null;
  /** @internal */ pauseHandler: ((payload: PausePayload) => void) | null = null;
  /** @internal */ surfaceMounter: ((payload: PresentSurfacePayload) => void) | null = null;

  private currentAbort: AbortController | null = null;
  private pendingResolvers: Map<string, (raw: string) => void> = new Map();
  private pendingOrder: string[] = [];
  private broadcastChannel: BroadcastChannel | null = null;
  private crossTabKey: string;
  private pendingCounter = 0;
  private destructivePatterns: RegExp[];
  /** Host signalled "end continuity now" — next runStream() starts fresh. */
  private continuityEnded = false;

  constructor(config: WebAgentConfig) {
    // Spread input FIRST so the defaults below win for any property the
    // host left undefined. Locale auto-detect from navigator.language is
    // a starting guess only; the prompt's language framing makes the
    // user's actual input language override the hint every turn.
    this.config = {
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

    // Tool exclusion: legacy `disableBuiltinActions` is an alias for the
    // new `excludeTools` field as of v0.2.0. Union both sets.
    const excluded = new Set([
      ...(config.disableBuiltinActions ?? []),
      ...(config.excludeTools ?? []),
    ]);
    if (
      typeof console !== 'undefined' &&
      config.disableBuiltinActions !== undefined &&
      config.disableBuiltinActions.length > 0
    ) {
      // One-line deprecation notice. Removed in v0.3.0.
      console.warn(
        '[dddk] `disableBuiltinActions` is deprecated since v0.2.0; rename to `excludeTools` (and consider `disableAutoPauseAfterNarrate` to control the runtime auto-pause separately).',
      );
    }
    for (const action of builtinActions) {
      if (!excluded.has(action.name)) this.actions.set(action.name, action);
    }
    // present_surface is opt-in: registered only when the host enables it
    // AND wires setSurfaceMounter. Still honours the exclusion set.
    if (config.allowPresent && !excluded.has(presentSurface.name)) {
      this.actions.set(presentSurface.name, presentSurface as ActionDefinition);
    }
    for (const action of config.customActions ?? []) this.actions.set(action.name, action);

    this.destructivePatterns = config.destructivePatterns ?? DEFAULT_DESTRUCTIVE_PATTERNS;

    // Host injected a shared session — adopt it as the initial session
    // and stop the agent from auto-loading / auto-replacing it. This is
    // the entry point for multi-instance session sharing.
    if (config.session) {
      this.session = config.session;
      this.sessionInjected = true;
    }

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

  /** Update the locale used for confirmation copy + system-prompt output
   *  language hint. The currently-running turn keeps its prompt; the next
   *  turn picks up the new locale. */
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
    // Injected mode: don't touch localStorage — the registry persists.
    if (!this.sessionInjected) {
      clearSession(this.config.sessionStorageKey);
    }
  }

  /**
   * Resolve a tool-call selector argument to a live element. Accepts
   * either a numeric index from the latest indexed DOM dump (`3` /
   * `"3"` / `"[3]"` / `"↓3"`) or a CSS selector string. Returns null
   * for invalid CSS, unknown indexes, or pre-DOM (SSR) environments.
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
      this.persistSessionInternal();
    }
  }

  /**
   * Soft stop the loop while keeping the session "live" so the next
   * runStream(task) appends to it as a follow-up turn instead of starting
   * fresh. Use when the user interrupts the agent to deliver a NEW prompt
   * mid-task (palette open, voice hold) — naturally a continuation even
   * if the prior task was abandoned.
   *
   * Differs from `stop()`: status is set to `waiting` (which counts as
   * live in `isSessionLive`) instead of `idle`, so a host with
   * `sessionContinuityMs: 0` still gets continuity across the intentional
   * interrupt.
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
      this.persistSessionInternal();
    }
  }

  destroy(): void {
    this.stop();
    this.broadcastChannel?.close();
    this.broadcastChannel = null;
  }

  /** Resolve the oldest pending host interaction (ask_user / ask_user_choice). */
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
   * window AND `opts.freshSession` is not set, the task is appended as
   * a follow-up user turn to the existing session instead.
   */
  runStream(task: string, opts: RunOptions = {}): AsyncIterable<AgentEvent> {
    const currentPath = typeof location !== 'undefined' ? location.pathname + location.search : '/';

    // Continuity / fresh-session logic only applies to agents that own
    // their own session. Injected sessions are upstream-owned: the
    // host (or `dddk.sessions.reset`) decides when a session ends,
    // not this agent. We still respect an explicit `opts.freshSession`
    // — that's a per-call override the host can pass through.
    const fresh = this.sessionInjected
      ? opts.freshSession === true || !this.session
      : opts.freshSession === true || this.continuityEnded ||
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
    this.persistSessionInternal();

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
      // Injected mode skips the localStorage lookup — the registry
      // owns the session and will have already wired one in.
      if (this.sessionInjected) return emptyStream();
      const saved = loadSession(this.config.sessionStorageKey);
      if (!saved) return emptyStream();
      this.session = saved;
    }
    const currentPath = typeof location !== 'undefined' ? location.pathname + location.search : '/';
    if (!shouldAutoResume(this.session, currentPath)) return emptyStream();
    return this.startLoop();
  }

  // ─── handler wiring ─────────────────────────────────────────────

  /** Orchestrator wires the UI route for ask_user. */
  setAskUserHandler(fn: (payload: AskUserPayload) => void): void {
    this.askUserHandler = fn;
  }
  setAskUserChoiceHandler(fn: (payload: AskUserChoicePayload) => void): void {
    this.askUserChoiceHandler = fn;
  }
  /** Orchestrator wires the UI route for the `pause` tool. Default
   *  behaviour (no handler set) falls back to the ask_user envelope. */
  setPauseHandler(fn: (payload: PausePayload) => void): void {
    this.pauseHandler = fn;
  }
  /** Orchestrator wires the host mounter for `present_surface`. The
   *  mounter receives a PieceSurface + placement and renders the surface,
   *  calling `resolve({ value, cancelled })` once the user picks or
   *  dismisses. Only consulted when `allowPresent: true`. */
  setSurfaceMounter(fn: (payload: PresentSurfacePayload) => void): void {
    this.surfaceMounter = fn;
  }

  // ─── loop dispatch ──────────────────────────────────────────────

  private startLoop(): AsyncIterable<AgentEvent> {
    this.currentAbort = new AbortController();
    return this.config.cotMode
      ? executeCotLoop(this, this.currentAbort.signal)
      : executeLoop(this, this.currentAbort.signal);
  }

  // ─── runtime-shared internals ───────────────────────────────────
  // The runtime/* modules access these through their `*Ref` aliases
  // declared below so the names stay short there without leaking into
  // the public class API.

  /** @internal */ get sessionRef(): AgentSession | null { return this.session; }
  /** @internal */ get configRef(): ResolvedConfig { return this.config; }
  /** @internal */ get actionsRef(): Map<string, ActionDefinition> { return this.actions; }
  /** @internal */ get currentSelectionRef(): SelectionContext | null { return this.currentSelection; }
  /** @internal */ get navigateBridgeRef(): ((path: string) => void | Promise<void>) | null { return this.navigateBridge; }
  /** @internal */ get llmCallListenerRef(): ((info: LlmCallInfo) => void) | null { return this.llmCallListener; }
  /** @internal */ get askUserHandlerRef(): ((payload: AskUserPayload) => void) | null { return this.askUserHandler; }
  /** @internal */ get askUserChoiceHandlerRef(): ((payload: AskUserChoicePayload) => void) | null { return this.askUserChoiceHandler; }
  /** @internal */ get pauseHandlerRef(): ((payload: PausePayload) => void) | null { return this.pauseHandler; }
  /** @internal */ get surfaceMounterRef(): ((payload: PresentSurfacePayload) => void) | null { return this.surfaceMounter; }

  /** @internal */
  setStatusInternal(status: AgentStatus): void {
    if (!this.session) return;
    if (this.session.status === status) return;
    this.session.status = status;
    this.persistSessionInternal();
  }

  /** @internal */
  persistSessionInternal(): void {
    if (!this.session) return;
    // Injected sessions are owned by `dddk.sessions` (or the host
    // directly) — persisting per-agent would race a sibling agent's
    // save under the same key. Skip the localStorage write; the
    // upstream session registry is responsible. Cross-tab sync is
    // also disabled in injected mode since the registry mediates.
    if (this.sessionInjected) return;
    saveSession(this.session, this.config.sessionStorageKey);
    publishCrossTab(this.session, this.crossTabKey, this.broadcastChannel);
  }

  /** @internal */
  registerPendingResolverInternal(resolver: (raw: string) => void): string {
    const id = `pr_${++this.pendingCounter}_${Date.now().toString(36)}`;
    this.pendingResolvers.set(id, resolver);
    this.pendingOrder.push(id);
    return id;
  }

  /** @internal */
  async needsConfirmationInternal(
    toolCall: ToolCall,
    matched: ActionDefinition | undefined,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (!this.session) return false;
    if (this.config.disableConfirmations) return false;
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

  /**
   * Resolve the effective description for an action, applying any
   * `actionOverrides` entry. Hard `description` wins over
   * `appendDescription`; both unset returns the SDK default verbatim.
   * Centralised so CoT (`buildCotToolRefs`) and classic (`buildToolDefinitions`)
   * paths can't drift in override behaviour.
   * @internal
   */
  resolveActionDescription(action: ActionDefinition): string {
    const ov = this.config.actionOverrides?.[action.name];
    if (!ov) return action.description;
    if (typeof ov.description === 'string') return ov.description;
    if (typeof ov.appendDescription === 'string' && ov.appendDescription.length > 0) {
      return action.description + '\n' + ov.appendDescription;
    }
    return action.description;
  }

  /**
   * Build the CoT tool reference list once per turn. Skipped from the
   * model's reference:
   *   - `pause` — CoT auto-pauses after every narrate; exposing the tool
   *     invites double-pauses.
   *   - `border` — element framing is done structurally via `narrate.about`
   *     (runtime auto-borders). Exposing the standalone tool creates two
   *     ways to do the same thing and the model picks inconsistently.
   *
   * Actions still live in `this.actions` so internal dispatch
   * (narrate.about, legacy executeLoop, host customActions) keeps working.
   * @internal
   */
  buildCotToolRefs(): CotToolRef[] {
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

  /** @internal */
  buildToolDefinitions(): ToolDefinition[] {
    if (this.config.toolDefinitions) return this.config.toolDefinitions;

    if (this.config.cotMode) {
      return [buildAgentTurnTool(this.buildCotToolRefs(), { planned: !!this.session?.plan })];
    }

    // Classic (non-CoT) mode: each action becomes a top-level tool.
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
}
