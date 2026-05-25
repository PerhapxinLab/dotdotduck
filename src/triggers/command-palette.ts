/**
 * CommandPalette — Ctrl/⌘+K input overlay rendered into the DOM.
 */

import { inferSelector } from '../utils/selector';
import { escapeHtml } from '../utils/dom';
import { genId } from '../utils/id';
import { ensurePaletteStyles, UI_ATTR } from './command-palette/styles';

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
  actions?: import('./action-panel').PaletteAction[];
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
  detail?: (arg?: string) => import('../ui/pieces').PieceSurface | Promise<import('../ui/pieces').PieceSurface>;
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

// ─── prefix helpers ────────────────────────────────────────────────

/** Normalize PrefixSpec to a list of matchable strings. */
export function listPrefixMatches(spec: PaletteItemPrefix | undefined): string[] {
  if (!spec) return [];
  if (typeof spec === 'string') return [spec];
  if (Array.isArray(spec)) return spec;
  if (typeof spec === 'object') {
    return Array.isArray(spec.match) ? spec.match : [spec.match];
  }
  return [];
}

/** What to render in the prefix slot for an item. */
export function displayPrefix(spec: PaletteItemPrefix | undefined): string | undefined {
  if (!spec) return undefined;
  if (typeof spec === 'string') return spec;
  if (Array.isArray(spec)) return spec[0];
  if (typeof spec === 'object') {
    return spec.label ?? (Array.isArray(spec.match) ? spec.match[0] : spec.match);
  }
  return undefined;
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
  }) => import('../ui/pieces').PieceSurface;
}

function resolveLocalized(value: LocalizedText, locale: string): string {
  if (typeof value === 'string') return value;
  const v = value[locale];
  if (v) return v;
  const en = value['en'];
  if (en) return en;
  for (const k of Object.keys(value)) return value[k]!;
  return '';
}

