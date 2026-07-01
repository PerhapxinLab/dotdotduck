/**
 * @perhapxin/dddk — WebAgent public types.
 *
 * Loop shape: the agent is an async generator that yields `AgentEvent`s
 * (text-delta / tool-start / tool-end / navigated / confirm / final /
 * thinking / error). The orchestrator consumes the stream with a single
 * `for await` and routes each event to its UI slot. No event emitter
 * subscription, no per-step user gate.
 *
 * Session shape: `turns[]` accumulates everything that happened across
 * one logical conversation — user queries, agent's chosen tool calls
 * with results, and final pure-text turns. Multi-turn follow-ups append
 * a new `user` turn to the same session; cross-page resume picks up
 * where the loop left off without dropping prior turns.
 *
 * See ../../docs/01-architecture.md for the design.
 */

import type { ToolDefinition } from '../llm/types';
import type { LLMSource } from '../llm/router';

// ─── Action contracts ───────────────────────────────────────────────

export type ActionFailureReason =
  | 'not_found'
  | 'not_visible'
  | 'not_interactive'
  | 'timeout'
  | 'navigation'
  | 'cancelled'
  | 'user_declined'
  /**
   * the target is in scope the agent can read but
   * not act on — typically a cross-origin iframe or popup. The agent
   * narrates the boundary to the user and may offer to hand off.
   */
  | 'cross_origin'
  /**
   * the route the agent navigated to requires
   * authentication; user must sign in before the agent can proceed.
   */
  | 'auth_required'
  | 'unknown';

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; reason: ActionFailureReason; message?: string };

export interface ActionContext {
  session: AgentSession;
  signal: AbortSignal;
  /**
   * Resolve a selector argument (e.g. `selector`, `target`) to a live
   * element. Accepts either:
   *   - A numeric index from the DOM dump (`"3"` or `"[3]"`) — looked
   *     up in the per-turn index map. This is the preferred form.
   *   - A CSS selector string — passed to `document.querySelector`.
   *
   * Returns `null` when neither resolves. Action handlers use this
   * helper instead of calling `document.querySelector` directly so
   * the indexed-tree contract works uniformly.
   */
  resolveTarget(target: string | number): Element | null;

  /**
   * Visual / UX hints forwarded from `WebAgentConfig`. Actions read these
   * to apply human-paced overlays (synthetic cursor, link-click vs push-
   * state navigate, …) without each handler needing access to the full
   * config object.
   *
   * @since v0.2.0
   */
  uiHints?: {
    cursorTrail?: boolean;
    preferClickLinkOverNavigate?: boolean;
  };
}

export interface ActionDefinition<P = unknown, R = unknown> {
  name: string;
  description: string;
  /** JSON Schema for params. */
  parameters: Record<string, unknown>;
  handler: (params: P, ctx: ActionContext) => Promise<ActionResult<R>>;

  /**
   * If true (or a predicate returning true), the agent pauses before
   * invoking and emits a `confirm` event that the host must `decide()`
   * on. Use for destructive / external-side-effect actions (delete,
   * send email, place order, transfer money). The webagent also
   * auto-marks any action whose name matches a destructive-pattern
   * regex (see `WebAgentConfig.destructivePatterns`); per-action
   * `requireConfirmation: false` can opt out of the pattern match.
   */
  requireConfirmation?: boolean | ((params: P, ctx: ActionContext) => boolean | Promise<boolean>);

  /** Override the confirmation prompt. Return undefined to fall through
   *  to host-level / SDK-default copy. */
  confirmationMessage?: (params: P) => string | undefined;
}

// ─── Selection (captured at run start) ──────────────────────────────

export interface SelectionContext {
  text?: string;
  images?: string[];
  bbox?: { x: number; y: number; width: number; height: number };
  /** CSS selectors / DOM paths the user clicked or multi-selected. */
  elements?: string[];
}

