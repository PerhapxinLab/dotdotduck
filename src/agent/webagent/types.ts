/**
 * @perhapxin/dddk — Public types
 * 詳細規劃見 ../../docs/01-architecture.md + 02-api.md
 */

import type { ToolDefinition } from '../llm/types';
import type { LLMSource } from '../llm/router';

// ─── Agent state ────────────────────────────────────────────────────

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'executing'
  | 'waiting'
  | 'done'
  | 'failed';

export interface AgentSession {
  id: string;
  task: string;
  steps: AgentStep[];
  status: AgentStatus;
  currentPage: string;
  startedAt: number;
  updatedAt: number;
  summary?: string;
}

export interface AgentStep {
  action: AgentAction;
  result: ActionResult;
  subtitle?: string;
  timestamp: number;
  /**
   * The LLM's original tool_call.id for this step. Used to pair the
   * follow-up `tool` role message correctly when re-building the prompt.
   */
  toolCallId?: string;
}

export interface AgentAction {
  name: string;
  params: Record<string, unknown>;
  reasoning?: string;
}

// ─── Action contracts ───────────────────────────────────────────────

export type ActionFailureReason =
  | 'not_found'
  | 'not_visible'
  | 'not_interactive'
  | 'timeout'
  | 'navigation'
  | 'cancelled'
  | 'unknown';

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; reason: ActionFailureReason; message?: string };

export interface ActionContext {
  session: AgentSession;
  signal: AbortSignal;
  emit: (event: AgentEventName, payload: unknown) => void;
}

export interface ActionDefinition<P = unknown, R = unknown> {
  name: string;
  description: string;
  /** JSON Schema for params. Zod schemas can be passed via `zodToJsonSchema()`. */
  parameters: Record<string, unknown>;
  handler: (params: P, ctx: ActionContext) => Promise<ActionResult<R>>;

  /**
   * If true, the agent pauses before invoking and asks the host to confirm.
   * Use for destructive / external-side-effect actions (delete, send email,
   * place order, transfer money). Default false.
   */
  requireConfirmation?: boolean | ((params: P, ctx: ActionContext) => boolean | Promise<boolean>);

  /**
   * Override the confirmation prompt. Receives the params being passed in.
   * Default: `"Confirm `<name>`?"`.
   */
  confirmationMessage?: (params: P) => string;
}

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

// ─── Pieces (structured surface envelope) ───────────────────────────

export type PiecePlacement = 'center' | 'inline' | 'dock';

/**
 * Envelope shape for a declarative UI surface that the agent (or host)
 * can mount. Wire-compatible with the upstream v0.10 surface protocol
 * dddk's Pieces system bridges from, but the webagent treats this as
 * its own internal contract.
 */
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

// ─── Sitemap ─────────────────────────────────────────────────────────

/**
 * Flat sitemap (simple sites) — still supported in v1. Prefer the
 * `SitemapNode` tree for sites with more than ~8 pages. See
 * `../sitemap/types.ts`.
 */
export interface SitemapEntry {
  path: string;
  /**
   * Human-facing description in the host's primary locale. The agent's
   * system prompt and the palette fuzzy matcher both read this field —
   * keep it natural-language and idiomatic for the language you set.
   */
  description: string;
  /**
   * Free-form synonyms the matcher should also accept. Two common uses:
   *   1. Domain aliases — `'settings page'`, `'pref'`, `'preferences'`.
   *   2. Other-locale labels for multilingual sites — when the primary
   *      `description` is `'首頁'`, list `['Home', 'ホーム', '홈']` here
   *      so users typing in any language land on the right path. Use
   *      `buildSitemap()` from `@perhapxin/dddk/agent` to generate the
   *      `description` + `aliases` pair from one i18n dict.
   */
  aliases?: string[];
}

/** Either flat list (v0) or tree (recommended for >8 pages). */
export type SitemapConfig = SitemapEntry[] | import('../sitemap/types').SitemapNode;

// ─── WebAgent config ────────────────────────────────────────────────

/**
 * Selection captured at run start. The agent sees this as part of its first
 * prompt, so it knows what the user clicked / highlighted / lassoed.
 */
export interface SelectionContext {
  /** Selected text content (if any). */
  text?: string;
  /** Selected images as base64 / URL (if any). */
  images?: string[];
  /** Bounding box of the selection on the page. */
  bbox?: { x: number; y: number; width: number; height: number };
  /** CSS selectors / DOM paths the user clicked or multi-selected. */
  elements?: string[];
}

export interface RunOptions {
  /** What the user had selected when they invoked the agent. */
  selection?: SelectionContext;
}

