/**
 * CommandPalette — Ctrl/⌘+K input overlay rendered into the DOM.
 *
 * This file is the shell: lifecycle (open/close), DOM scaffolding (render),
 * keyboard handling, list rendering, and the public class surface. The
 * sub-files in this folder own:
 *   - styles.ts      — injected CSS + shared `UI_ATTR` / `STYLE_ID`
 *   - types.ts       — all public type / interface contracts
 *   - prefix.ts      — prefix routing helpers (pure functions)
 *   - fuzzy.ts       — fuzzy filter + match-highlight
 *   - chip-bar.ts    — chip strip + pinned-context lifecycle
 *   - qa.ts          — locale-resolved QA item registration
 *   - screenshot.ts  — drag-rect screenshot overlay
 */

import { escapeHtml } from '../../utils/dom';
import { sdkString, type SdkI18nKey } from '../../utils/sdk-i18n';
import { inferSelector } from '../../utils/selector';
import { ensurePaletteStyles, UI_ATTR } from './styles';
import type {
  CameraOptions,
  CommandPaletteOptions,
  PaletteAttachment,
  PaletteCategory,
  PaletteContext,
  PaletteHandle,
  PaletteItem,
  QAItemsOpts,
  QAPaletteItem,
  ResultChunk,
  ResultSurface,
  StreamingResultSurface,
} from './types';
import {
  displayPrefix,
  listPrefixMatches,
  looksLikePrefixAttempt,
  matchPrefix,
} from './prefix';
import { fuzzyTopN, highlightMatch } from './fuzzy';
import {
  addAttachment as chipAddAttachment,
  captureContextOnOpen as chipCaptureContextOnOpen,
  type ChipBarHost,
  clearAttachments as chipClearAttachments,
  readPinnedTextLive as chipReadPinnedTextLive,
  removeAttachment as chipRemoveAttachment,
  renderChipBar as chipRenderChipBar,
  type SelectionKind,
  setPinnedContext as chipSetPinnedContext,
} from './chip-bar';
import { addQAItems as helperAddQAItems } from './qa';
import { openScreenshot as helperOpenScreenshot, type ScreenshotHost } from './screenshot';