// ─── Live registry — runtime tool + context provider registration ──
// Hosts wire tools / context providers any time;
// the in-flight step finishes on its frozen action snapshot, the
// next step / turn sees the new entry. `remove()` is idempotent.

export interface ToolHandle {
  /** Unregister this tool. After this returns, the next agent step
   *  no longer sees the action. Idempotent — calling twice is fine. */
  remove(): void;
}

/**
 * Names the context provider supplies — they map to the slots the
 * runtime asks for when building a per-turn context. SDK ships
 * defaults for each; hosts can replace any
 * single slot without re-implementing the others.
 */
export type ContextRole =
  | 'url'           // current path + query + hash
  | 'page_summary'  // <title> + meta description
  | 'dom'           // compressed DOM dump
  | 'screenshot'    // viewport image data URL
  | 'history'       // recent navigations
  | 'selection';    // current window.getSelection() context

export interface ContextRequest {
  /** The agent's signal for the current turn (so providers can bail
   *  cheaply when the host cancels). */
  signal: AbortSignal;
  /** Most recent user task / sub-task the agent is operating on. */
  task?: string;
}

/**
 * Pluggable producer for one slot of per-turn context. Returns a
 * string the runtime can splice into the prompt, or `null` to skip
 * the slot entirely (e.g. DOM dump bails on a cross-origin
 * iframe). Async — providers commonly snapshot from the live DOM
 * or call back to the host.
 */
export type ContextProvider = (req: ContextRequest) => string | null | Promise<string | null>;

export interface ContextProviderHandle {
  /** Unregister this context provider. Restores whatever was set
   *  previously for this role (SDK default if no prior override).
   *  Idempotent. */
  remove(): void;
}

// ─── Session model — append-only turn log ───────────────────────────

export interface AgentSession {
  id: string;
  turns: AgentTurn[];
  status: AgentStatus;
  currentPage: string;
  startedAt: number;
  updatedAt: number;
  /** Master plan produced by `WebAgentConfig.planner` at run start, if
   *  any. The webagent's per-turn envelope reads `todos` from here; the
   *  loop mutates via `todo_adjust` (remove / replace operations only). */
  plan?: import('../plan/types').TaskPlan;
}

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'executing'
  | 'waiting'
  | 'navigating'
  | 'done'
  | 'failed';

/** Discriminated union of everything that can land in `session.turns[]`. */
export type AgentTurn =
  | UserTurn
  | AgentStepTurn
  | AgentFinalTurn;

export interface UserTurn {
  kind: 'user';
  ts: number;
  text: string;
  selection?: SelectionContext;
}

export interface AgentStepTurn {
  kind: 'agent_step';
  ts: number;
  /** Free-form text the model emitted *before* picking the tool (streaming). */
  preText?: string;
  toolCall: { name: string; arguments: Record<string, unknown> };
  toolCallId: string;
  result: ActionResult;
}

export interface AgentFinalTurn {
  kind: 'agent_final';
  ts: number;
  text: string;
}

// ─── Agent event stream — what `runStream` / `continueStream` yield ─

export type AgentEvent =
  | { kind: 'thinking' }
  | { kind: 'text-delta'; delta: string }
  | { kind: 'tool-start'; name: string; args: Record<string, unknown>; targetSelector?: string; toolCallId: string }
  | { kind: 'tool-end'; name: string; result: ActionResult; toolCallId: string }
  /** Fired right BEFORE the SPA router is invoked. The page is still
   *  the old one; the host should show a "loading" indicator until
   *  `navigated` arrives. */
  | { kind: 'navigating'; from: string; to: string }
  /** Fired AFTER the router Promise resolved AND the DOM has settled.
   *  The page is now the new one and safe to introspect. */
  | { kind: 'navigated'; from: string; to: string }
  | { kind: 'confirm'; actionName: string; args: Record<string, unknown>; message: string; decide: (approved: boolean) => void }
  | { kind: 'final' }
  | { kind: 'error'; error: Error; retrying: boolean };

// ─── Overlay items (visual highlights on page) ──────────────────────

