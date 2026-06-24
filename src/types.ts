/**
 * @perhapxin/dddk — Public types
 * See ../docs/01-architecture.md for the full design.
 */

/**
 * BCP-47-ish language tag — `'en'`, `'zh-TW'`, `'ja-JP'`, `'es'`, etc.
 *
 * dddk's bundled UI strings (subtitle button labels, dock hints, inline-AI
 * action labels) ship `'en'` + `'zh-TW'` translations as defaults; unknown
 * tags fall back to `'en'`. Hosts add their own languages by passing an
 * `i18n` dict that maps the tag to a translation object — see
 * `DotDotDuckConfig.i18n` and `I18nDict`. There is no compile-time lock
 * on the value: any string a real product would use is accepted.
 */
export type Locale = string;

export type SubtitleType = 'voice' | 'selection' | 'agent' | 'post' | 'info';

export interface SubtitleShowOptions {
  text: string;
  type: SubtitleType;
  onAccept?: () => void;
  onReject?: () => void;
  onCancel?: () => void;
  onCopy?: () => void;
  hints?: string;
  autoHide?: number;
  /**
   * Maximum characters shown per page before paging kicks in. When `text`
   * exceeds this length the subtitle is split on sentence boundaries
   * (`.` / `。` / `!` / `?` / newlines) into pages and the user advances
   * with Space. The accept / reject callbacks fire on the LAST page —
   * earlier pages just advance. Set to `0` to disable paging entirely
   * (render the whole text in one shot). Default `220` — about three
   * lines on the standard subtitle bar.
   */
  maxCharsPerPage?: number;
  /**
   * When `true`, the subtitle bar refuses every dismissal except the
   * explicit accept / reject gestures (Space / double-tap Space) wired
   * via `onAccept` / `onReject`. The × close button is hidden, Esc is
   * ignored, click-outside is ignored, and any-key dismiss is disabled.
   *
   * Use for cases where the host MUST collect a user signal before the
   * bar can go — the end-of-loop feedback closure is the canonical
   * example. Don't use for normal action subtitles; users expect Esc
   * to work as an escape valve everywhere else.
   *
   * Default `false`.
   */
  persistent?: boolean;
}

/**
 * Options for the multi-choice subtitle (`Subtitle.showChoice(...)`).
 *
 * Renders the question + an ordered list of options. Each option can be
 * picked by clicking, by pressing the digit `1..N`, or — when voice is
 * active — by speaking the option text. Esc cancels.
 *
 * `allowFreeText` (default `true`) appends a trailing free-text input
 * after the options so the user can answer outside the predefined
 * choices. On submit the typed value is delivered to `onChoose` with
 * `index === -1` so the caller can distinguish free-text answers from
 * canonical picks.
 */
export interface SubtitleChoiceOptions {
  /** The prompt itself — naturally spoken sentence. */
  question: string;
  /** The selectable choices. 2–4 canonical options + optional "Other" slot. */
  options: string[];
  /** Default `true`. When false, no free-text input is shown. */
  allowFreeText?: boolean;
  /** Placeholder shown in the free-text input. Default localised. */
  freeTextLabel?: string;
  /**
   * Fires when the user makes a pick. `index` is the position in
   * `options` (0-based) for canonical picks, OR `-1` for a free-text
   * answer (in which case `value` is the typed string).
   */
  onChoose: (value: string, index: number) => void;
  /** Esc / backdrop dismiss. */
  onCancel?: () => void;
  /** Auto-hide timeout in ms. Default: stays until interacted with. */
  autoHide?: number;
}

export type DddkEventName = keyof DddkEventMap;

/**
 * Unified intent event — emitted on every user decision / activation that
 * carries product-analytics meaning. Subscribe once via `dddk.on('intent', ...)`
 * and feed straight into your analytics pipeline.
 */