function defaultQAAnswerSurface(ctx: {
  question: string;
  answer: string;
}): import('../ui/pieces').PieceSurface {
  // Minimal Pieces tree — Stack { Heading, Body }. Hosts that want
  // richer formatting (markdown, code blocks, links) override via
  // `renderAnswer`.
  return {
    root: {
      kind: 'Stack',
      gap: 8,
      children: [
        { kind: 'Heading', text: ctx.question, level: 4 },
        { kind: 'Body', text: ctx.answer },
      ],
    },
  };
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
  placeholder?: string;
  /** Optional page-text search; returns elements to jump to. */
  searchPage?: (query: string) => Array<{ text: string; element: HTMLElement }>;
  /**
   * Optional HeatRank — if provided, palette items sort by usage frecency
   * (descending) AFTER the prefix/fuzzy filter. visit() is called on activate.
   */
  heatRank?: import('../utils/heat-rank').HeatRank;
  /**
   * Optional PieceCatalog — used to render PaletteItem.detail in the right pane.
   * Defaults to createBuiltinCatalog() lazily on first use.
   */
  pieceCatalog?: import('../ui/pieces').PieceCatalog;
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

// STYLE_ID + UI_ATTR moved to ./command-palette/styles.ts

export class CommandPalette {
  /**
   * `rootItems` is the canonical list — what `addItem` / `removeItem` operate
   * on. It survives sub-menu navigation. `items` is the *currently displayed*
   * set; when a handler calls `handle.replace([...])`, the previous `items` is
   * pushed onto `subMenuStack` and `items` becomes the new set. Esc pops back
   * one level; if the stack is empty, Esc closes the palette. Re-opening via
   * `open()` always resets `items` to `rootItems.slice()`.
   */
  private rootItems: PaletteItem[];
  private items: PaletteItem[];
  private subMenuStack: PaletteItem[][] = [];
  private placeholder: string;
  private searchPage?: CommandPaletteOptions['searchPage'];
  private contextPromotesFallback = true;

  private root: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private list: HTMLUListElement | null = null;
  private filtered: PaletteItem[] = [];
  private cursor = 0;
  private currentArg = '';
  private listeners: Array<() => void> = [];

  private heatRank?: import('../utils/heat-rank').HeatRank;
  private pieceCatalog?: import('../ui/pieces').PieceCatalog;
  private detailHost: HTMLDivElement | null = null;
  private categoryBarHost: HTMLDivElement | null = null;
  private categories: PaletteCategory[] = [];
  private allCategoriesLabel = 'All';
  private activeCategoryId: string | null = null;
  private camera?: CameraOptions;
  private onActivate?: CommandPaletteOptions['onActivate'];
  // PaletteContext fields — see Phase 1.2. Populated on open / camera capture.
  private contextSelectionText = '';
  private contextSelectionElement?: string;
  private contextSelectionKind: 'dom' | 'text' = 'text';
  private contextAttachments: Array<{
    id: string;
    kind: 'image';
    blob: Blob;
    thumbnailUrl: string;
    source: 'upload' | 'screenshot';
    filename?: string;
  }> = [];

  constructor(opts: CommandPaletteOptions = {}) {
    this.rootItems = opts.initialItems ?? [];
    this.items = this.rootItems.slice();
    this.placeholder = opts.placeholder ?? 'Type a command…';
    this.searchPage = opts.searchPage;
    this.heatRank = opts.heatRank;
    this.pieceCatalog = opts.pieceCatalog;
    this.contextPromotesFallback = opts.contextPromotesFallback ?? true;
    this.camera = opts.camera;
    this.onActivate = opts.onActivate;
    this.categories = opts.categories ?? [];
    this.allCategoriesLabel = opts.allCategoriesLabel ?? 'All';
  }

  /**
   * Replace the category chip set. Pass an empty array to remove the
   * chip row entirely. Active category resets to "All".
   */
  setCategories(categories: PaletteCategory[], allLabel?: string): void {
    this.categories = categories;
    if (allLabel !== undefined) this.allCategoriesLabel = allLabel;
    this.activeCategoryId = null;
    if (this.isOpen()) {
      this.renderCategoryBar();
      this.refilter();
    }
  }

  /** Runtime toggle of the camera icon's mode (upload ↔ screenshot). */
  setCameraMode(mode: 'upload' | 'screenshot'): void {
    if (this.camera) this.camera.mode = mode;
  }

  isOpen(): boolean {
    return this.root !== null;
  }

  toggle(initialSelection?: string): void {
    if (this.isOpen()) this.close();
    else this.open(initialSelection);
  }

  open(initialSelection?: string): void {
    if (this.isOpen()) return;
    ensurePaletteStyles();
    // Every open is a fresh root-state palette — discard any sub-menu the
    // user left behind on a previous open.
    this.items = this.rootItems.slice();
    this.subMenuStack = [];
    // Capture selection context (text + element selector) BEFORE we render —
    // because rendering the palette steals focus from the originating element.
    this.captureContextOnOpen(initialSelection);
    this.render();
    this.refilter();
    requestAnimationFrame(() => this.input?.focus());
  }

  close(): void {
    if (!this.root) return;
    this.listeners.forEach((fn) => fn());
    this.listeners = [];
    this.root.remove();
    this.root = null;
    this.input = null;
    this.list = null;
    // Clear context — next open re-captures fresh.
    this.clearContext();
    // Drop any sub-tool input override so the next open starts at the
    // default search placeholder, not whatever the last tool installed.
    this.inputContext = null;
  }

  // ─── palette context (selection text + image attachments) ──────

  /**
   * Host-supplied pinned context. Set by `setPinnedContext()` and consumed
   * on the next `open()`. Used by modules like Dwell that select an element
   * BEFORE the palette opens — when the palette eventually opens, this is
   * what its chipbar surfaces, so the user sees "context: <selection>".
   */
  private pinnedContextText = '';
  private pinnedContextElement?: string;
  private pinnedContextKind: 'dom' | 'text' = 'text';

  /**
   * Host pins a context (typically the DOM region the user just selected via
   * Dwell / Spotter / a manual selection) for the next palette open. Cleared
   * automatically after the palette opens once.
   *
   *   dddk.palette.setPinnedContext(elementInnerText, '#section-id');
   *   // later — when user hits Ctrl+K, the chip bar shows that text.
   *
   * Pass `opts.kind: 'dom'` when the context represents a DOM element (as
   * opposed to a free-form text selection). The chipbar then labels the chip
   * "DOM" instead of "CONTEXT", helping the user tell the two cases apart
   * (long-press on a button vs. dragging across a paragraph behave differently
   * for the agent downstream).
   */
  /**
   * Pin a DOM element (or a free-text snippet) as context for the NEXT
   * palette open. Detection is done at open time by re-reading the live
   * DOM — we don't snapshot a copy of the text here. If the selector
   * stops resolving (page navigation, element removed, scroll-virtualised
   * list) the context auto-clears with no work from the host.
   *
   * The `text` argument is kept only as a fallback for `kind: 'text'`
   * pins where there is no element to read from (rare).
   */
  setPinnedContext(
    text: string,
    selector?: string,
    opts?: { kind?: 'dom' | 'text' },
  ): void {
    this.pinnedContextElement = selector;
    this.pinnedContextKind = opts?.kind ?? 'text';
    // Text fallback only for non-DOM pins. DOM pins always re-read from
    // the live element at open time so navigation can invalidate them.
    this.pinnedContextText = this.pinnedContextKind === 'dom' ? '' : text;
    if (typeof window !== 'undefined') {
      try { window.getSelection?.()?.removeAllRanges(); } catch { /* cross-origin / SSR */ }
    }
  }

  clearPinnedContext(): void {
    this.pinnedContextText = '';
    this.pinnedContextElement = undefined;
    this.pinnedContextKind = 'text';
  }

  /**
   * Read-only snapshot of the sticky pinned context. Unlike `context`, this
   * survives palette `close()` — useful for `dddk.startAgent()` called from a
   * palette handler. The text is read live from the pinned element when
   * possible so navigation invalidates stale pins.
   */
  get pinnedContext(): { text: string; element?: string; kind: 'dom' | 'text' } {
    return {
      text: this.readPinnedTextLive(),
      element: this.pinnedContextElement,
      kind: this.pinnedContextKind,
    };
  }

  /**
   * Look up the pinned element from the live DOM and return its current
   * text. Returns the cached text fallback for non-DOM pins, or `''`
   * if nothing valid is pinned right now.
   */
  private readPinnedTextLive(): string {
    if (!this.pinnedContextElement) return this.pinnedContextText;
    if (typeof document === 'undefined') return this.pinnedContextText;
    let el: Element | null = null;
    try { el = document.querySelector(this.pinnedContextElement); } catch { /* invalid selector */ }
    if (!el || !el.isConnected) return '';
    if (this.pinnedContextKind === 'dom') {
      const tag = el.tagName.toLowerCase();
      const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : '';
      const classList = (el as HTMLElement).classList
        ? Array.from((el as HTMLElement).classList).slice(0, 3)
        : [];
      const cls = classList.length ? '.' + classList.join('.') : '';
      const sig = `<${tag}${id}${cls}>`;
      const inner = ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().slice(0, 200);
      return inner ? `${sig} ${inner}` : sig;
    }
    return (el.textContent ?? this.pinnedContextText).trim();
  }

  private captureContextOnOpen(seed?: string): void {
    let text = (seed ?? '').trim();
    let elementSel: string | undefined;
    // Kind defaults to 'text' for live window selections; only the pinned
    // path (Dwell-style element pick) carries 'dom'.
    let kind: 'dom' | 'text' = 'text';

    // Both sources are DETECTED at open time — we don't trust any cached
    // trajectory. Navigation, scroll, virtualised lists, programmatic DOM
    // removal — anything that takes the element off-screen automatically
    // invalidates the context. The host doesn't need to call any "clear"
    // method for the common path.

    // Source 1 — host-supplied pin. Re-read live from the DOM so a stale
    //            pin from before a route change disappears on its own.
    if (!text && this.pinnedContextElement) {
      const liveText = this.readPinnedTextLive();
      if (liveText) {
        text = liveText;
        elementSel = this.pinnedContextElement;
        kind = this.pinnedContextKind;
      } else {
        // Selector no longer resolves — drop the dangling pin entirely.
        this.clearPinnedContext();
      }
    }

    // Source 2 — non-DOM pin with cached text (rare; `setPinnedContext`
    //            without a selector). Kept only because some hosts pass
    //            free-form strings.
    if (!text && this.pinnedContextText && !this.pinnedContextElement) {
      text = this.pinnedContextText;
      kind = this.pinnedContextKind;
    }

    // Source 3 — LIVE window selection (whatever is highlighted right now
    //            on the page). Only used when there is no pin.
    if (!text && typeof window !== 'undefined') {
      const sel = window.getSelection?.();
      const fromBrowser = sel?.toString().trim() ?? '';
      if (fromBrowser && sel && sel.rangeCount > 0) {
        const node = sel.getRangeAt(0).startContainer;
        const anchor = node instanceof Element ? node : node.parentElement;
        // Reject selections whose anchor element is no longer in the live
        // DOM — happens after an SPA route change when the previous page's
        // textarea / paragraph got unmounted but the browser's Selection
        // object still holds a Range pointing at the detached node. In
        // that state `sel.toString()` returns the stale text until the
        // user makes a new selection. Drop it; don't pin a ghost.
        if (anchor && anchor.isConnected && document.contains(anchor)) {
          text = fromBrowser;
          elementSel = inferSelector(anchor) || undefined;
        }
      }
    }

    this.contextSelectionText = text;
    this.contextSelectionElement = elementSel;
    this.contextSelectionKind = kind;
    // Image attachments persist across palette opens until user removes /
    // activates. Cleared from the orchestrator after webagent consumes them.
  }

  private clearContext(): void {
    this.contextSelectionText = '';
    this.contextSelectionElement = undefined;
    this.contextSelectionKind = 'text';
    // Don't drop attachments — user may have queued one and not yet activated.
  }

  /** Public: add an image attachment to the palette context. */
  addAttachment(att: Omit<PaletteAttachment, 'id'>): PaletteAttachment {
    const full: PaletteAttachment = { id: genId('att'), ...att };
    this.contextAttachments.push(full);
    if (this.isOpen()) {
      this.renderChipBar();
      // Re-filter so contextPromotesFallback (default ON) pulls the Ask AI
      // row to the top now that there's something attached.
      this.refilter();
    }
    return full;
  }

  removeAttachment(id: string): void {
    this.contextAttachments = this.contextAttachments.filter((a) => a.id !== id);
    if (this.isOpen()) {
      this.renderChipBar();
      this.refilter();
    }
  }

  clearAttachments(): void {
    this.contextAttachments = [];
    if (this.isOpen()) {
      this.renderChipBar();
      this.refilter();
    }
  }

  /** Read-only snapshot of the current context. */
  get context(): PaletteContext {
    return {
      selectionText: this.contextSelectionText,
      selectionElement: this.contextSelectionElement,
      attachments: this.contextAttachments.slice(),
    };
  }

  // ─── in-place result mode ──────────────────────────────────────

  private resultHost: HTMLDivElement | null = null;
  private listSplit: HTMLDivElement | null = null;
  private resultMode = false;

  async showResult(surface: ResultSurface): Promise<void> {
    if (!this.resultHost) return;
    this.resultMode = true;
    this.resultHost.style.display = 'block';
    this.resultHost.textContent = '';
    if (this.listSplit) this.listSplit.style.display = 'none';

    let value: Awaited<Exclude<ResultSurface, (...args: never) => unknown>>;
    try {
      value = typeof surface === 'function' ? await surface() : surface;
    } catch (err) {
      this.resultHost.textContent = `Error: ${(err as Error).message}`;
      return;
    }

    if (value instanceof HTMLElement) {
      this.resultHost.appendChild(value);
      return;
    }
    if (typeof value === 'string') {
      this.resultHost.textContent = value;
      return;
    }
    // Streaming surface { mount, stream } — host owns the DOM, gets the
    // root back as a writable handle. Mount first so the element is in
    // the document before the stream callback fires.
    if (isStreamingSurface(value)) {
      const root = value.mount;
      this.resultHost.appendChild(root);
      try {
        await value.stream(root);
      } catch (err) {
        const errLine = document.createElement('div');
        errLine.style.color = 'var(--error, #c11)';
        errLine.style.marginTop = '8px';
        errLine.textContent = `Error: ${(err as Error).message}`;
        root.appendChild(errLine);
      }
      return;
    }
    // AsyncIterable path — accepts plain strings (legacy delta-append
    // contract) OR structured ResultChunks (text / html / node / clear).
    if (value && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
      const out = document.createElement('div');
      this.resultHost.appendChild(out);
      try {
        for await (const chunk of value as AsyncIterable<string | ResultChunk>) {
          applyResultChunk(out, chunk);
        }
      } catch (err) {
        const errLine = document.createElement('div');
        errLine.style.color = 'var(--error, #c11)';
        errLine.style.marginTop = '8px';
        errLine.textContent = `Error: ${(err as Error).message}`;
        out.appendChild(errLine);
      }
    }
  }

  clearResult(): void {
    this.resultMode = false;
    if (this.resultHost) {
      this.resultHost.style.display = 'none';
      this.resultHost.textContent = '';
    }
    if (this.listSplit) this.listSplit.style.display = 'flex';
  }

  /** Snapshot of the currently-registered root items. Read-only — use
   *  `addItem` / `removeItem` / `setItems` to mutate. */
  getItems(): readonly PaletteItem[] {
    return this.rootItems.slice();
  }

  /** Replace the canonical root-level items. Public hosts use this for full
   *  re-registration; if the palette is open at a sub-menu level, the change
   *  takes effect on next open. */
  setItems(items: PaletteItem[]): void {
    this.rootItems = items.slice();
    if (this.subMenuStack.length === 0) {
      this.items = this.rootItems.slice();
      if (this.isOpen()) this.refilter();
    }
  }

  /**
   * Add or replace a palette item. If an item with the same `id` is already
   * registered, the new one REPLACES it in-place (preserving its position
   * in the list). This is what makes the i18n re-registration pattern work:
   *
   *   onLocaleChange((loc) => {
   *     palette.addItem({ id: 'theme', name: t(loc, 'theme.name'), ... });
   *     // ↑ replaces the previous 'theme' item, HeatRank usage carries over.
   *   });
   *
   * For full-replace registration, use `setItems()` instead.
   */
  addItem(item: PaletteItem): void {
    const existingRoot = this.rootItems.findIndex((i) => i.id === item.id);
    if (existingRoot >= 0) {
      this.rootItems[existingRoot] = item;
    } else {
      this.rootItems.push(item);
    }
    if (this.subMenuStack.length === 0) {
      const existing = this.items.findIndex((i) => i.id === item.id);
      if (existing >= 0) {
        this.items[existing] = item;
      } else {
        this.items.push(item);
      }
      if (this.isOpen()) this.refilter();
    }
  }

  removeItem(id: string): void {
    this.rootItems = this.rootItems.filter((i) => i.id !== id);
    if (this.subMenuStack.length === 0) {
      this.items = this.items.filter((i) => i.id !== id);
      if (this.isOpen()) this.refilter();
    }
  }

  /**
   * Register a batch of FAQ-style items so the user can browse the
   * answer right inside the palette — arrow keys land on a question,
   * the detail pane auto-renders the answer. Replaces the old
   * `toolbox/qa` module for UI flows.
   *
   * Each item's `question` / `answer` accepts a plain string OR a
   * locale-keyed dict (`{ en, 'zh-TW', ja, … }`). The palette resolves
   * the right string at registration time via `opts.locale` (falls back
   * to `en` then the first defined locale). Re-call on locale change
   * to refresh labels — same id replaces in place.
   *
   * The agent-tool counterpart lives at `dddk.tools.registerQA(...)` —
   * use that one to let the LLM look up answers itself.
   */
  addQAItems(items: QAPaletteItem[], opts: QAItemsOpts = {}): void {
    const locale = opts.locale ?? 'en';
    const section = opts.section ?? 'QA';
    const icon = opts.icon ?? '?';
    const idPrefix = opts.idPrefix ?? 'qa-';
    const renderAnswer = opts.renderAnswer ?? defaultQAAnswerSurface;
    for (const item of items) {
      const question = resolveLocalized(item.question, locale);
      const answer = resolveLocalized(item.answer, locale);
      if (!question || !answer) continue;
      this.addItem({
        id: `${idPrefix}${item.id}`,
        name: question,
        description: item.description
          ? resolveLocalized(item.description, locale)
          : undefined,
        section,
        icon,
        category: item.category,
        detail: () => renderAnswer({ question, answer, meta: item.meta }),
        handler: (p) => p.close(),
      });
    }
  }

  // ─── render ─────────────────────────────────────────────────────

  private render(): void {
    const root = document.createElement('div');
    root.setAttribute(UI_ATTR, 'palette-backdrop');

    const panel = document.createElement('div');
    panel.setAttribute(UI_ATTR, 'palette');

    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.placeholder = this.placeholder;
    inputEl.setAttribute(UI_ATTR, 'palette-input');
    inputEl.spellcheck = false;
    inputEl.autocomplete = 'off';
    inputEl.addEventListener('input', () => {
      // If a skill has hijacked the input via setInputContext({ onInput }),
      // route keystrokes there instead of the normal filter pipeline.
      if (this.inputContext?.onInput) {
        this.inputContext.onInput(this.input?.value ?? '', this.buildHandle());
      } else {
        this.refilter();
      }
    });

    const onKey = (e: KeyboardEvent) => this.onInputKey(e);
    inputEl.addEventListener('keydown', onKey);
    this.listeners.push(() => inputEl.removeEventListener('keydown', onKey));

    // Optional camera icon at right edge of input row.
    const inputRow = document.createElement('div');
    inputRow.setAttribute(UI_ATTR, 'palette-input-row');
    inputRow.appendChild(inputEl);
    if (this.camera) {
      const cameraBtn = this.buildCameraButton();
      inputRow.appendChild(cameraBtn);
    }

    const listEl = document.createElement('ul');
    listEl.setAttribute(UI_ATTR, 'palette-list');

    // Right-side detail pane (only visible when active item has .detail).
    const detailEl = document.createElement('div');
    detailEl.setAttribute(UI_ATTR, 'palette-detail');
    detailEl.style.display = 'none';

    const splitEl = document.createElement('div');
    splitEl.setAttribute(UI_ATTR, 'palette-split');
    splitEl.appendChild(listEl);
    splitEl.appendChild(detailEl);

    // Chip-bar between input and list — shows selection text + image attachments.
    const chipBar = document.createElement('div');
    chipBar.setAttribute(UI_ATTR, 'palette-context');
    chipBar.style.display = 'none';

    // Category chip row — rendered between the input and the list when the
    // host has configured `categories`. Each chip narrows the visible items
    // to those whose `category` matches its id.
    const categoryBar = document.createElement('div');
    categoryBar.setAttribute(UI_ATTR, 'palette-categories');
    categoryBar.style.display = 'none';

    // Result-mode host: when a handler calls `palette.showResult(...)` this
    // takes over the area below the input. Hidden in regular list mode.
    const resultEl = document.createElement('div');
    resultEl.setAttribute(UI_ATTR, 'palette-result');
    resultEl.style.display = 'none';

    // Always-visible keyboard hint footer.
    const footerEl = document.createElement('div');
    footerEl.setAttribute(UI_ATTR, 'palette-footer');
    footerEl.innerHTML = `
      <span data-dddk-ui="palette-footer-group">
        <kbd>↑</kbd><kbd>↓</kbd> <span>to navigate</span>
      </span>
      <span data-dddk-ui="palette-footer-group">
        <kbd>↵</kbd> <span>to select</span>
      </span>
      <span data-dddk-ui="palette-footer-group">
        <kbd>esc</kbd> <span>to close</span>
      </span>
    `;

    // Layout: chipbar SITS ABOVE the input (context-first reading order).
    // [chipbar] [input] [category-bar] [list/result] [footer]
    panel.appendChild(chipBar);
    panel.appendChild(inputRow);
    panel.appendChild(categoryBar);
    panel.appendChild(splitEl);
    panel.appendChild(resultEl);
    panel.appendChild(footerEl);
    root.appendChild(panel);
    this.detailHost = detailEl;
    this.chipBarHost = chipBar;
    this.categoryBarHost = categoryBar;
    this.resultHost = resultEl;
    this.listSplit = splitEl;
    this.renderCategoryBar();

    // ── Outside-click dismissal ────────────────────────────────
    // Use `mousedown` (not `click`) so the dismissal beats focus-stealing on
    // the page behind. We close whenever the press lands anywhere outside the
    // panel — robust to clicks on the empty area to the side of the panel,
    // below the panel, or any non-panel descendant of the backdrop.
    const onBackdropDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return;
      if (panel.contains(e.target)) return;
      // Defensive belt — if the row handler mutated the DOM (e.g. via
      // `p.replace(...)` from a sub-menu activation) the target may have
      // been detached BEFORE this bubbled handler runs, so it's no longer
      // in document. Treat detached targets as "originated inside the
      // palette" so we don't wrongly close. (The row's own mousedown also
      // stopPropagation's now, so this is suspenders + belt.)
      if (!document.contains(e.target)) return;
      e.preventDefault();
      this.close();
    };
    root.addEventListener('mousedown', onBackdropDown);
    this.listeners.push(() => root.removeEventListener('mousedown', onBackdropDown));

    // ── Focus trap ─────────────────────────────────────────────
    // Catch keyboard nav at document level too, so arrow keys never bubble
    // through to the page underneath after the user clicked something inside
    // the panel that wasn't the input. We re-focus the input on any inside
    // mousedown that lands on a non-button surface to keep typing alive.
    const onDocKey = (e: KeyboardEvent) => {
      if (!this.isOpen()) return;
      const t = e.target;
      // If keystroke originated outside the palette panel, intercept and route
      // to our handler instead — this prevents arrows from scrolling the page
      // behind the (blurred) backdrop after focus has leaked.
      if (t instanceof Node && !panel.contains(t)) {
        if (e.key === 'Escape' || e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          this.onInputKey(e);
          this.input?.focus();
        }
      }
    };
    document.addEventListener('keydown', onDocKey, true);
    this.listeners.push(() => document.removeEventListener('keydown', onDocKey, true));

    const onPanelMouseDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      // Refocus the input whenever the press lands on non-interactive panel
      // chrome (list rows, headers, chip-bar background) so the next keystroke
      // hits our keydown listener rather than nothing.
      const tag = t.tagName;
      if (tag !== 'INPUT' && tag !== 'BUTTON' && tag !== 'TEXTAREA') {
        // Defer to next tick so the click on a list item runs first.
        setTimeout(() => this.input?.focus(), 0);
      }
    };
    panel.addEventListener('mousedown', onPanelMouseDown);
    this.listeners.push(() => panel.removeEventListener('mousedown', onPanelMouseDown));

    document.body.appendChild(root);

    this.root = root;
    this.input = inputEl;
    this.list = listEl;

    // Render chip-bar now in case we opened with selection / attachments already.
    this.renderChipBar();
  }

  // ─── chip-bar (selection text + image attachments above input) ──

  private chipBarHost: HTMLDivElement | null = null;

  private renderChipBar(): void {
    const host = this.chipBarHost;
    if (!host) return;
    const hasSel = !!this.contextSelectionText;
    const hasAtt = this.contextAttachments.length > 0;
    if (!hasSel && !hasAtt) {
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }
    host.style.display = 'flex';
    host.innerHTML = '';

    if (hasSel) {
      const chip = document.createElement('div');
      const isDom = this.contextSelectionKind === 'dom';
      chip.className = isDom ? 'pal-chip pal-chip-sel pal-chip-dom' : 'pal-chip pal-chip-sel';
      chip.innerHTML = `
        <span class="pal-chip-label">${isDom ? 'DOM' : 'CONTEXT'}</span>
        <span class="pal-chip-text"></span>
        <button type="button" class="pal-chip-x" aria-label="Clear selection">✕</button>
      `;
      const textEl = chip.querySelector('.pal-chip-text');
      // DOM chips are usually short (`<tag#id.class> inner`); 80 chars keeps
      // the chip compact. Text chips can show more (120) since longer prose
      // selections benefit from extra preview.
      if (textEl) textEl.textContent = truncate(this.contextSelectionText, isDom ? 80 : 120);
      const xBtn = chip.querySelector<HTMLButtonElement>('.pal-chip-x');
      if (xBtn) xBtn.onclick = () => {
        this.contextSelectionText = '';
        this.contextSelectionElement = undefined;
        this.contextSelectionKind = 'text';
        this.renderChipBar();
      };
      host.appendChild(chip);
    }

    for (const att of this.contextAttachments) {
      const chip = document.createElement('div');
      chip.className = 'pal-chip pal-chip-att';
      // Image chips show the actual preview (no filename clutter).
      chip.innerHTML = `
        <img class="pal-chip-img" alt="" />
        <button type="button" class="pal-chip-x" aria-label="Remove">✕</button>
      `;
      const img = chip.querySelector<HTMLImageElement>('.pal-chip-img');
      if (img) img.src = att.thumbnailUrl;
      const xBtn = chip.querySelector<HTMLButtonElement>('.pal-chip-x');
      if (xBtn) xBtn.onclick = () => this.removeAttachment(att.id);
      host.appendChild(chip);
    }
  }

  private onInputKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      // Hierarchical back: Esc unwinds ONE layer at a time, only
      // closing the palette when no layers remain. Order matters —
      // result-mode (the rendered panel from showResult / a chat or
      // QA surface) sits on top of any sub-menu stack, so we exit it
      // first.
      //
      // 1. In result mode  → close result, restore list (parent menu)
      // 2. Sub-menu pushed → pop one
      // 3. Root level      → close the palette
      if (this.resultMode) {
        this.clearResult();
        this.clearInputContext();
        if (this.input) this.input.value = '';
        this.refilter();
      } else if (this.subMenuStack.length > 0) {
        const previous = this.subMenuStack.pop()!;
        this.items = previous;
        this.clearInputContext();
        if (this.input) this.input.value = '';
        this.refilter();
      } else {
        this.close();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.move(-1);
    } else if (e.key === 'Enter') {
      // If a sub-tool has hijacked the input (chat box, etc.) hand off to
      // its onSubmit and short-circuit the default "activate selected row"
      // behaviour. Empty input still bubbles up so users don't accidentally
      // fire a chat message by hitting Enter twice.
      if (this.inputContext) {
        e.preventDefault();
        const value = this.input?.value ?? '';
        if (value.trim().length === 0) return;
        this.inputContext.onSubmit(value, this.buildHandle());
        if (this.inputContext?.clearOnSubmit !== false && this.input) {
          this.input.value = '';
        }
        return;
      }
      e.preventDefault();
      this.activate(this.cursor);
    }
  }

  // ─── Input-context override ─────────────────────────────────────
  // A sub-tool (chat panel, search box for a specific dataset, ...) can
  // hijack the palette's top input — change its placeholder + redirect
  // Enter to a custom handler — without spawning a second input box. The
  // override clears automatically on Esc-back or palette close.

  private inputContext: {
    placeholder: string;
    onSubmit: (value: string, handle: PaletteHandle) => void;
    onInput?: (value: string, handle: PaletteHandle) => void;
    clearOnSubmit?: boolean;
    hideList?: boolean;
  } | null = null;

  setInputContext(ctx: {
    placeholder?: string;
    onSubmit: (value: string, handle: PaletteHandle) => void;
    /** Fires on every keystroke. Use for live-filter panels. */
    onInput?: (value: string, handle: PaletteHandle) => void;
    /** Clear the input after onSubmit fires. Default true. */
    clearOnSubmit?: boolean;
    /** Hide the list / typeahead while in this context. Default false. */
    hideList?: boolean;
  }): void {
    this.inputContext = {
      placeholder: ctx.placeholder ?? this.placeholder,
      onSubmit: ctx.onSubmit,
      onInput: ctx.onInput,
      clearOnSubmit: ctx.clearOnSubmit,
      hideList: ctx.hideList,
    };
    if (this.input) {
      this.input.placeholder = this.inputContext.placeholder;
      this.input.value = '';
    }
    if (this.inputContext.hideList && this.list) {
      this.list.style.display = 'none';
    }
  }

  clearInputContext(): void {
    if (!this.inputContext) return;
    this.inputContext = null;
    if (this.input) this.input.placeholder = this.placeholder;
    if (this.list) this.list.style.display = '';
  }

  // ─── camera icon ────────────────────────────────────────────────

  private buildCameraButton(): HTMLButtonElement {
    const cfg = this.camera!;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(UI_ATTR, 'palette-camera');
    btn.title = cfg.title ?? 'Attach image';
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
           stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 7h3l2-2h8l2 2h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    `;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cfg.mode === 'upload') this.openUpload();
      else this.openScreenshot();
    });
    return btn;
  }

  private openUpload(): void {
    const cfg = this.camera;
    if (!cfg) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = cfg.accept ?? 'image/*';
    if (cfg.capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) {
        // Auto-queue as a palette attachment so it shows in chip-bar.
        this.addAttachment({
          kind: 'image',
          blob: file,
          thumbnailUrl: URL.createObjectURL(file),
          source: 'upload',
          filename: file.name,
          sourceUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        });
        cfg.onCapture(file, 'upload');
      }
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  /**
   * Screenshot UX (re-implemented — no `getDisplayMedia`):
   *  1. Hide the palette panel (kept in DOM so re-opening is fast)
   *  2. Show a fullscreen crosshair overlay
   *  3. User drags a rectangle on the visible page
   *  4. Pass the rect to the host's `captureRect()` — host returns a Blob
   *  5. Attach the Blob, re-show the palette
   *
   * Esc / right-click / outside-mousedown cancels at any point.
   */
  private openScreenshot(): void {
    const cfg = this.camera;
    if (!cfg) return;
    if (!cfg.captureRect) {
      console.warn('[palette] screenshot mode requires a `captureRect` callback (e.g. via html2canvas).');
      return;
    }
    if (typeof document === 'undefined') return;
    if (!this.root) return;

    // Stash the panel so we can hide-then-restore without losing state.
    const panel = this.root.querySelector<HTMLElement>(`[${UI_ATTR}="palette"]`);
    if (panel) panel.style.visibility = 'hidden';
    this.root.style.background = 'transparent';
    this.root.style.backdropFilter = 'none';

    const overlay = document.createElement('div');
    overlay.setAttribute(UI_ATTR, 'palette-screenshot-overlay');
    overlay.innerHTML = `
      <div data-dddk-ui="palette-screenshot-rect"></div>
      <div data-dddk-ui="palette-screenshot-hint">框出要截取的範圍 · drag to select · esc to cancel</div>
    `;
    document.body.appendChild(overlay);
    const rectEl = overlay.querySelector<HTMLElement>('[data-dddk-ui="palette-screenshot-rect"]')!;

    let startX = 0, startY = 0;
    let dragging = false;
    let finalRect: { x: number; y: number; width: number; height: number } | null = null;

    const cleanup = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      if (panel) panel.style.visibility = '';
      if (this.root) {
        this.root.style.background = '';
        this.root.style.backdropFilter = '';
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
      }
    };
    document.addEventListener('keydown', onKey, true);

    overlay.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      rectEl.style.display = 'block';
      rectEl.style.left = `${startX}px`;
      rectEl.style.top = `${startY}px`;
      rectEl.style.width = '0px';
      rectEl.style.height = '0px';
    });
    overlay.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const x = Math.min(startX, e.clientX);
      const y = Math.min(startY, e.clientY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      rectEl.style.left = `${x}px`;
      rectEl.style.top = `${y}px`;
      rectEl.style.width = `${w}px`;
      rectEl.style.height = `${h}px`;
    });
    overlay.addEventListener('mouseup', async (e) => {
      if (!dragging) return;
      dragging = false;
      const x = Math.min(startX, e.clientX);
      const y = Math.min(startY, e.clientY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      if (w < 8 || h < 8) {
        cleanup();
        return;
      }
      finalRect = { x, y, width: w, height: h };
      cleanup();
      try {
        const blob = await cfg.captureRect!(finalRect);
        if (!blob) return;
        this.addAttachment({
          kind: 'image',
          blob,
          thumbnailUrl: URL.createObjectURL(blob),
          source: 'screenshot',
          sourceUrl: typeof window !== 'undefined' ? window.location.href : undefined,
          // No filename — UI doesn't show one; downstream agent gets the
          // source URL instead, which is more useful than `screenshot-12345`.
        });
        cfg.onCapture(blob, 'screenshot');
      } catch (err) {
        console.warn('[palette] screenshot captureRect failed:', err);
      }
    });
    // Right-click cancels.
    overlay.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      cleanup();
    });
  }

  private refilter(): void {
    const raw = this.input?.value ?? '';
    const q = raw.trim().toLowerCase();

    // 1. Prefix routing — detect items whose `prefix` matches the input start.
    const prefixMatch = this.matchPrefix(raw);

    if (prefixMatch) {
      const { item, arg } = prefixMatch;
      this.currentArg = arg;
      if (item.browse) {
        // Browse mode — host-supplied resource list under this prefix.
        // Section is overridable so a Tips-anchored parent can display
        // its children under a different heading.
        const sectionName =
          item.browseSection ??
          (item.section && item.section !== 'Tips' ? item.section : undefined) ??
          String(item.prefix);
        let browseItems: PaletteItem[] = [];
        try {
          browseItems = item.browse(arg) ?? [];
        } catch {
          browseItems = [];
        }
        if (arg) {
          const argLower = arg.toLowerCase();
          browseItems = browseItems
            .map((i) => ({ i, score: fuzzyScore(i, argLower) }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((x) => x.i)
            .slice(0, 50);
        } else {
          browseItems = browseItems.slice(0, 50);
        }
        this.filtered = browseItems.map((i) => ({
          ...i,
          section: i.section ?? sectionName,
        }));
        if (arg) {
          const echo = arg;
          for (const fb of this.items.filter((x) => x.fallback)) {
            this.filtered.push({ ...fb, description: `“${echo}”` });
          }
        }
      } else if (item.prefixAcceptsAnyArg) {
        // Show this item as the single top result. Optionally also show items
        // that fuzzy-match the arg (excluding Tips — they're hints, not picks).
        const others = arg
          ? this.items
              .filter((i) => i.id !== item.id && i.section !== 'Tips' && fuzzyScore(i, arg.toLowerCase()) > 0)
              .sort((a, b) => fuzzyScore(b, arg.toLowerCase()) - fuzzyScore(a, arg.toLowerCase()))
              .slice(0, 10)
          : [];
        this.filtered = [item, ...others];
      } else {
        // Items sharing the same prefix (Tips excluded).
        const sameGroup = this.items.filter((i) => i.prefix === item.prefix && i.section !== 'Tips');
        this.filtered = arg
          ? sameGroup
              .map((i) => ({ i, score: fuzzyScore(i, arg.toLowerCase()) }))
              .filter((x) => x.score > 0)
              .sort((a, b) => b.score - a.score)
              .map((x) => x.i)
              .slice(0, 50)
          : sameGroup.slice(0, 50);
      }
    } else if (!q) {
      this.currentArg = '';
      // Empty state — show everything EXCEPT items whose prefix is already
      // represented by a Tips row. So `/theme` (a Tip) shows once under
      // Tips; the underlying `theme-toggle` command (same prefix, sits in
      // Settings) is hidden to avoid duplication. Items WITHOUT a prefix
      // (Skills, Go to navigation rows, …) always show because they have
      // no Tip surrogate that could replace them. Fallbacks stay hidden.
      const tipPrefixes = new Set<string>();
      for (const i of this.items) {
        if (i.section === 'Tips' && i.prefix) {
          for (const p of listPrefixMatches(i.prefix)) {
            tipPrefixes.add(p.toLowerCase());
          }
        }
      }
      this.filtered = this.items.filter((i) => {
        if (i.fallback) return false;
        if (i.searchOnly) return false;
        if (i.section === 'Tips') return true;
        if (!i.prefix) return true;
        return !listPrefixMatches(i.prefix).some((p) => tipPrefixes.has(p.toLowerCase()));
      }).slice(0, 100);
    } else if (this.looksLikePrefixAttempt(raw)) {
      // Partial-prefix typing — user has typed `/`, `nav`, `ask` etc. but
      // hasn't completed any registered prefix. Show ONLY the commands whose
      // declared prefix starts with what they've typed. No page-text search,
      // no AI fallback (yet — they're trying to pick a command). Items
      // tagged `section: 'Tips'` are empty-state discovery rows — drop them
      // here so they don't duplicate the real commands.
      // currentArg holds the raw input so highlightMatch can mark the typed
      // characters inside the matched command name (e.g. user types `/them`,
      // `/theme` row shows `/them` in highlight + trailing `e`).
      this.currentArg = raw.trim();
      const partial = raw.toLowerCase();
      this.filtered = this.items
        .filter((i) => !i.fallback)
        .filter((i) => !i.searchOnly)
        .filter((i) => i.section !== 'Tips')
        .filter((i) => listPrefixMatches(i.prefix).some((p) => p.toLowerCase().startsWith(partial)))
        .slice(0, 50);
    } else {
      // Use raw-trimmed input for currentArg so fallback handlers (Ask AI etc.)
      // receive the user's original casing. Fuzzy scoring still uses `q`
      // (lowercased) for matching, which is what we want for search.
      this.currentArg = raw.trim();
      // Prefixed items ARE included in free-text search — typing `lan`
      // surfaces `/language` via substring match on the name. Excluding
      // them previously meant prefix commands were unreachable from a
      // plain-text query (the user had to know the leading symbol first).
      // The prefix routing earlier branches already short-circuit on exact
      // / partial prefix typing, so this only fires when the user's query
      // does NOT look like any registered prefix.
      const matched = this.items
        .filter((i) => !i.fallback)
        .filter((i) => i.section !== 'Tips')
        .map((item) => ({ item, score: fuzzyScore(item, q) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.item)
        .slice(0, 50);

      this.filtered = matched;

      // (Body-text page search is no longer auto-fired here. The host can
      // gate it behind a prefix tip like `#` whose `browse()` calls into
      // its own DOM-text search — keeps free-text typing strictly about
      // matching registered palette items + the Ask AI fallback.)

      // Fallback rows are appended whenever the user has typed something
      // real, so an "Ask AI — '<query>'" row stays discoverable at the
      // bottom of the list. Each registered fallback becomes one row with
      // the live query echoed in the description.
      const fallbacks = this.items.filter((i) => i.fallback);
      const echo = raw.trim();
      for (const f of fallbacks) {
        this.filtered.push({
          ...f,
          description: `“${echo}”`,
        });
      }
    }
    // Category-chip filter — when the host configured `categories` and the
    // user clicked a chip other than "All", drop items whose `category`
    // doesn't match. Tips rows are kept either way so the discovery row
    // stays visible regardless of which chip is active.
    if (this.activeCategoryId) {
      const active = this.activeCategoryId;
      this.filtered = this.filtered.filter(
        (i) => i.section === 'Tips' || i.fallback || i.category === active,
      );
    }

    // Apply HeatRank sort (stable: keeps original tie-break order)
    if (this.heatRank && this.filtered.length > 1) {
      const rank = this.heatRank;
      this.filtered = rank.sort(this.filtered, (i) => i.id, () => 0);
    }

    // Context promotion — when chip-bar has anything attached (selection
    // text, pinned element, image), pull the registered fallback rows to
    // the TOP so pressing Enter immediately routes the captured context to
    // the agent. Skip when the user is actively drilling into a registered
    // prefix (their intent is "browse / pick from this resource", not
    // "ask AI about my selection"). Host can opt out via
    // `contextPromotesFallback: false`.
    if (!prefixMatch && this.contextPromotesFallback && this.hasChipContext()) {
      const fbItems = this.items.filter((i) => i.fallback);
      if (fbItems.length > 0) {
        // Drop any fallback rows the earlier branches already appended at
        // the bottom — we'll re-add them at the top instead.
        this.filtered = this.filtered.filter((i) => !i.fallback);
        const echo = raw.trim();
        const promoted = fbItems.map((fb) => ({
          ...fb,
          description: echo
            ? `“${echo}”`
            : (fb.description ?? '送選取的內容給 AI · use captured context'),
        }));
        this.filtered = [...promoted, ...this.filtered];
      }
    }

    this.cursor = 0;
    this.renderList();
  }

  /** True when the chip bar has any user-pinned context attached. */
  private hasChipContext(): boolean {
    return this.contextSelectionText.trim().length > 0
      || this.contextAttachments.length > 0;
  }

  /**
   * True when the user has typed the START of a registered prefix but not
   * the whole thing — e.g. `/`, `/t`, `nav`, `ask`. In that state we want
   * to filter the palette to commands whose prefix begins with the input,
   * NOT run a fuzzy / page-text search.
   */
  private looksLikePrefixAttempt(input: string): boolean {
    if (input.length === 0) return false;
    const lowered = input.toLowerCase();
    for (const item of this.items) {
      for (const p of listPrefixMatches(item.prefix)) {
        const pl = p.toLowerCase();
        if (pl === lowered) return false; // exact match already routes via matchPrefix
        if (pl.startsWith(lowered) && p.length > input.length) return true;
      }
    }
    return false;
  }

  /**
   * Find the item whose prefix matches the input.
   *   - Longest prefix wins (so `ask ai:` beats a hypothetical `ask:`).
   *   - Non-Tips items beat Tips items at the same length (a Tip is a hint
   *     row that lives in section `'Tips'`; the real command in another
   *     section is what should actually fire when the user types the prefix).
   */
  private matchPrefix(input: string): { item: PaletteItem; arg: string } | null {
    // Case-insensitive: `Docs:`, `DOCS:`, `docs:` all route to the same item.
    const loweredInput = input.toLowerCase();
    let best: { item: PaletteItem; arg: string; prefixLen: number; isTip: boolean } | null = null;
    for (const item of this.items) {
      const isTip = item.section === 'Tips';
      const matches = listPrefixMatches(item.prefix);
      for (const m of matches) {
        if (loweredInput.startsWith(m.toLowerCase())) {
          const len = m.length;
          const better =
            !best ||
            (best.isTip && !isTip) ||
            (best.isTip === isTip && len > best.prefixLen);
          if (better) {
            best = { item, arg: input.slice(len).trim(), prefixLen: len, isTip };
          }
        }
      }
    }
    return best ? { item: best.item, arg: best.arg } : null;
  }

  /**
   * Render the filtered item list. Each `<li>` carries a `data-idx` matching
   * its index in `this.filtered`, so:
   *  - hover does NOT rebuild the DOM — it just toggles `data-active` on the
   *    existing nodes. (Critical: rebuilding the `<li>` during a press
   *    destroys the click target and the click bubbles to the `<ul>` instead,
   *    making items appear unclickable.)
   *  - the click handler reads `data-idx` from the row at click-time, so it
   *    survives any re-renders triggered by other events.
   *
   * If `tipsItems` is present we also prepend a `Tips` section showing the
   * prefixes the user can type to filter (ask: / find: / go: hints at the top).
   */

  /**
   * Render or refresh the category chip row. Hidden when no categories
   * were configured. Active chip is highlighted via `data-active="true"`.
   */
  private renderCategoryBar(): void {
    const host = this.categoryBarHost;
    if (!host) return;
    if (this.categories.length === 0) {
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }
    host.style.display = '';
    host.innerHTML = '';
    const chips: PaletteCategory[] = [
      { id: '', label: this.allCategoriesLabel },
      ...this.categories,
    ];
    for (const c of chips) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute(UI_ATTR, 'palette-category');
      btn.dataset.id = c.id;
      const isActive = (this.activeCategoryId ?? '') === c.id;
      btn.setAttribute('data-active', String(isActive));
      btn.textContent = c.label;
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
      btn.addEventListener('click', () => {
        this.activeCategoryId = c.id ? c.id : null;
        this.renderCategoryBar();
        this.refilter();
        this.input?.focus();
      });
      host.appendChild(btn);
    }
  }

  private renderList(): void {
    if (!this.list) return;
    this.list.innerHTML = '';

    // (Tips rows are now part of `this.filtered` in empty-state — see
    // `refilter()` + `buildTipItems()`. The section header gets emitted by
    // the normal lastSection logic below since they all have `section: 'Tips'`.)

    let lastSection = '';
    this.filtered.forEach((item, idx) => {
      const section = item.section ?? 'Commands';
      if (section !== lastSection) {
        const header = document.createElement('li');
        header.setAttribute(UI_ATTR, 'palette-section');
        header.textContent = section;
        this.list!.appendChild(header);
        lastSection = section;
      }

      const li = document.createElement('li');
      li.setAttribute(UI_ATTR, 'palette-item');
      li.dataset.idx = String(idx);
      if (idx === this.cursor) li.setAttribute('data-active', 'true');
      const prefixLabel = displayPrefix(item.prefix);

      // Layout rule: hide the bold `name` slot when it would just repeat the
      // prefix pill (case-insensitive). Two flavours of prefix items:
      //   - `/theme` registered with `name: '/theme'`  →  pill is the name;
      //     row reads as `[/theme] — toggle light/dark`. No duplication.
      //   - `nav:` items registered with `name: 'Home'` →  pill is the
      //     family, name is the destination; both shown.
      const showName = !prefixLabel
        || prefixLabel.toLowerCase() !== item.name.toLowerCase();
      // Highlight query matches in name + description. Fallback items render
      // the user's query inside their description (e.g. Ask AI — “foo”) — we
      // intentionally skip highlighting on them so the echoed query stays
      // visually clean as a single token.
      const hl = item.fallback ? '' : (this.currentArg ?? '');
      // Icon: glyph string is escaped; inline SVG (starts with `<svg`) is
      // passed through so hosts can use lucide / heroicons / custom SVG
      // without an SDK API change. Host controls the icon string, so this
      // is not an injection vector — it's the same trust boundary as
      // `agentTool.description` etc.
      const iconHtml = item.icon
        ? (item.icon.trimStart().startsWith('<svg')
            ? item.icon
            : escapeHtml(item.icon))
        : '';
      li.innerHTML = `
        ${iconHtml ? `<span data-dddk-ui="palette-item-icon">${iconHtml}</span>` : ''}
        ${prefixLabel ? `<span data-dddk-ui="palette-item-prefix">${highlightMatch(prefixLabel, hl)}</span>` : ''}
        ${showName ? `<span data-dddk-ui="palette-item-name">${highlightMatch(item.name, hl)}</span>` : ''}
        ${item.description ? `<span data-dddk-ui="palette-item-dash">—</span><span data-dddk-ui="palette-item-desc">${highlightMatch(item.description, hl)}</span>` : ''}
        ${item.shortcut ? `<span data-dddk-ui="palette-item-shortcut">${escapeHtml(item.shortcut)}</span>` : ''}
      `;
      li.addEventListener('mouseenter', () => this.setCursor(idx));
      // Use mousedown so the activation happens before any blur side-effects.
      // stopPropagation is critical: activate() can call handler that runs
      // `p.replace(...)`, which removes THIS li from the DOM mid-event. Once
      // detached, the bubbling mousedown reaches the backdrop handler which
      // checks `panel.contains(e.target)` — the now-detached target fails
      // that check and the palette wrongly closes. Stop the bubble so the
      // backdrop never sees the click. (Click-outside still works because
      // those clicks land on the backdrop directly, not on a row.)
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();    // keep input focus
        e.stopPropagation();   // do NOT bubble to the backdrop close handler
        this.activate(idx);
      });
      this.list!.appendChild(li);
    });
  }

  /** Set the highlighted row without re-rendering. */
  private setCursor(idx: number): void {
    if (this.cursor === idx) return;
    this.cursor = idx;
    if (!this.list) return;
    const rows = this.list.querySelectorAll<HTMLLIElement>('[data-idx]');
    rows.forEach((row) => {
      if (Number(row.dataset.idx) === idx) row.setAttribute('data-active', 'true');
      else row.removeAttribute('data-active');
    });
    this.renderDetailFor(this.filtered[idx]);
  }

  // (Tips are now host-defined: the host registers items with
  //  `section: 'Tips'` directly. The SDK does not generate them.)

  private move(delta: number): void {
    const next = Math.max(0, Math.min(this.filtered.length - 1, this.cursor + delta));
    this.setCursor(next);
    this.list?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }

  /** Render the right detail pane if the active item provides `detail()`. */
  private async renderDetailFor(item: PaletteItem | undefined): Promise<void> {
    if (!this.detailHost) return;
    if (!item?.detail) {
      this.detailHost.innerHTML = '';
      this.detailHost.style.display = 'none';
      return;
    }
    this.detailHost.style.display = 'block';
    this.detailHost.innerHTML = '<div data-dddk-ui="palette-detail-loading">…</div>';

    try {
      const surface = await item.detail(this.currentArg || undefined);
      if (!this.pieceCatalog) {
        const { createBuiltinCatalog } = await import('../ui/pieces');
        this.pieceCatalog = createBuiltinCatalog();
      }
      // Shared interactive DOM renderer — same engine that powers
      // `dddk.panel` and any other host-mounted Pieces surface.
      const { PieceDomRenderer } = await import('../ui/pieces/dom-renderer');
      this.detailHost.innerHTML = '';
      // Detail pane is preview-only: inputs render but stay read-only so
      // a focused-row preview can't mutate state behind the user's back.
      const renderer = new PieceDomRenderer({ catalog: this.pieceCatalog, readOnly: true });
      renderer.mount(this.detailHost, surface);
    } catch (err) {
      this.detailHost.innerHTML = `<div data-dddk-ui="palette-detail-error">${String((err as Error).message)}</div>`;
    }
  }

  private activate(idx: number): void {
    const item = this.filtered[idx];
    if (!item) {
      // Implicit fallback — list is empty and the user pressed Enter on a
      // non-empty query. If exactly one fallback item is registered, fire
      // it with the raw input as arg. Lets `plain text + Enter → webagent`
      // Just Work without ever rendering an "Ask AI" row.
      const raw = this.input?.value.trim() ?? '';
      if (!raw) return;
      const fallbacks = this.rootItems.filter((i) => i.fallback);
      if (fallbacks.length === 1) {
        const fb = fallbacks[0]!;
        this.heatRank?.visit(fb.id);
        this.onActivate?.({
          itemId: fb.id,
          arg: raw,
          selectionText: this.contextSelectionText || undefined,
          attachmentsCount: this.contextAttachments.length,
        });
        fb.handler?.(this.buildHandle(), raw);
      }
      return;
    }

    // Record usage in HeatRank so it floats up next time.
    this.heatRank?.visit(item.id);

    // Notify host (orchestrator) — used for `intent` event emission.
    this.onActivate?.({
      itemId: item.id,
      arg: this.currentArg || undefined,
      selectionText: this.contextSelectionText || undefined,
      attachmentsCount: this.contextAttachments.length,
    });

    if (!item.handler) {
      // Detail-only items don't need to do anything on activate.
      return;
    }
    item.handler(this.buildHandle(), this.currentArg || undefined);
  }

  private buildHandle(): PaletteHandle {
    const self = this;
    const inputRef = this.input;
    return {
      close: () => this.close(),
      replace: (items) => {
        // Push the current visible set onto the sub-menu stack so Esc can
        // pop back to it. (The user's `addItem`-registered root list lives
        // separately in `rootItems` and is restored on next `open()`.)
        this.subMenuStack.push(this.items);
        this.items = items;
        if (this.input) this.input.value = '';
        this.refilter();
      },
      get input() {
        return inputRef?.value ?? '';
      },
      setInput: (value) => {
        if (self.input) {
          self.input.value = value;
          self.refilter();
        }
      },
      get context(): PaletteContext {
        return {
          selectionText: self.contextSelectionText,
          selectionElement: self.contextSelectionElement,
          attachments: self.contextAttachments.slice(),
        };
      },
      showResult: (surface) => self.showResult(surface),
      clearResult: () => self.clearResult(),
      setInputContext: (ctx) => self.setInputContext(ctx),
      clearInputContext: () => self.clearInputContext(),
    };
  }
}