export type OverlayType = 'highlight' | 'border' | 'spotlight' | 'inject';

export interface OverlayItem {
  id: string;
  type: OverlayType;
  selector: string;
  color?: string;
  label?: string;
  text?: string;
  position?: 'before' | 'after';
}

// ─── Pieces (structured surface envelope) — kept for parity, optional ─

export type PiecePlacement = 'center' | 'inline' | 'dock';

export interface PieceSurface {
  version: 'v0.10';
  updateComponents?: {
    surfaceId: string;
    catalogId?: string;
    components: Array<Record<string, unknown>>;
  };
  updateDataModel?: {
    surfaceId?: string;
    data: Record<string, unknown>;
  };
  deleteSurface?: { surfaceId: string };
  actionResponse?: Record<string, unknown>;
}

// ─── Sitemap ────────────────────────────────────────────────────────

export interface SitemapEntry {
  path: string;
  description: string;
  aliases?: string[];
}

export type SitemapConfig = SitemapEntry[] | import('../sitemap/types').SitemapNode;

// ─── Run options ────────────────────────────────────────────────────

export interface RunOptions {
  /** What the user had selected when they invoked the agent. */
  selection?: SelectionContext;
  /**
   * Force a fresh session even if a live session exists within the
   * continuity window. Set this when the host's UX is "new conversation
   * button pressed" — default behavior (false) appends to the existing
   * session as a follow-up.
   */
  freshSession?: boolean;
}

// ─── End-of-loop closure ────────────────────────────────────────────

/**
 * Behaviour when the agent loop finishes (CoT `actions: []` /
 * classic-mode no-tool-call turn / maxSteps cap). Without an
 * `onLoopEnd` the subtitle bar disappears the moment the loop ends,
 * which reads as broken — there's no signal that the work completed.
 *
 *  - `silent`   — legacy: subtitle just disappears.
 *  - `text`     — stream a final closing line (e.g. "✓ Done") then
 *                 dismiss after `autoHide` ms.
 *  - `feedback` — closing line + Space (satisfied) / double-tap (not) /
 *                 Esc (skipped) gestures, emitted as `agent_feedback`
 *                 on the intent stream.
 *  - `ask_user` — option picker (e.g. 1-5 rating); the chosen value
 *                 flows into `agent_feedback.summary`.
 *
 * SDK default: `{ kind: 'text', text: i18n('agent.done'), autoHide: 3000 }`.
 * Hosts opt into `feedback` / `ask_user` for post-run satisfaction signal.
 */
export type OnLoopEnd =
  | { kind: 'silent' }
  | { kind: 'text'; text: string; autoHide?: number }
  | { kind: 'feedback'; text: string }
  | { kind: 'ask_user'; question: string; options: Array<{ value: string; label: string }> };

// ─── WebAgent config ────────────────────────────────────────────────

export interface WebAgentConfig {
  /** LLM source — single `LLMProvider` or `LLMRouter` (per-role). */
  llm: LLMSource;
  locale?: string;

  /**
   * Optional pre-loop planning callback. When set, the webagent makes a
   * single planning call BEFORE entering the turn loop, expects a
   * `TaskPlan` ({ task_summary, todos[] }), stores it on the session,
   * and switches the per-turn envelope to the planned variant
   * (turn_planning + todo_adjust + actions instead of memory +
   * todos_remaining + actions). Typical wiring is `(input) =>
   * dddk.plan.makeTodos(input)` so the Plan module's strategic
   * appendSystemPrompt drives the plan shape.
   */
  planner?: (input: import('../plan/types').PlanInput) => Promise<import('../plan/types').TaskPlan>;