export interface WebAgentConfig {
  /**
   * LLM source — pass a single `LLMProvider` (same model everywhere) or an
   * `LLMRouter` (per-role: `webagent`, `webagentWithSelection`, ...).
   */
  llm: LLMSource;
  /**
   * BCP-47 locale used as a hint for the LLM (it still detects the user's
   * actual input language) and for the SDK's bundled UI strings (the
   * confirmation narrations etc. ship `'en'` and `'zh-TW'` translations;
   * unknown values fall back to English UI).
   *
   * Accepts any string — `'en'`, `'zh-TW'`, `'ja-JP'`, `'es-MX'`, etc.
   */
  locale?: string;
  maxSteps?: number;
  maxErrors?: number;

  /**
   * Full system prompt override. Pass a string to hard-replace the default,
   * or a function `(ctx, defaultPrompt) => string` to compose around the default.
   * Most hosts should NOT use this — prefer `brand` + `appendSystemPrompt`.
   */
  systemPrompt?: import('./prompt').SystemPromptOverride;

  /**
   * Structured brand context. Easiest extension point — fill the fields,
   * the runtime renders them into the prompt for you.
   */
  brand?: import('./prompt').BrandPrompt;

  /**
   * Plain string appended after the default prompt. The most common way
   * to add domain knowledge ("Acme order IDs always start with ORD-").
   */
  appendSystemPrompt?: string;

  sitemap?: SitemapConfig;
  agentName?: string;
  siteName?: string;
  /** Custom actions registered alongside built-ins. */
  customActions?: ActionDefinition[];
  /** sessionStorage key. Default 'webagent.session'. */
  sessionStorageKey?: string;
  /** Override default tool list (advanced — usually leave undefined). */
  toolDefinitions?: ToolDefinition[];

  /**
   * Cross-tab session sync (same origin). Default `false`.
   * When `true`, dddk mirrors session state to `localStorage` and uses
   * `BroadcastChannel` so a new tab on the same origin can pick up the
   * conversation. Cross-origin / cross-subdomain is NOT supported by the
   * browser sandbox — see docs/12-session-continuity.md.
   */
  crossTabSync?: boolean;

  /**
   * Interactive (step-by-step) mode. Two effects:
   *
   *  1. The agent emits a `confirm_action` event BEFORE every action
   *     (not just ones flagged `requireConfirmation`) and awaits the
   *     host's `decide()` callback. Single Space tap → `decide(true)` →
   *     action proceeds. Double-tap Space / Esc → `decide(false)` →
   *     agent stops with a "stopped by user" status.
   *
   *  2. The built-in `show_subtitle` action becomes a "narrate and
   *     wait" gesture — the agent surfaces a progress / explanation
   *     line and the loop pauses for user acknowledgement (Space) before
   *     the next step. The agent uses this to walk the user through
   *     multi-step tasks at their pace.
   *
   * Demo / onboarding / customer-service contexts want this `true` so
   * the user sees each step narrated and framed. Production automations
   * usually leave it `false` so the loop runs at full speed and only
   * pauses for genuinely destructive actions (those flagged
   * `requireConfirmation: true` on the ActionDefinition).
   *
   * Default `false` (= full-auto).
   */
  confirmEachStep?: boolean;
}

// ─── Event surface ──────────────────────────────────────────────────

export type AgentEventName =
  | 'status'
  | 'before_action'
  | 'step'
  | 'subtitle'
  | 'piece_surface'
  | 'ask_user'
  | 'ask_user_choice'
  | 'confirm_action'
  | 'overlay_update'
  | 'navigate'
  | 'error'
  | 'done';

export interface AgentEventMap {
  status: AgentStatus;
  /**
   * Fires after the LLM picks an action but BEFORE the action handler runs.
   * Lets visual layers (agent cursor, action overlay) preview the target
   * element with a pause for user awareness. Differs from `confirm_action`
   * in that this is informational only — no decision needed.
   */
  before_action: {
    actionName: string;
    params: Record<string, unknown>;
    /** Best-effort: CSS selector if the action targets an element. */
    targetSelector?: string;
  };
  step: AgentStep;
  subtitle: string;
  piece_surface: { surface: PieceSurface; placement: PiecePlacement };
  ask_user: { question: string; resolve: (answer: string) => void };
  /**
   * Multi-choice prompt — the host renders a picker (the dddk Subtitle's
   * `showChoice` is the canonical renderer) and resolves with the chosen
   * value. `allowFreeText` defaults to true so the user can also type a
   * free-text answer.
   */
  ask_user_choice: {
    question: string;
    options: string[];
    allowFreeText?: boolean;
    resolve: (answer: string) => void;
  };
  /** Fired before an action with `requireConfirmation` runs. Host must call `decide`. */
  confirm_action: {
    actionName: string;
    params: Record<string, unknown>;
    message: string;
    decide: (approved: boolean) => void;
  };
  overlay_update: OverlayItem[];
  navigate: { path: string };
  error: Error;
  done: AgentSession;
}

export type AgentEventHandler<E extends AgentEventName> = (
  payload: AgentEventMap[E]
) => void;