// ─── helpers used inside the class ──────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

// ─── helpers ────────────────────────────────────────────────────────

/**
 * Lazy hay-cache for fuzzy lookup. Concatenating name + description +
 * keywords on every keystroke for every item is O(N * L) per char with
 * non-trivial constants on hundreds of items, so we stash the lowercased
 * haystack on the item once and reuse it. setItems() invalidates by
 * replacing the item array entirely.
 */
interface PaletteItemWithHay extends PaletteItem {
  __searchHay?: string;
  __searchNameLower?: string;
}

/**
 * Wrap EVERY contiguous occurrence of `query` in `text` with a
 * `<mark data-dddk-ui="palette-match">` so it renders with the highlight
 * style (warm yellow / themed). Case-insensitive, non-overlapping. Falls
 * back to plain escaped text when the query is empty or has no match.
 *
 * Only contiguous substring matches highlight — fuzzy character matches
 * don't, because per-char highlights read as visual noise.
 */
function highlightMatch(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const segments: string[] = [];
  let cursor = 0;
  let hit = haystack.indexOf(needle, cursor);
  if (hit < 0) return escapeHtml(text);
  while (hit >= 0) {
    if (hit > cursor) segments.push(escapeHtml(text.slice(cursor, hit)));
    segments.push(
      `<mark data-dddk-ui="palette-match">${escapeHtml(text.slice(hit, hit + needle.length))}</mark>`,
    );
    cursor = hit + needle.length;
    hit = haystack.indexOf(needle, cursor);
  }
  if (cursor < text.length) segments.push(escapeHtml(text.slice(cursor)));
  return segments.join('');
}