  /** When true (and `planner` is set), the resulting `task_summary` is
   *  announced to the user via a subtitle bar narrate before the loop
   *  begins. Default false — silent execution. */
  announcePlan?: boolean;
  /**
   * Cap the size of the DOM snapshot fed to the planner. Default 8000
   * chars — enough for a typical page's nav + headings + above-fold
   * content. The planner ALWAYS reads the current DOM (it needs to
   * know which page it's on and what nav links are reachable); this
   * just caps how much it sees. The webagent's per-turn DOM uses
   * `domMaxLength` (default 40000) separately so the loop's eyes
   * stay sharper than the planner's one-shot.
   */
  plannerDomMaxLength?: number;
  /** Hard cap on tool-call iterations per task. Default 30. */
  maxSteps?: number;
  /** Consecutive LLM-call failures before bailing. Default 3. */
  maxErrors?: number;
  /** Single LLM call hard timeout (ms). Default 60_000. */
  llmTimeoutMs?: number;

  /** Reasoning intensity (provider-specific). Default 'off'. */
  thinking?: 'off' | 'low' | 'medium' | 'high';

  /** System prompt override — string hard-replaces; function composes. */
  systemPrompt?: import('./prompt').SystemPromptOverride;
  /** Structured brand context layered into the default prompt. */
  brand?: import('./prompt').BrandPrompt;
  /**
   * First-person identity for the agent — who it IS and on whose behalf
   * it speaks. Without this, the agent narrates the page in third-person
   * observer voice ("the site states X"); with it, the agent speaks as
   * the site's representative ("we offer X").
   *
   * Default: `undefined` (no persona section in the prompt).
   *
   * Pass a string for a quick identity line, or a structured
   * `PersonaConfig` for separate voice / constraint fields:
   *
   *   persona: "You are the dotdotduck assistant, speaking on behalf
   *             of perhapxin. Use 'we' for what perhapxin does."
   *
   *   persona: {
   *     identity: "You are Acme's support assistant...",
   *     voice: "Warm, decisive, never speculative.",
   *     constraints: ["Never promise refunds without confirming with the team."],
   *   }
   */
  persona?: import('./prompt').PersonaInput;
  /** Plain text appended after the default prompt. */
  appendSystemPrompt?: string;

  sitemap?: SitemapConfig;
  agentName?: string;
  siteName?: string;

  customActions?: ActionDefinition[];

  /**
   * Per-action description overrides — applied at tool-build time so the
   * model sees host-customised wording without the SDK shipping rules for
   * every host. Keyed by action name (e.g. `'navigate'`, `'open_palette'`,
   * `'border'`).
   *
   * - `description` — hard replace; the SDK default is dropped entirely.
   * - `appendDescription` — appended after the SDK default with a newline.
   *
   * If both are set, `description` wins. Unknown action names are
   * ignored. Applies to BOTH CoT mode (where the override lands in the
   * system prompt's `# Tools` section) and classic mode (where it lands
   * on the OpenAI tool definition).
   */
  actionOverrides?: Record<string, {
    description?: string;
    appendDescription?: string;
  }>;

  /** sessionStorage key. Default 'webagent.session'. */
  sessionStorageKey?: string;

  /**
   * Inject a shared `AgentSession` instead of letting the agent
   * create + persist its own. Use to share conversation history +
   * memory across multiple WebAgent instances (e.g. different
   * personas per route) so cross-page continuity survives even when
   * the active agent changes. The agent reads + appends to the same
   * object; it does NOT replace the reference on continuity expiry
   * — that's the host's job (via `dddk.sessions.reset(name)`).
   *
   * When set, the agent skips the lazy `createSession` step and the
   * `loadSession` lookup. The host (or `dddk.sessions`) becomes
   * solely responsible for the session's lifecycle. v0.2.
   */
  session?: AgentSession;

  /** Override default tool list (advanced). */
  toolDefinitions?: ToolDefinition[];

  /**
   * Multi-turn continuity. After a turn ends, follow-ups within this
   * window append to the current session as user turns. Older than this
   * and the next `runStream()` starts a fresh session.
   *
   * Default `0` (OFF) — most webagent usage is one-shot ("how do I X?",
   * answer, done); carrying prior turns into a new ask causes the LLM
   * to conflate unrelated questions. Hosts building conversational
   * agents (chat-style follow-ups) opt in by setting e.g.
   * `5 * 60 * 1000`. Cross-PAGE continuity (SPA navigation mid-run)
   * is independent and always on.
   */
  sessionContinuityMs?: number;

