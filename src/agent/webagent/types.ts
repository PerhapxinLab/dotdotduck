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

  /** Override the confirmation prompt. */
  confirmationMessage?: (params: P) => string;
}

// ─── Selection (captured at run start) ──────────────────────────────

export interface SelectionContext {
  text?: string;
  images?: string[];
  bbox?: { x: number; y: number; width: number; height: number };
  /** CSS selectors / DOM paths the user clicked or multi-selected. */
  elements?: string[];
}

// ─── Session model — append-only turn log ───────────────────────────

export interface AgentSession {
  id: string;
  turns: AgentTurn[];
  status: AgentStatus;
  currentPage: string;
  startedAt: number;
  updatedAt: number;
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

// ─── WebAgent config ────────────────────────────────────────────────

export interface WebAgentConfig {
  /** LLM source — single `LLMProvider` or `LLMRouter` (per-role). */
  llm: LLMSource;
  locale?: string;
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
  /** Plain text appended after the default prompt. */
  appendSystemPrompt?: string;

  sitemap?: SitemapConfig;
  agentName?: string;
  siteName?: string;

  customActions?: ActionDefinition[];

  /** sessionStorage key. Default 'webagent.session'. */
  sessionStorageKey?: string;

  /** Override default tool list (advanced). */
  toolDefinitions?: ToolDefinition[];

  /**
   * Multi-turn continuity. After a turn ends, follow-ups within this
   * window append to the current session as user turns. Older than this
   * and the next `runStream()` starts a fresh session.
   * Default 5 * 60 * 1000 (5 minutes). Pass `0` to disable continuity.
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
}