// Re-export public types / values so import paths
// (`./triggers/command-palette`, `@perhapxin/dddk`) keep working unchanged.
export type {
  CameraOptions,
  CommandPaletteOptions,
  LocalizedText,
  PaletteAgentTool,
  PaletteAttachment,
  PaletteCategory,
  PaletteContext,
  PaletteHandle,
  PaletteItem,
  PaletteItemPrefix,
  QAItemsOpts,
  QAPaletteItem,
  ResultChunk,
  ResultSurface,
  StreamingResultSurface,
} from './types';
export { displayPrefix, listPrefixMatches } from './prefix';

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
  private detailRenderToken = 0;
  private items: PaletteItem[];
  private subMenuStack: PaletteItem[][] = [];
  private placeholder: string;
  /** True while the palette is embedded inline in a host (vs the Ctrl/⌘+K modal). */
  private inlineMounted = false;
  /** Saved inline surface refs while a modal (Ctrl/⌘+K) is opened on top of it. */
  private suspendedInline: {
    root: HTMLDivElement | null; input: HTMLInputElement | null; list: HTMLUListElement | null;
    detailHost: HTMLDivElement | null; chipBarHost: HTMLDivElement | null;
    categoryBarHost: HTMLDivElement | null; resultHost: HTMLDivElement | null;
    listSplit: HTMLDivElement | null; listeners: Array<() => void>;
  } | null = null;
  /** Locale for the bundled chrome strings. Read at construction; can
   *  be flipped at runtime via `setLocale()` — the next render picks
   *  up the new strings (footer hints + placeholder). */
  private locale: string | undefined;
  private searchPage?: CommandPaletteOptions['searchPage'];
  private contextPromotesFallback = true;

  private root: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private list: HTMLUListElement | null = null;
  private filtered: PaletteItem[] = [];
  private cursor = 0;
  private currentArg = '';
  private listeners: Array<() => void> = [];

  private heatRank?: import('../../utils/heat-rank').HeatRank;
  private pieceCatalog?: import('../../ui/pieces').PieceCatalog;
  private detailHost: HTMLDivElement | null = null;
  private categoryBarHost: HTMLDivElement | null = null;
  private categories: PaletteCategory[] = [];
  private allCategoriesLabel = 'All';
  private activeCategoryId: string | null = null;
  private camera?: CameraOptions;
  private submitButton?: boolean;
  private onActivate?: CommandPaletteOptions['onActivate'];
  // PaletteContext fields — populated on open / camera capture.
  private contextSelectionText = '';
  private contextSelectionElement?: string;
  private contextSelectionKind: SelectionKind = 'text';
  private contextAttachments: PaletteAttachment[] = [];

  /**
   * Host-supplied pinned context. Set by `setPinnedContext()` and consumed
   * on each `open()`. Used by modules like Dwell that pin an element
   * BEFORE the palette opens — when the palette eventually opens, this is
   * what its chipbar surfaces.
   *
   * `pinnedContextEl` stores the ELEMENT REFERENCE directly (not a CSS
   * selector). At open time we check `el.isConnected && document.contains(el)`
   * — if the element has been unmounted (SPA route change, list virtualised,
   * etc.) the pin is auto-invalidated WITHOUT having to trust any selector
   * lookup. Structural selectors (`body>main>section:nth-child(3)`) match
   * different content on different pages; element references can't.
   */
  private pinnedContextEl: Element | null = null;
  private pinnedContextText = '';
  private pinnedContextKind: SelectionKind = 'text';

  // ─── in-place result mode ──────────────────────────────────────
  private resultHost: HTMLDivElement | null = null;
  private listSplit: HTMLDivElement | null = null;
  private resultMode = false;

  // ─── chip-bar host element ────────────────────────────────────
  private chipBarHost: HTMLDivElement | null = null;

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

  constructor(opts: CommandPaletteOptions = {}) {
    this.rootItems = opts.initialItems ?? [];
    this.items = this.rootItems.slice();
    this.locale = opts.locale;
    this.placeholder = opts.placeholder ?? sdkString(this.locale, 'palette.placeholder');
    this.searchPage = opts.searchPage;
    this.heatRank = opts.heatRank;
    this.pieceCatalog = opts.pieceCatalog;
    this.contextPromotesFallback = opts.contextPromotesFallback ?? true;
    this.camera = opts.camera;
    this.submitButton = opts.submitButton;
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

  /** Update the locale for the bundled chrome strings (placeholder,
   *  footer hints). Next palette open picks up the new strings. The
   *  open-right-now palette is patched in place too. */
  setLocale(locale: string): void {
    this.locale = locale;
    this.placeholder = sdkString(locale, 'palette.placeholder');
    if (this.input) this.input.placeholder = this.placeholder;
    this.refreshFooter();
  }

  /** Rebuild the kbd hint row to match the current locale + state.
   *  Esc flips between "close" (root level) and "back" (inside a result
   *  surface or a sub-menu — anywhere Esc unwinds one layer instead of
   *  closing the whole palette). Idempotent; safe to call on every
   *  state transition. */
  private refreshFooter(): void {
    if (!this.root) return;
    const footer = this.root.querySelector<HTMLElement>(`[${UI_ATTR}="palette-footer"]`);
    if (!footer) return;
    const escKey: SdkI18nKey = this.hasInternalEsc() ? 'palette.footer.back' : 'palette.footer.close';
    footer.innerHTML = `
      <span data-dddk-ui="palette-footer-group">
        <kbd>↑</kbd><kbd>↓</kbd> <span>${escapeHtml(sdkString(this.locale, 'palette.footer.navigate'))}</span>
      </span>
      <span data-dddk-ui="palette-footer-group">
        <kbd>↵</kbd> <span>${escapeHtml(sdkString(this.locale, 'palette.footer.select'))}</span>
      </span>
      <span data-dddk-ui="palette-footer-group">
        <kbd>esc</kbd> <span>${escapeHtml(sdkString(this.locale, escKey))}</span>
      </span>
    `;
  }

  toggle(initialSelection?: string): void {
    // A modal that is open (and not sitting over an inline mount) → close it.
    // Otherwise open the modal. When inline-mounted, opening suspends the inline
    // surface and shows the full modal on top; closing restores the inline.
    if (this.isOpen() && !this.inlineMounted) this.close();
    else this.open(initialSelection);
  }

  /** Programmatically set the palette's search input value (and refilter
   *  the visible list). Used by hosts driving the palette from outside —
   *  e.g. the webagent's `open_palette({ initialInput })` tool seeds a
   *  prefix command like `docs:` so the user lands on the right sub-list. */
  setInputValue(value: string): void {
    if (this.input) {
      this.input.value = value;
      this.refilter();
    }
  }

  open(initialSelection?: string, opts?: { focusInput?: boolean }): void {
    if (this.inlineMounted) {
      // Suspend the inline surface and render the full modal on top of it. The
      // inline DOM stays in the host (hidden behind the backdrop) and is restored
      // by close(). This is what lets Ctrl/⌘+K open the modal from a page that
      // already shows the palette inline.
      this.suspendedInline = {
        root: this.root, input: this.input, list: this.list,
        detailHost: this.detailHost, chipBarHost: this.chipBarHost,
        categoryBarHost: this.categoryBarHost, resultHost: this.resultHost,
        listSplit: this.listSplit, listeners: this.listeners,
      };
      this.listeners = [];
      this.inlineMounted = false;
      if (this.suspendedInline.root) this.suspendedInline.root.style.display = 'none';
    } else if (this.isOpen()) return;
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
    // Default behaviour: auto-focus the input so the user can start typing
    // immediately. Programmatic openers (the webagent's `open_palette` tool)
    // pass `focusInput: false` to keep focus on body — that way the user can
    // still press Space to advance the agent without typing literal spaces
    // into the palette input, and the agent's narration / pause flow keeps
    // working naturally.
    const focusInput = opts?.focusInput ?? true;
    if (focusInput) {
      requestAnimationFrame(() => this.input?.focus());
    }
  }

  close(): void {
    // Inline-mounted palette is PERSISTENT — a handler calling handle.close()
    // (e.g. after navigating or starting the agent) must NOT tear the embedded
    // palette out of the page. Reset it to its root state instead. Actual
    // teardown only happens via the cleanup fn returned by mountInline().
    if (this.inlineMounted) {
      if (this.resultMode) this.clearResult();
      this.clearInputContext();
      this.subMenuStack = [];
      this.items = this.rootItems.slice();
      if (this.input) this.input.value = '';
      this.clearContext();
      this.refilter();
      this.refreshFooter();
      return;
    }
    if (!this.root) return;
    this.listeners.forEach((fn) => fn());
    this.listeners = [];
    this.root.remove();
    // If this modal was covering an inline mount, restore the inline surface
    // instead of tearing the palette down entirely.
    if (this.suspendedInline) {
      const s = this.suspendedInline;
      this.suspendedInline = null;
      this.root = s.root;
      this.input = s.input;
      this.list = s.list;
      this.detailHost = s.detailHost;
      this.chipBarHost = s.chipBarHost;
      this.categoryBarHost = s.categoryBarHost;
      this.resultHost = s.resultHost;
      this.listSplit = s.listSplit;
      this.listeners = s.listeners;
      this.inlineMounted = true;
      if (this.root) this.root.style.display = '';
      this.clearContext();
      this.inputContext = null;
      // Keep the inline input's own placeholder (host-configured) — only clear text.
      if (this.input) this.input.value = '';
      this.items = this.rootItems.slice();
      this.subMenuStack = [];
      this.refilter();
      return;
    }
    this.root = null;
    this.input = null;
    this.list = null;
    // Clear context — next open re-captures fresh.
    this.clearContext();
    // Drop any sub-tool input override so the next open starts at the
    // default search placeholder, not whatever the last tool installed.
    this.inputContext = null;
  }

  /**
   * Mount the palette INLINE inside a host element, persistently visible —
   * no backdrop, no outside-click dismissal. It shares the exact same items,
   * filtering, keyboard navigation and row rendering as the Ctrl/⌘+K modal,
   * so the host writes ONE set of palette items and gets both surfaces.
   * While inline-mounted, `open()` / `toggle()` (e.g. Ctrl+K) just focus the
   * embedded input instead of spawning the modal.
   *
   * Returns a teardown function — call it when the host element unmounts
   * (e.g. SPA route change) to detach the palette and its listeners.
   */
  mountInline(host: HTMLElement, opts?: { placeholder?: string; focus?: boolean }): () => void {
    if (this.isOpen()) this.close();
    ensurePaletteStyles();
    this.items = this.rootItems.slice();
    this.subMenuStack = [];
    this.inlineMounted = true;
    this.render(host);
    if (opts?.placeholder && this.input) this.input.placeholder = opts.placeholder;
    this.refilter();
    if (opts?.focus) requestAnimationFrame(() => this.input?.focus());
    return () => {
      this.inlineMounted = false;
      this.close();
    };
  }

  // ─── palette context (selection text + image attachments) ──────

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
    elementOrSelector?: Element | string | null,
    opts?: { kind?: SelectionKind },
  ): void {
    chipSetPinnedContext(this.chipBarHostAdapter, text, elementOrSelector, opts);
  }

  clearPinnedContext(): void {
    this.pinnedContextEl = null;
    this.pinnedContextText = '';
    this.pinnedContextKind = 'text';
  }

  /**
   * Read-only snapshot of the sticky pinned context. Unlike `context`, this
   * survives palette `close()` — useful for `dddk.startAgent()` called from a
   * palette handler. The text is read live from the pinned element when
   * possible so navigation invalidates stale pins.
   */
  get pinnedContext(): { text: string; element?: string; kind: SelectionKind } {
    // Agent-facing: NO `<tag.class>` signature prefix. The signature is a
    // debug affordance for the chip bar; feeding it into selection.text
    // confuses the LLM (it reads `<section.section>` as a literal HTML
    // reference and starts inspecting the DOM via tools instead of just
    // operating on the inner text).
    return {
      text: chipReadPinnedTextLive(this.chipBarHostAdapter, { withSignature: false }),
      element: this.pinnedContextEl ? inferSelector(this.pinnedContextEl) || undefined : undefined,
      kind: this.pinnedContextKind,
    };
  }

  private captureContextOnOpen(seed?: string): void {
    chipCaptureContextOnOpen(this.chipBarHostAdapter, seed);
  }

  private clearContext(): void {
    this.contextSelectionText = '';
    this.contextSelectionElement = undefined;
    this.contextSelectionKind = 'text';
    // Don't drop attachments — user may have queued one and not yet activated.
  }

  /** Public: add an image attachment to the palette context. */
  addAttachment(att: Omit<PaletteAttachment, 'id'>): PaletteAttachment {
    return chipAddAttachment(this.chipBarHostAdapter, att);
  }

  removeAttachment(id: string): void {
    chipRemoveAttachment(this.chipBarHostAdapter, id);
  }

  clearAttachments(): void {
    chipClearAttachments(this.chipBarHostAdapter);
  }

  /** Read-only snapshot of the current context. */
  get context(): PaletteContext {
    return {
      selectionText: this.contextSelectionText,
      selectionElement: this.contextSelectionElement,
      attachments: this.contextAttachments.slice(),
    };
  }

  // ─── result mode (showResult / clearResult) ──────────────────────

  async showResult(surface: ResultSurface): Promise<void> {
    if (!this.resultHost) return;
    this.resultMode = true;
    this.resultHost.style.display = 'block';
    this.resultHost.textContent = '';
    if (this.listSplit) this.listSplit.style.display = 'none';
    this.refreshFooter();

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
    this.refreshFooter();
  }

  /**
   * True when the palette is open AND in a state where Esc has its own
   * meaning (back out of result-mode / pop a sub-menu). External
   * keyboard handlers (orchestrator's GestureManager Esc) should defer
   * to the palette in that case — otherwise the global "Esc closes the
   * whole palette" rule kills the back-step the user expected.
   */
  hasInternalEsc(): boolean {
    return this.isOpen() && (this.resultMode || this.subMenuStack.length > 0);
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
    helperAddQAItems((it) => this.addItem(it), items, opts);
  }

  // ─── render ─────────────────────────────────────────────────────

  private render(inlineHost?: HTMLElement): void {
    const inline = !!inlineHost;
    const root = document.createElement('div');
    root.setAttribute(UI_ATTR, inline ? 'palette-inline' : 'palette-backdrop');

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
    if (this.submitButton) {
      inputRow.appendChild(this.buildSubmitButton());
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
        <kbd>↑</kbd><kbd>↓</kbd> <span>${escapeHtml(sdkString(this.locale, 'palette.footer.navigate'))}</span>
      </span>
      <span data-dddk-ui="palette-footer-group">
        <kbd>↵</kbd> <span>${escapeHtml(sdkString(this.locale, 'palette.footer.select'))}</span>
      </span>
      <span data-dddk-ui="palette-footer-group">
        <kbd>esc</kbd> <span>${escapeHtml(sdkString(this.locale, 'palette.footer.close'))}</span>
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
      // Narrow exemption — ONLY the subtitle bar. The agent narrates
      // while the user interacts with the palette, and clicking the
      // narration to read it should NOT kill the palette mid-task.
      // Other outside clicks (page body, other dddk UI) close as
      // normal — that's the user signalling "I'm moving on".
      if (e.target instanceof Element && e.target.closest('[data-dddk-ui="bar"]')) return;
      e.preventDefault();
      this.close();
    };
    // Inline mode: the palette lives embedded in a host container and stays
    // visible, so it must NOT close on outside clicks or trap document keys.
    if (!inline) {
      root.addEventListener('mousedown', onBackdropDown);
      this.listeners.push(() => root.removeEventListener('mousedown', onBackdropDown));
    }

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
    if (!inline) {
      document.addEventListener('keydown', onDocKey, true);
      this.listeners.push(() => document.removeEventListener('keydown', onDocKey, true));
    }

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

    if (inline) inlineHost!.appendChild(root);
    else document.body.appendChild(root);

    this.root = root;
    this.input = inputEl;
    this.list = listEl;

    // Render chip-bar now in case we opened with selection / attachments already.
    this.renderChipBar();
  }

  // ─── chip-bar host adapter ─────────────────────────────────────
  // Exposed as a getter so it can capture the live `this` after class
  // fields have been initialised (chip-bar.ts mutates via these hooks).
  private get chipBarHostAdapter(): ChipBarHost {
    return {
      getChipBarHost: () => this.chipBarHost,
      getSelectionText: () => this.contextSelectionText,
      setSelectionText: (v) => { this.contextSelectionText = v; },
      getSelectionElement: () => this.contextSelectionElement,
      setSelectionElement: (v) => { this.contextSelectionElement = v; },
      getSelectionKind: () => this.contextSelectionKind,
      setSelectionKind: (v) => { this.contextSelectionKind = v; },
      getAttachments: () => this.contextAttachments,
      setAttachments: (v) => { this.contextAttachments = v; },
      getPinnedEl: () => this.pinnedContextEl,
      setPinnedEl: (v) => { this.pinnedContextEl = v; },
      getPinnedText: () => this.pinnedContextText,
      setPinnedText: (v) => { this.pinnedContextText = v; },
      getPinnedKind: () => this.pinnedContextKind,
      setPinnedKind: (v) => { this.pinnedContextKind = v; },
      isOpen: () => this.isOpen(),
      renderChipBar: () => this.renderChipBar(),
      refilter: () => this.refilter(),
    };
  }

  private renderChipBar(): void {
    chipRenderChipBar(this.chipBarHostAdapter);
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
        this.refreshFooter();
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

  /** Circular submit/send button at the right edge of the input row. */
  private buildSubmitButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(UI_ATTR, 'palette-submit');
    btn.title = sdkString(this.locale, 'palette.footer.select');
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 19V5M5 12l7-7 7 7"/>
      </svg>
    `;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.submitInput();
      this.input?.focus();
    });
    return btn;
  }

  /**
   * Submit the current query — same effect as pressing Enter. Routes to the
   * active input-context's onSubmit, else fires the single registered fallback
   * (e.g. Ask AI) with the typed text, else activates the focused row.
   */
  private submitInput(): void {
    if (this.inputContext) {
      const value = this.input?.value ?? '';
      if (value.trim().length === 0) return;
      this.inputContext.onSubmit(value, this.buildHandle());
      if (this.inputContext?.clearOnSubmit !== false && this.input) this.input.value = '';
      return;
    }
    const raw = this.input?.value.trim() ?? '';
    if (!raw) { this.input?.focus(); return; }
    const fallbacks = this.rootItems.filter((i) => i.fallback);
    if (fallbacks.length >= 1 && fallbacks[0]!.handler) {
      this.currentArg = raw;
      this.heatRank?.visit(fallbacks[0]!.id);
      fallbacks[0]!.handler(this.buildHandle(), raw);
      return;
    }
    this.activate(this.cursor);
  }

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

  /** See `./screenshot.ts` for the drag-rect overlay implementation. */
  private openScreenshot(): void {
    const cfg = this.camera;
    if (!cfg) return;
    const host: ScreenshotHost = {
      getRoot: () => this.root,
      getLocale: () => this.locale,
      addAttachment: (att) => this.addAttachment(att),
    };
    helperOpenScreenshot(host, cfg);
  }

  private refilter(): void {
    const raw = this.input?.value ?? '';
    const q = raw.trim().toLowerCase();

    // 1. Prefix routing — detect items whose `prefix` matches the input start.
    const prefixMatch = matchPrefix(this.items, raw);

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
          browseItems = fuzzyTopN(browseItems, arg, 50);
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
          ? fuzzyTopN(
              this.items.filter((i) => i.id !== item.id && i.section !== 'Tips'),
              arg,
              10,
            )
          : [];
        this.filtered = [item, ...others];
      } else {
        // Items sharing the same prefix (Tips excluded).
        const sameGroup = this.items.filter((i) => i.prefix === item.prefix && i.section !== 'Tips');
        this.filtered = arg
          ? fuzzyTopN(sameGroup, arg, 50)
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
        if (i.searchAction) return false;
        if (i.section === 'Tips') return true;
        if (!i.prefix) return true;
        return !listPrefixMatches(i.prefix).some((p) => tipPrefixes.has(p.toLowerCase()));
      }).slice(0, 100);
    } else if (looksLikePrefixAttempt(this.items, raw)) {
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
        .filter((i) => !i.searchAction)
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
      const candidates = this.items
        .filter((i) => !i.fallback)
        .filter((i) => !i.searchAction)
        .filter((i) => i.section !== 'Tips');
      this.filtered = fuzzyTopN(candidates, q, 50);

      // Search-action rows: pinned to the TOP the moment anything is typed,
      // regardless of fuzzy match, with the live query substituted for `{q}`.
      const echoQ = raw.trim();
      const searchActions = this.items
        .filter((i) => i.searchAction)
        .map((s) => ({
          ...s,
          name: (s.name ?? '').replace(/\{q\}/g, echoQ),
          description: (s.description ?? '').replace(/\{q\}/g, echoQ),
        }));
      if (searchActions.length) this.filtered = [...searchActions, ...this.filtered];

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
  private renderList(): void {
    if (!this.list) return;
    this.list.innerHTML = '';
    // Shared across this render's row listeners: real clicks fire mousedown AND
    // click; the mousedown handler sets this so the trailing click is a no-op
    // (only programmatic clicks — no preceding mousedown — fall through).
    let pressHandled = false;

    // (Tips rows are now part of `this.filtered` in empty-state — see
    // `refilter()` + `buildTipItems()`. The section header gets emitted by
    // the normal lastSection logic below since they all have `section: 'Tips'`.)

    // Group items by section header to avoid duplicate headers when
    // HeatRank / context-promotion scatters same-section items across
    // the filtered array. The lastSection toggle below only collapses
    // ADJACENT same-section rows; with HeatRank, the [Go to, Settings,
    // ..., Go to, ...] order would emit "前往" twice.
    //
    // Section order is derived from REGISTRATION ORDER (this.rootItems),
    // NOT from filtered order — otherwise a HeatRank-promoted item drags
    // its whole section to the top, violating the host's hand-curated
    // section sequence (host registered Settings then Go-to → Settings
    // must render above Go-to even when Go-to has the hottest item).
    // Within a section, HeatRank ordering of items is preserved.
    const sectionRegOrder = new Map<string, number>();
    for (const it of this.rootItems) {
      const s = it.section ?? 'Commands';
      if (!sectionRegOrder.has(s)) sectionRegOrder.set(s, sectionRegOrder.size);
    }
    // Sections that appear in filtered but were never in rootItems
    // (post-mount additions / fallbacks / Tips) tail-append in their
    // first-seen order.
    this.filtered.forEach((it) => {
      const s = it.section ?? 'Commands';
      if (!sectionRegOrder.has(s)) sectionRegOrder.set(s, sectionRegOrder.size);
    });
    this.filtered.sort((a, b) => {
      const sa = a.section ?? 'Commands';
      const sb = b.section ?? 'Commands';
      if (sa === sb) return 0;
      return sectionRegOrder.get(sa)! - sectionRegOrder.get(sb)!;
    });

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
      // `role="option"` is what makes the row clickable from the webagent's
      // perspective — without it the DOM walker treats <li> as a content
      // line (no index, no hash id), and the agent has no handle to call
      // `click` on. With role=option, the walker indexes it like any
      // other interactive element and the agent can drive the palette
      // exactly like a user would. Also semantically correct: the palette
      // panel is a listbox of options.
      li.setAttribute('role', 'option');
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
      // Image thumbnail takes precedence over the glyph/SVG icon. Renders an
      // <img> in the icon slot so hosts can build rich rows (book cover etc.).
      // src is attribute-escaped; host controls the URL (same trust boundary as
      // `icon`). Falls back to glyph icon, then nothing.
      const iconHtml = item.image
        ? `<img data-dddk-ui="palette-item-image" src="${escapeHtml(item.image)}" alt="" loading="lazy" />`
        : item.icon
          ? (item.icon.trimStart().startsWith('<svg')
              ? item.icon
              : escapeHtml(item.icon))
          : '';
      // NOTE: `data-dddk-ui` is matched with EXACT `[attr="..."]` selectors, so it
      // must hold a SINGLE token (not space-separated like a className) — otherwise
      // neither the base nor the modifier rule matches and the thumbnail renders at
      // its natural (huge) size. The image variant is fully self-contained in CSS.
      const iconClass = item.image ? 'palette-item-icon-img' : 'palette-item-icon';
      // Text block: when the host supplies `lines`, stack them vertically as a
      // multi-line row (name on top, then one element per line). Otherwise use
      // the default inline `name — description` layout.
      const hasLines = Array.isArray(item.lines) && item.lines.length > 0;
      const textHtml = hasLines
        ? `<span data-dddk-ui="palette-item-textcol">
             ${showName ? `<span data-dddk-ui="palette-item-name">${highlightMatch(item.name, hl)}</span>` : ''}
             ${item.lines!.map((ln, li2) => `<span data-dddk-ui="palette-item-line" data-line="${li2}">${highlightMatch(ln, hl)}</span>`).join('')}
           </span>`
        : `${showName ? `<span data-dddk-ui="palette-item-name">${highlightMatch(item.name, hl)}</span>` : ''}
           ${item.description ? `<span data-dddk-ui="palette-item-dash">—</span><span data-dddk-ui="palette-item-desc">${highlightMatch(item.description, hl)}</span>` : ''}`;
      li.innerHTML = `
        ${iconHtml ? `<span data-dddk-ui="${iconClass}">${iconHtml}</span>` : ''}
        ${prefixLabel ? `<span data-dddk-ui="palette-item-prefix">${highlightMatch(prefixLabel, hl)}</span>` : ''}
        ${textHtml}
        ${item.shortcut ? `<span data-dddk-ui="palette-item-shortcut">${escapeHtml(item.shortcut)}</span>` : ''}
      `;
      // Two-stage press: hover NO LONGER auto-selects (so the wheel scrolls the
      // list smoothly under the pointer instead of every row stealing focus and
      // re-expanding). A press on a row that HAS a `detail` and isn't already
      // active just EXPANDS it; pressing the already-expanded row COMMITS
      // (navigates). Rows without detail commit on the first press, as before.
      const press = (): void => {
        const it = this.filtered[idx];
        if (it?.detail && this.cursor !== idx) this.setCursor(idx);
        else this.activate(idx);
      };
      // Use mousedown so it happens before any blur side-effects, and
      // stopPropagation so a handler that detaches THIS li mid-event doesn't
      // bubble to the backdrop close handler (which would wrongly close).
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();    // keep input focus
        e.stopPropagation();
        pressHandled = true;   // swallow the trailing real `click`
        press();
      });
      // `click` only acts for PROGRAMMATIC invocations (webagent `el.click()` —
      // no preceding mousedown). Real clicks already handled by mousedown above.
      li.addEventListener('click', (e) => {
        if (pressHandled) { pressHandled = false; return; }
        if (!li.isConnected) return;
        e.preventDefault();
        e.stopPropagation();
        press();
      });
      this.list!.appendChild(li);
    });
    // After a re-render the cursor row exists again but its inline detail was
    // wiped by `innerHTML = ''` — re-render it so the expanded description /
    // table under the active row survives filtering.
    this.renderDetailFor(this.filtered[this.cursor]);
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
    const token = ++this.detailRenderToken;
    if (!item?.detail) {
      this.detailHost.innerHTML = '';
      this.detailHost.style.display = 'none';
      return;
    }
    // Inline accordion: render the detail INSIDE the active row so the whole
    // selected option grows taller (one expanded, highlighted card) rather than
    // spawning a separate block. The host is appended as the last child of the
    // active <li>; the row is `flex-wrap` so this full-width host drops onto a
    // new line under the icon + text. The host has no `data-idx`, so the cursor
    // logic never lands on it.
    const activeLi = this.list?.querySelector('[data-active]');
    if (activeLi && this.detailHost.parentElement !== activeLi) {
      activeLi.appendChild(this.detailHost);
    }
    this.detailHost.style.display = 'block';
    this.detailHost.innerHTML = '<div data-dddk-ui="palette-detail-loading">…</div>';

    try {
      const surface = await item.detail(this.currentArg || undefined);
      if (token !== this.detailRenderToken || !this.detailHost) return;
      if (!this.pieceCatalog) {
        const { createBuiltinCatalog } = await import('../../ui/pieces');
        if (token !== this.detailRenderToken) return;
        this.pieceCatalog = createBuiltinCatalog();
      }
      const { PieceDomRenderer } = await import('../../ui/pieces/dom-renderer');
      if (token !== this.detailRenderToken || !this.detailHost) return;
      this.detailHost.innerHTML = '';
      const renderer = new PieceDomRenderer({ catalog: this.pieceCatalog, readOnly: true });
      renderer.mount(this.detailHost, surface);
    } catch (err) {
      if (token !== this.detailRenderToken || !this.detailHost) return;
      this.detailHost.innerHTML = `<div data-dddk-ui="palette-detail-error">${String((err as Error).message)}</div>`;
    }
  }

  /**
   * Public — activate a palette item by id. Returns true if found and
   * fired, false if no matching item is currently in the filtered list
   * (e.g. caller passed a sub-menu id before opening the parent).
   *
   * Used by host-registered "semantic" webagent tools that wrap multi-
   * level palette flows: the tool can `open()` the palette, await a
   * frame, `activateById('parent')` to expand the sub-menu, await, then
   * `activateById('child')` to commit. Saves the agent from having to
   * model the palette as a 2-step click sequence.
   */
  activateById(id: string): boolean {
    const idx = this.filtered.findIndex((item) => item.id === id);
    if (idx < 0) return false;
    this.activate(idx);
    return true;
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
        this.refreshFooter();
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