  /**
   * Continuity scope — `'time'` (default) honors `sessionContinuityMs`;
   * `'palette'` ends continuity when the palette closes (host signals
   * via `dddk.agent.endContinuity()`).
   */
  sessionScope?: 'time' | 'palette';

  /**
   * Custom destructive-action patterns. An action whose name matches
   * any of these regexes auto-gates on `confirm`. Overrides built-in
   * defaults; pass an empty array to disable the default list and
   * rely only on per-action `requireConfirmation`.
   */
  destructivePatterns?: RegExp[];

  /**
   * When true, no tool call ever pauses for user confirmation — including
   * actions whose `requireConfirmation` is explicitly true. Use on sites
   * where the agent's surface is non-destructive (demos / docs / read-only
   * exploration) and the confirm-pause feels like friction.
   *
   * Per-action `requireConfirmation: true` is still respected for the
   * default destructive-pattern auto-gate when this flag is unset.
   */
  disableConfirmations?: boolean;

  /**
   * Opt the agent in to the `present_surface` tool — lets the model
   * render a PieceSurface (image+text cards, option grids, etc.) and
   * await the user's pick.
   *
   * Default `false` because rich surfaces can leak host-private UI to
   * the model's planning context (the agent decides what image src to
   * use, what option labels to show). Enable when the host wants
   * recommendation-style flows and trusts the brand / persona / prompt
   * to keep the model on-rails.
   *
   * The host MUST ALSO call `agent.setSurfaceMounter(fn)` to wire the
   * actual mounting code — otherwise `present_surface` returns a
   * `not_wired` error and the model falls back to manual narration.
   */
  allowPresent?: boolean;

  /**
   * Force every turn through a structured CoT envelope. The model is
   * required to call a single `agent_turn` tool whose args contain
   * `memory`, `next_goal`, and an ordered `actions[]` of narrations +
   * tool calls. The runtime parses the envelope and dispatches actions
   * in order — fixing the "border-then-skip" failure mode where the
   * classic per-turn-one-tool-call loop can short-circuit early.
   *
   * Default: `false` (classic streaming loop). When `true`, this also
   * disables the per-turn-pause pacing rules in the prompt — pause is
   * runtime-managed (auto-pause after each narration) rather than
   * model-managed.
   */
  cotMode?: boolean;

  /**
   * Override the confirmation copy shown when a `requireConfirmation`
   * action is about to run. Receives the action name + its params and
   * the agent's locale. Return a string to use it; return `undefined`
   * to fall back to the SDK's built-in copy.
   *
   * The SDK ships en + zh-TW. Use this for `ja` / `es` / `fr` etc., or
   * when you want host-branded wording ("Approve the transfer? Press
   * space to confirm").
   *
   *   buildConfirmMessage: (action, params, locale) => {
   *     if (locale === 'ja') {
   *       if (action === 'navigate') return `${params.path} に移動します — スペースキーで確認`;
   *       return undefined;  // fall back to default English for the rest
   *     }
   *     return undefined;
   *   }
   *
   * Per-action `ActionDefinition.confirmationMessage(params)` still
   * wins when set — that override is action-scoped and runs first.
   */
  buildConfirmMessage?: (
    actionName: string,
    params: Record<string, unknown>,
    locale: string,
  ) => string | undefined;

  /**
   * Subtraction filter applied to every visible element the DOM reader
   * considers. Return `false` to drop the element + its subtree from
   * the dump. Use this to keep the agent focused on the host's main
   * content area: filter out site chrome (nav / footer / cookie banner)
   * the agent should never narrate.
   *
   *   domFilter: (el) => !el.matches('nav.global-nav, footer, [data-cookie]')
   *
   * Default: include everything visible.
   */
  domFilter?: (el: Element) => boolean;

