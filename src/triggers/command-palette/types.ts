/**
 * Type / interface contracts shared across the CommandPalette implementation.
 * Public types are re-exported via `./index.ts` so external import paths
 * (`@perhapxin/dddk` and `./triggers/command-palette`) keep working.
 */

/**
 * Prefix spec — three forms:
 *  - bare string ('ask:')
 *  - array of strings (['ask:', '@ai', '/'])  — any one triggers
 *  - object with separate match (what triggers) and label (what's shown)
 *
 * Convention: symbol prefixes — use `/`, `@`, `#` only.
 * Text prefixes — host decides freely (e.g. `ask:`, `search:`, `d1:`).
 */
export type PaletteItemPrefix =
  | string
  | string[]
  | { match: string | string[]; label?: string };

/**
 * Agent-tool exposure spec — opt-in only.
 *
 * When a palette item declares `agentTool`, DotDotDuck auto-registers it as
 * a webagent custom action so the agent can invoke it. Predefined default
 * is NOT to expose (safer + more controllable).
 *
 * webagent's tool surface should stay narrow — only this opt-in mechanism +
 * the built-in DOM actions. Business features live in palette skills or as
 * clickable UI on the page.
 */
export interface PaletteAgentTool {
  /** What the agent sees as the tool's purpose. */
  description: string;
  /** JSON Schema for the tool's params — typically `{ arg: string }`. */
  parameters: Record<string, unknown>;
  /** True for destructive ops — agent will prompt user before invoking. */
  requireConfirmation?: boolean;
}

export interface PaletteItem {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  keywords?: string[];
  section?: string;
  shortcut?: string;
  /**
   * Prefix routing — when the palette input starts with this prefix, only items
   * matching this prefix are shown, and the post-prefix text is passed as `arg`.
   *
   * See {@link PaletteItemPrefix} for the three accepted forms.
   */
  prefix?: PaletteItemPrefix;
  /**
   * If true and `prefix` is set, the item shows AS THE TOP RESULT whenever the
   * input starts with that prefix, even without matching the rest of `name`.
   * Use this for "open-ended" prefixes like `ask ai:`.
   */
  prefixAcceptsAnyArg?: boolean;
  /**
   * If true, this item appears as a fallback when the user's query matches
   * no other item. Pair with `prefixAcceptsAnyArg` so the raw query becomes
   * the action arg.
   */
  fallback?: boolean;
  /**
   * Optional typed action list. If provided, the palette renders a primary
   * action (⏎), secondary (Ctrl+⏎), and a sub-panel for the rest (Ctrl+K).
   * If omitted, the item uses the bare `handler` callback below.
   */
  actions?: import('../action-panel').PaletteAction[];
  /**
   * Opt-in agent exposure — set to make this command callable by webagent.
   * See {@link PaletteAgentTool}.
   */
  agentTool?: PaletteAgentTool;
  /**
   * Optional detail-view renderer — when this item is highlighted, the palette
   * renders a right pane containing this PieceSurface. Receives the current
   * prefix arg (if any).
   */
  detail?: (arg?: string) => import('../../ui/pieces').PieceSurface | Promise<import('../../ui/pieces').PieceSurface>;
  /**
   * Browse mode — dynamic resource expansion under a prefix. When set with
   * `prefix`, the SDK calls this on every keystroke once the prefix matches
   * the input. Return the list of resources under this prefix; the SDK
   * fuzzy-filters them by the post-prefix arg.
   *
   * Use for resource-type prefixes like `order:`, `customer:`, `aig:`,
   * `docs:`. Each returned PaletteItem renders as a row whose handler runs
   * when the user picks it (typically `goto(...)` or `p.showResult(...)`).
   *
   * Sync only — host should cache fetches and call browse() against the
   * cached list. For async / pagination, wire it through showResult on the
   * parent item instead.
   */
  browse?: (arg: string) => PaletteItem[];
  /**
   * Section heading used for items returned by `browse`. Defaults to the
   * parent item's section, falling back to the prefix string. Override
   * when the parent lives in 'Tips' but children should display under
   * a resource-specific heading like 'Docs' or 'AI Gateways'.
   */
  browseSection?: string;
  /**
   * Search-only — when true, this item is hidden from the empty state and
   * from partial-prefix attempts, but still participates in free-text fuzzy
   * search. Use for "deep destinations" you want findable by keyword but
   * not cluttering the default list — e.g. each doc chapter registered as
   * a flat row so typing `react` surfaces `docs › dddk › React adapter`.
   */
  searchOnly?: boolean;
  /**
   * Optional category for the chip-row filter. When the palette is
   * configured with `categories: [...]`, clicking a chip narrows the
   * list to items whose `category` matches that chip's `id`. Items
   * without a category appear under the implicit "All" chip only.
   */
  category?: string;
  handler?: (palette: PaletteHandle, arg?: string) => void | Promise<void>;
}

