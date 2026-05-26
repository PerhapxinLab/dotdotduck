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

export type DddkEventName =
  | 'subtitle_show'
  | 'subtitle_hide'
  | 'palette_open'
  | 'palette_close'
  | 'palette_command'
  | 'voice_start'
  | 'voice_end'
  | 'voice_text'
  | 'voice_indicator'
  | 'gesture_accept'
  | 'gesture_reject'
  | 'gesture_escape'
  | 'pointer_ring_show'
  | 'pointer_ring_hide'
  | 'pointer_lock'
  | 'pointer_lasso'
  | 'skill_start'
  | 'skill_step'
  | 'skill_done'
  | 'surface'
  | 'agent_start'
  | 'intent';

/**
 * Unified intent event — emitted on every user decision / activation that
 * carries product-analytics meaning. Subscribe once via `dddk.on('intent', ...)`
 * and feed straight into your analytics pipeline.
 */
export type IntentEvent =
  | { kind: 'palette_activated'; itemId: string; arg?: string; selectionText?: string; attachmentsCount: number; timestamp: number }
  | { kind: 'agent_asked'; question: string; timestamp: number }
  | { kind: 'agent_answered'; question?: string; answer: string; via: 'gesture' | 'voice' | 'text' | 'mobile-button'; timestamp: number }
  | { kind: 'confirm_action'; actionName: string; params: Record<string, unknown>; approved: boolean; timestamp: number }
  | { kind: 'voice_captured'; text: string; cleanedText?: string; timestamp: number }
  | { kind: 'selection_used'; selectionText: string; selectorHint?: string; itemId: string; timestamp: number }
  | { kind: 'skill_started'; skillId: string; timestamp: number }
  | { kind: 'skill_finished'; skillId: string; timestamp: number }
  /**
   * Fired when the SDK's `gateAgentSubtitles` mode is on and the user
   * responds to the final done summary. `satisfied: true` = Space
   * accept, `false` = double-tap reject, `null` = explicit cancel
   * (Esc / click-outside). Useful for measuring agent quality from
   * the intent stream.
   */
  | { kind: 'agent_feedback'; satisfied: boolean | null; summary: string; timestamp: number };

export interface DddkEventMap {
  subtitle_show: SubtitleShowOptions;
  subtitle_hide: void;
  palette_open: { selection: string };
  palette_close: void;
  palette_command: { commandId: string };
  voice_start: void;
  voice_end: { text: string };
  voice_text: { text: string; selection?: string };
  voice_indicator: { state: 'listening' | 'processing'; label?: string };
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