  /**
   * Hard cap on the DOM dump size sent to the LLM each turn (in
   * characters). Default ~12000 — large enough to capture a typical
   * marketing / pricing / docs page in full; small enough to keep the
   * per-turn token cost predictable. Hosts with denser pages can bump
   * this; hosts on a budget can shrink it. The reader truncates with a
   * `[...truncated]` marker rather than blowing the budget silently.
   */
  domMaxLength?: number;

  /**
   * Cross-tab session sync via BroadcastChannel + localStorage mirror.
   * Default `false`.
   */
  crossTabSync?: boolean;

  /**
   * Subtitle-bar hint shown when the agent calls `pause` without a
   * `note` argument. The SDK ships an English default — set this in
   * the host's UI language for a localised experience.
   */
  defaultPauseNote?: string;

  /**
   * Hard cap on how many session turns get serialised into each LLM
   * prompt. When the session has more, the oldest turns are dropped
   * and only the most recent `maxTurnsInPrompt` are sent (the system
   * prompt is always kept). Default: undefined (no cap).
   */
  maxTurnsInPrompt?: number;

  /**
   * Token budget for the per-turn LLM prompt. When the assembled
   * prompt exceeds this estimate, the SDK drops the OLDEST turns
   * first and keeps the most recent ones — the system prompt and the
   * env-block / latest-user message are always preserved.
   *
   * The estimate is a coarse char-count → token approximation
   * (mixed CJK + English ~ 3.5 chars per token); not a strict
   * count. Set it well below your model's true context window so
   * there's headroom for the model's own response.
   *
   * Default: undefined (no cap).
   */
  maxPromptTokens?: number;

  /**
   * Attach a screenshot of the current page to every LLM turn alongside
   * the indexed DOM dump. Disabled by default — text-only mode is faster,
   * cheaper, and sufficient for most narration tasks. Turn on when the
   * page has visual content the DOM dump can't convey (charts, custom
   * canvases, complex visual layouts the agent should comment on).
   *
   * Two modes:
   *   - `'viewport'`  — one image of what the user currently sees.
   *   - `'full-page'` — the full scroll height, auto-split into multiple
   *                     images when taller than `maxSegmentHeight`.
   *
   * Requires the `html2canvas` peer dependency (`pnpm add html2canvas`)
   * unless you provide a custom `capture` function. When neither is
   * available the agent runs text-only without erroring.
   */
  screenshot?: boolean | import('./screenshot').ScreenshotConfig;

  /**
   * What happens when the agent loop ends. See `OnLoopEnd` for the
   * union; SDK default is `{ kind: 'text', text: i18n('agent.done'),
   * autoHide: 3000 }` so the subtitle bar doesn't just vanish.
   *
   * Pass `{ kind: 'silent' }` for the legacy "subtitle disappears"
   * behaviour; pass `{ kind: 'feedback', text: ... }` to collect a
   * satisfied / not-satisfied signal via `agent_feedback`.
   */
  onLoopEnd?: OnLoopEnd;

  /**
   * Names of built-in actions to NOT expose to the agent. The default
   * builtin set is intentionally broad (navigate / scroll_to / wait /
   * click / fill_input / select_option / clear_input / border / pause /
   * ask_user / ask_user_choice) so any host works out of the box —
   * but most sites only need a subset. Listing names here removes them
   * from the agent's tool list entirely, which:
   *   1. Shrinks the schema the LLM has to read each turn (fewer tokens).
   *   2. Removes "wrong tool" failure modes (the agent can't pick a tool
   *      that isn't relevant to your site).
   *
   * Example: a marketing demo with no `<select>` elements and a one-shot
   * Q&A style (agent never asks the user) would pass
   * `['pause', 'wait', 'select_option', 'clear_input', 'ask_user', 'ask_user_choice']`.
   *
   * Hosts can still re-add specific actions (or custom ones) via
   * `customActions`, which run AFTER this filter.
   *
   * @deprecated Since v0.2.0. Use `excludeTools` for the same effect,
   * and `disableAutoPauseAfterNarrate` to control the runtime-level
   * pause behaviour. This field stays accepted as an alias to
   * `excludeTools` for one minor version, then is removed in v0.3.0.
   */
  disableBuiltinActions?: string[];