function fuzzyScore(item: PaletteItem, query: string): number {
  // Substring-only — require a contiguous match. Hosts that want
  // typo tolerance should add alternate keywords on the item itself.
  const it = item as PaletteItemWithHay;
  let hay = it.__searchHay;
  if (hay == null) {
    hay = `${item.name} ${item.description ?? ''} ${(item.keywords ?? []).join(' ')}`.toLowerCase();
    it.__searchHay = hay;
  }
  if (!hay.includes(query)) return 0;
  // Boost for prefix match on name — also tolerate a leading symbol
  // (`/`, `#`, `>`) so `/language` ranks high on query `lan` / `language`.
  let nameLower = it.__searchNameLower;
  if (nameLower == null) {
    nameLower = item.name.toLowerCase();
    it.__searchNameLower = nameLower;
  }
  if (nameLower.startsWith(query)) return 10;
  // Strip a single leading non-alphanumeric character and retry — handles
  // skill-style names like `/language` against bare-word queries.
  if (/^[^a-z0-9]/.test(nameLower) && nameLower.slice(1).startsWith(query)) return 9;
  return 5;
}

function flashElement(el: HTMLElement): void {
  const original = el.style.outline;
  el.style.outline = '2px solid var(--dddk-accent, #ec4899)';
  el.style.outlineOffset = '2px';
  setTimeout(() => {
    el.style.outline = original;
    el.style.outlineOffset = '';
  }, 1500);
}