/**
 * Category chip rendered below the palette input. Clicking one narrows
 * the list to `PaletteItem`s whose `category` field equals `id`.
 */
export interface PaletteCategory {
  /** Stable id matched against `PaletteItem.category`. */
  id: string;
  /** Human-readable label rendered on the chip. */
  label: string;
}

export interface PaletteHandle {
  close(): void;
  replace(items: PaletteItem[]): void;
  get input(): string;
  setInput(value: string): void;
  /** User-context captured at palette open: selection text + queued image attachments. */
  context: PaletteContext;
  /** Render a result in-place below the input, replacing the item list. */
  showResult(surface: ResultSurface): void;
  /** Switch back to the regular item list. */
  clearResult(): void;
  /**
   * Hijack the top input box so the sub-tool can use it as ITS OWN input —
   * useful when the tool is a chat panel / dataset search / per-tool prompt
   * that shouldn't double up with another text box. The override clears
   * automatically when the palette closes or the user Esc-backs out of the
   * current sub-menu.
   *
   * Example (chat panel inside a sub-menu):
   *   handle.setInputContext({
   *     placeholder: 'Type a message…',
   *     hideList: true,
   *     onSubmit: (text) => sendChat(text),
   *   });
   */
  setInputContext(ctx: {
    placeholder?: string;
    onSubmit: (value: string, handle: PaletteHandle) => void;
    /** Fires on every keystroke. Use for live-filter panels. */
    onInput?: (value: string, handle: PaletteHandle) => void;
    clearOnSubmit?: boolean;
    hideList?: boolean;
  }): void;
  clearInputContext(): void;
}

/**
 * A streamed result fragment. The palette content-frame renderer
 * processes one of these per yield from an `AsyncIterable<ResultChunk>`:
 *
 *   - `{ delta }`         — append plain text to the running buffer
 *   - `{ text }`          — REPLACE the running text (LLM snapshot-mode streams)
 *   - `{ html, append? }` — set / append innerHTML (default REPLACE)
 *   - `{ node, append? }` — replace / append a DOM node directly
 *   - `{ clear: true }`   — wipe the content frame mid-stream (rare; for retries)
 */
export type ResultChunk =
  | { delta: string }
  | { text: string }
  | { html: string; append?: boolean }
  | { node: Node; append?: boolean }
  | { clear: true };

/**
 * Streamed result handle — the host mounts an HTMLElement and gets back
 * the same root inside a callback to mutate as data arrives. This is
 * the natural shape for chat / progressive LLM rendering / partial-node
 * updates where the host owns the DOM structure and only specific
 * sub-trees stream.
 *
 *   p.showResult({
 *     mount: container,
 *     stream: async (root) => {
 *       const reply = root.querySelector('.reply')!;
 *       for await (const c of llm.streamComplete()) reply.textContent = c.text;
 *     },
 *   });
 */
export interface StreamingResultSurface {
  /** Element shown in the content frame. */
  mount: HTMLElement;
  /** Called AFTER `mount` is in the DOM. Mutate `root` (which === mount). */
  stream: (root: HTMLElement) => void | Promise<void>;
}

/** What a palette handler can hand back to be rendered in result-mode. */
export type ResultSurface =
  | string
  | HTMLElement
  | AsyncIterable<string | ResultChunk>
  | StreamingResultSurface
  | (() => Promise<string | HTMLElement | AsyncIterable<string | ResultChunk> | StreamingResultSurface>);

// ─── QA palette items ──────────────────────────────────────────────

/** Locale-aware string: either `"plain"` or `{ en: "...", 'zh-TW': "..." }`. */
export type LocalizedText = string | Record<string, string>;

export interface QAPaletteItem {
  id: string;
  question: LocalizedText;
  answer: LocalizedText;
  description?: LocalizedText;
  category?: string;
  /** Free-form metadata the host wants threaded through `renderAnswer`. */
  meta?: Record<string, unknown>;
}

export interface QAItemsOpts {
  /** Active UI locale. Used to pick the right string from each LocalizedText.
   *  Default `'en'`. Re-call `addQAItems` with a new locale to refresh labels. */
  locale?: string;
  /** Palette section heading. Default `'QA'`. */
  section?: string;
  /** Item-row icon. Default `'?'`. */
  icon?: string;
  /** Prefix for the item id (`addItem` is id-keyed). Default `'qa-'`. */
  idPrefix?: string;
  /** Override the right-pane renderer. Default renders the answer as a Body piece. */
  renderAnswer?: (ctx: {
    question: string;
    answer: string;
    meta?: Record<string, unknown>;
  }) => import('../../ui/pieces').PieceSurface;
}