  /**
   * Names of built-in or registered actions to hide from the agent's
   * tool catalog. Equivalent to the older `disableBuiltinActions` —
   * the rename clarifies that the field only filters the LLM-visible
   * catalog, NOT the runtime auto-pause behavior (see
   * `disableAutoPauseAfterNarrate` for that).
   *
   * If both `disableBuiltinActions` and `excludeTools` are set, the
   * union is applied.
   *
   * @since v0.2.0
   */
  excludeTools?: string[];

  /**
   * Stop the runtime from auto-inserting a `pause` after every narrate
   * action in CoT mode. The default behavior is "narrate → pause →
   * wait for Space → next action". Disabling this collapses narrates
   * into a single uninterrupted stream — suitable for hosts whose
   * sites are read-only or whose users expect a chat-style experience
   * with no per-step gating.
   *
   * Note: this is NOT the same as putting `'pause'` in `excludeTools`.
   * `excludeTools: ['pause']` only stops the LLM from calling pause
   * explicitly; the runtime still inserts auto-pauses after narrates.
   * Setting `disableAutoPauseAfterNarrate: true` is what actually
   * removes the gating.
   *
   * Default: `false`.
   *
   * @since v0.2.0
   */
  disableAutoPauseAfterNarrate?: boolean;

  /**
   * Enable the streaming `agent_turn` envelope path (v0.2.0)
   * 1.9). When `true`, the runtime parses tool-call args incrementally
   * as the LLM streams them, so `narrate` strings start appearing in
   * the subtitle bar as the LLM types them — instead of waiting for
   * the entire envelope to complete, then replaying via a local
   * typewriter.
   *
   * Currently EXPERIMENTAL. Requires provider-side support for
   * incremental tool-call args streaming (the bundled
   * `OpenAIProvider` will gain this in a follow-up; until then setting
   * this flag is a no-op for OpenAI). Other providers fall back to the
   * non-streaming path automatically.
   *
   * Default: `false`.
   *
   * @since v0.2.0
   * @experimental
   */
  enableStreamingEnvelope?: boolean;

  /**
   * Synthetic cursor overlay for click actions (v0.2.0 — ROADMAP).
   *
   * When `true`, every `click` action renders a small arrow cursor that
   * slides from its last position to the target element (~360ms), plays
   * a brief tap animation, THEN calls `el.click()`. The actual DOM
   * event is still fired by `el.click()` — the cursor is purely visual.
   *
   * The point is human-paced feedback so users (and demo viewers) see
   * the agent operate the page like a person, rather than buttons
   * getting pressed by an invisible ghost. Respects
   * `prefers-reduced-motion`.
   *
   * Default: `false`. Recommended `true` for marketing demos / screen
   * recordings; either toggle is fine in production.
   */
  cursorTrail?: boolean;

  /**
   * Prefer clicking an `<a href>` over `history.pushState` when the
   * `navigate` action runs (v0.2.0 — ROADMAP).
   *
   * When `true`, before falling back to `history.pushState(target)`,
   * `navigate` looks for a visible `<a href="${target}">` on the page
   * and (if `cursorTrail` is also enabled) glides the cursor to it +
   * fires `.click()`. Behaviour collapses to the original push-state
   * fallback if no matching link exists.
   *
   * Why: directly mutating history feels jarring on demo videos —
   * the SPA route flips but the user never sees "the agent clicked
   * nav". Click-the-link first surfaces the navigation as a real
   * user action.
   *
   * Default: `false` (keep v0.1.x behaviour). Pair with `cursorTrail`
   * for the full effect.
   */
  preferClickLinkOverNavigate?: boolean;
}