// ─── streaming result helpers ─────────────────────────────────────

function isStreamingSurface(v: unknown): v is StreamingResultSurface {
  return (
    !!v &&
    typeof v === 'object' &&
    'mount' in v &&
    'stream' in v &&
    (v as StreamingResultSurface).mount instanceof HTMLElement &&
    typeof (v as StreamingResultSurface).stream === 'function'
  );
}

/**
 * Apply one streamed chunk to the running content frame.
 * Plain strings keep the legacy "yield deltas, get appended" contract
 * so existing callers don't break.
 */
function applyResultChunk(out: HTMLElement, chunk: string | ResultChunk): void {
  if (typeof chunk === 'string') {
    out.textContent = (out.textContent ?? '') + chunk;
    return;
  }
  if ('clear' in chunk) {
    out.textContent = '';
    return;
  }
  if ('delta' in chunk) {
    out.textContent = (out.textContent ?? '') + chunk.delta;
    return;
  }
  if ('text' in chunk) {
    out.textContent = chunk.text;
    return;
  }
  if ('html' in chunk) {
    if (chunk.append) out.insertAdjacentHTML('beforeend', chunk.html);
    else out.innerHTML = chunk.html;
    return;
  }
  if ('node' in chunk) {
    if (chunk.append) out.appendChild(chunk.node);
    else {
      out.textContent = '';
      out.appendChild(chunk.node);
    }
  }
}