/**
 * Image attachment queued in the palette context — user added via the
 * camera icon (file picker or screenshot). Skill / agent handlers read
 * `palette.context.attachments` to pass these along to the LLM.
 */
export interface PaletteAttachment {
  id: string;
  kind: 'image';
  blob: Blob;
  thumbnailUrl: string;
  source: 'upload' | 'screenshot';
  filename?: string;
  /** Page URL the attachment was captured / referenced on (screenshots set
   *  this to `window.location.href`). Forwarded to webagent so the agent
   *  knows which page the user is asking about. */
  sourceUrl?: string;
}

/**
 * State the palette carries about the current user — text they had
 * selected when they opened it, images they attached via the camera icon.
 * Skill / agent handlers receive this via the palette handle.
 */
export interface PaletteContext {
  selectionText: string;
  selectionElement?: string;
  attachments: PaletteAttachment[];
}

/**
 * Camera button at the right of the palette input.
 *
 * Modes:
 *   - `'upload'`     — opens a file picker. `capture: true` on mobile opens the
 *                      camera directly.
 *   - `'screenshot'` — hides the palette, shows a crosshair overlay, the user
 *                      drags a rectangle on the visible page, and the host's
 *                      `captureRect()` turns that rect into an image blob.
 *                      No OS share-screen prompt, no tab picker.
 *
 * Both modes deliver the result through `onCapture`.
 */
export interface CameraOptions {
  /** What the icon does. */
  mode: 'upload' | 'screenshot';
  /** Receives the captured / chosen image. */
  onCapture: (file: File | Blob, source: 'upload' | 'screenshot') => void;
  /**
   * Upload mode only — file picker accept filter. Default `image/*`.
   * Mobile: include `capture: true` for direct camera access.
   */
  accept?: string;
  /** Upload mode only — open camera directly on mobile. Default false. */
  capture?: boolean;
  /** Tooltip on hover. Default "Attach image". */
  title?: string;
  /**
   * Screenshot mode only — pixel capture function. dddk renders the region-
   * selection overlay and hands you the rect (in viewport coords); you turn
   * the underlying DOM region into a Blob. Typical implementation uses
   * `html2canvas` or `modern-screenshot` in the host bundle.
   *
   * Return `null` if capture fails (no fallback fires — the user can try
   * again or cancel).
   *
   * If omitted in screenshot mode, the camera button warns and does nothing.
   */
  captureRect?: (rect: { x: number; y: number; width: number; height: number }) => Promise<Blob | null>;
}

export interface CommandPaletteOptions {
  initialItems?: PaletteItem[];
  /** Locale for the bundled chrome strings (placeholder, footer hints).
   *  `en` / `zh-TW` ship bundled — anything else falls back to `en`.
   *  Hosts wanting native labels in another language pass `placeholder`
   *  explicitly or override via `setLocale()` at runtime. */
  locale?: string;
  placeholder?: string;
  /** Optional page-text search; returns elements to jump to. */
  searchPage?: (query: string) => Array<{ text: string; element: HTMLElement }>;
  /**
   * Optional HeatRank — if provided, palette items sort by usage frecency
   * (descending) AFTER the prefix/fuzzy filter. visit() is called on activate.
   */
  heatRank?: import('../../utils/heat-rank').HeatRank;
  /**
   * Optional PieceCatalog — used to render PaletteItem.detail in the right pane.
   * Defaults to createBuiltinCatalog() lazily on first use.
   */
  pieceCatalog?: import('../../ui/pieces').PieceCatalog;
  /**
   * When the palette opens with any chip-bar context (selection text, a
   * pinned DOM element, image attachments), automatically promote the
   * registered `fallback` (Ask AI) row to the TOP of the list and place
   * the keyboard cursor on it — so pressing Enter immediately routes the
   * captured context to the agent. Default `true`: most products that pin
   * context to the palette do so precisely because the user wants AI to
   * act on it. Set `false` if your palette uses context for navigation /
   * search and the fallback should stay at the bottom like normal.
   */
  contextPromotesFallback?: boolean;
  /**
   * Show a camera icon at the right edge of the input. Default `undefined`
   * (no icon). Set this to enable image attach — host handles the resulting
   * file/blob via `onCapture`.
   */
  camera?: CameraOptions;
  /**
   * Optional chip-row rendered below the input. When provided, the
   * palette inserts an "All" chip and then one chip per entry; clicking
   * a chip narrows the list to items whose `category` matches its id.
   */
  categories?: PaletteCategory[];
  /** Label for the implicit "All" chip. Defaults to "All". */
  allCategoriesLabel?: string;
  /**
   * Fired whenever a palette item is activated (clicked / Enter). Used by
   * the orchestrator to emit a unified `intent` event.
   */
  onActivate?: (info: { itemId: string; arg?: string; selectionText?: string; attachmentsCount: number }) => void;
}