export type IntentEvent =
  | { kind: 'palette_activated'; itemId: string; arg?: string; selectionText?: string; attachmentsCount: number; timestamp: number }
  | { kind: 'agent_asked'; question: string; timestamp: number }
  | { kind: 'agent_answered'; question?: string; answer: string; via: 'gesture' | 'voice' | 'text' | 'mobile-button'; latencyMs?: number; timestamp: number }
  /**
   * One emit per LLM streaming call inside an agent run. Carries
   * per-call speed metrics for the dashboard:
   *   - `ttftMs`     time-to-first-token (request sent → first delta)
   *   - `durationMs` total stream wall-time (request sent → last delta)
   *   - `outputTokens` provider-reported output token count (when available)
   *   - `inputTokens`  provider-reported input token count
   *   - `tokensPerSec` outputTokens × 1000 / durationMs (host-computed; 0 if missing)
   * `runId` joins back to the agent run. `model` is the resolved provider
   * model id when available, otherwise omitted.
   */
  | { kind: 'agent_llm_call'; runId: string; role: 'webagent' | 'vision'; ttftMs: number; durationMs: number; outputTokens?: number; inputTokens?: number; tokensPerSec?: number; model?: string; timestamp: number }
  | { kind: 'confirm_action'; actionName: string; params: Record<string, unknown>; approved: boolean; timestamp: number }
  | { kind: 'voice_captured'; text: string; cleanedText?: string; timestamp: number }
  | { kind: 'selection_used'; selectionText: string; selectorHint?: string; itemId: string; timestamp: number }
  | { kind: 'skill_started'; skillId: string; timestamp: number }
  | { kind: 'skill_finished'; skillId: string; timestamp: number }
  /**
   * Fired when an agent run begins (user submitted a query, either
   * fresh or as a follow-up). `runId` ties every downstream intent in
   * the same run together so dashboards can group by run without
   * relying on time-windowing.
   */
  | { kind: 'agent_run_started'; runId: string; task: string; sessionId: string; timestamp: number }
  /**
   * Fired when an agent run terminates cleanly (the loop ended on its
   * own — empty actions / no tool call). Pairs with `agent_run_started`
   * via `runId`.
   */
  | { kind: 'agent_run_completed'; runId: string; sessionId: string; turnCount: number; timestamp: number }
  /**
   * Fired when the user explicitly halts a running agent (× button on
   * the bar, Esc, double-tap Space reject, palette open mid-run,
   * long-press voice mid-run). `reason` names which path triggered the
   * stop so dashboards can distinguish "user changed their mind" from
   * "user got frustrated".
   */
  | { kind: 'agent_run_stopped'; runId: string; sessionId: string; reason: 'close' | 'esc' | 'reject' | 'palette' | 'voice' | 'unknown'; timestamp: number }
  /**
   * Fired after every CoT-mode narration when the runtime's auto-pause
   * resolves. `decision: 'continue'` = user pressed Space; `'stop'` =
   * user double-tapped Space to reject. Lets dashboards see WHERE in
   * the run the user got bored / chose to stop.
   */
  | { kind: 'agent_pause_decision'; runId: string; decision: 'continue' | 'stop'; timestamp: number }
  /**
   * End-of-loop closure response. `satisfied: true` = Space accept;
   * `false` = double-tap reject; `null` = picker selection (value in
   * `summary`). `runId` joins back to `agent_run_started`; `skillId` set
   * when a skill triggered the run.
   */
  | { kind: 'agent_feedback'; runId?: string; skillId?: string; satisfied: boolean | null; summary: string; timestamp: number }
  /**
   * v0.2.0 ROADMAP 7.3. Host-defined event emitted via the public
   * `dddk.track(name, props?)` API. Goes through the same intent
   * stream as the typed events; downstream sinks treat it like any
   * other intent.
   */
  | { kind: 'custom_track'; name: string; props: Record<string, unknown>; timestamp: number }
  /**
   * v0.2.0 ROADMAP 4.7. Fired when the agent explicitly hands off to
   * a human operator via the `escalate_to_human` action. `runId`
   * ties back to the originating run.
   */
  | { kind: 'agent_escalated'; runId?: string; reason: string; context?: string; timestamp: number };

export interface DddkEventMap {
  palette_open: { selection: string };
  voice_start: void;
  voice_end: { text: string };
  gesture_accept: void;
  gesture_reject: void;
  gesture_escape: void;
  pointer_ring_show: { selector: string };
  pointer_ring_hide: void;
  pointer_lock: { selector: string; element: HTMLElement };
  pointer_lasso: {
    elements: HTMLElement[];
    bounds: DOMRect;
    screenshot?: string;
  };
  skill_start: { skillId: string };
  skill_step: { skillId: string; stepIndex: number };
  skill_done: { skillId: string };
  surface: { surface: unknown; placement: import('./skills/types').SurfacePlacement };
  agent_start: { task: string };
  /** Emitted at every LLM call boundary (between tool dispatches). */
  agent_thinking: void;
  /** Emitted right before a tool's handler runs. */
  agent_tool_start: { name: string; args: Record<string, unknown>; targetSelector?: string };
  /** Emitted after a tool's handler returns. */
  agent_tool_end: { name: string; result: import('./agent/webagent/types').ActionResult };
  /** Emitted when the agent run completed naturally (no more tool calls). */
  agent_final: void;
  /** Emitted when the agent run failed terminally. */
  agent_error: { error: Error };
  intent: IntentEvent;
}

export type DddkEventHandler<E extends DddkEventName> = (
  payload: DddkEventMap[E]
) => void;

// ─── Storage adapter ────────────────────────────────────────────────

/**
 * Synchronous key/value storage adapter. dddk depends on synchronous reads
 * for first-paint scenarios (theme, language, preferences) — async-only stores
 * cannot be plugged in directly. Wrap them with an in-memory hydration layer
 * (read once at startup, persist async behind the scenes).
 */
export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

// ─── i18n ────────────────────────────────────────────────────────────

export type I18nDict = Record<string, Record<string, string>>;
