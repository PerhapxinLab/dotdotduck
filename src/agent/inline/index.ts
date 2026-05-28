/**
 * InlineAgent — inline AI menu for text inside editable surfaces
 * (`<input>`, `<textarea>`, `[contenteditable]`).
 *
 * UX:
 *   1. User selects text inside an editable.
 *   2. A small floating menu pops next to the selection (top-right).
 *   3. Menu stays visible while the selection is active. Scroll repositions
 *      it; the menu does NOT auto-hide on idle.
 *   4. User picks an action (mouse OR keyboard — Ctrl/Cmd+. opens the menu
 *      programmatically, arrows + Enter navigate).
 *   5. Selected text is replaced with the LLM's result.
 *
 * Actions are host-customizable:
 *   - `actions` config replaces the default set
 *   - `addAction` / `removeAction` / `updateAction` at runtime
 *   - Per-action `build()` returns the LLM instruction dynamically — used by
 *     the default Translate action to pick a target language via sub-menu.
 *
 * Output cleanup: a wrapper system prompt forces the LLM to return ONLY
 * the result between `<<<RESULT>>>` markers. We strip everything else.
 * Avoids "thinking out loud" / preamble leaking into the editable.
 */

import { resolveLLM, type LLMSource } from '../llm/router';
import type { ToolCall } from '../llm/types';
import type { StreamingProvider, StreamChunk } from '../llm/stream';
import type { ActionDefinition } from '../webagent/types';
import type { DotDotDuck } from '../../orchestrator';
import { escapeHtml } from '../../utils/dom';
import { I18N, DEFAULT_TRANSLATE_TARGETS } from './i18n';
import {
  SYSTEM_PROMPT,
  extractReplacement,
  findEndMarker,
  REPLACEMENT_END_VARIANTS,
  buildContextPrompt,
  REPLACEMENT_START,
} from './parse';
import { ensureInlineAgentStyles, UI_ATTR } from './styles';

export interface InlineAgentConfig {
  llm: LLMSource;
  /**
   * Replace the entire default action set. When provided, defaults are
   * NOT included. Use `appendActions` if you want to keep defaults +
   * add your own, or `disabledActions` to drop specific defaults.
   */
  actions?: InlineAction[];
  /**
   * Append your actions AFTER the (filtered) defaults. Combine with
   * `disabledActions` to keep some defaults, drop others, add your own.
   */
  appendActions?: InlineAction[];
  /**
   * Drop these default actions by id. Useful when you want most of the
   * defaults but not, say, "translate". Default ids: translate / improve /
   * fix / shorter / longer / tone / explain.
   */
  disabledActions?: string[];
  /**
   * Menu layout:
   *  - `'single-column'` (default): one column, all actions stacked.
   *  - `'two-column'`: two columns side-by-side. Each action's `row` (1 | 2)
   *    decides which column it belongs to. Optional `rowLabel` on each
   *    action surfaces a small header above the first action of that row.
   *
   * Two-column is the recommended layout for note-taking / editor hosts
   * that want one column of formatting actions (Bold / Italic / H1 / Color)
   * and another of AI actions (Translate / Improve / …).
   */
  layout?: 'single-column' | 'two-column';
  /** Optional headers shown above column 1 / column 2 in `two-column` layout. */
  columnLabels?: { col1?: string; col2?: string };
  /**
   * Locale for built-in i18n labels. Default `'en'`. SDK ships `'en'` and
   * `'zh-TW'` translations; any other value falls back to `'en'` so the
   * UI never breaks. Hosts that want native labels (`'ja'`, `'es'`, …)
   * pass `actions` / `appendActions` with their own translated labels.
   */
  locale?: string;
  /** Languages offered when the user picks Translate. Default: en / zh-TW / ja. */
  translateTargets?: Array<{ code: string; label: string }>;
  /** Auto-hide after this many ms with no selection change. `0` = never (default). */
  hideAfterMs?: number;
  /** CSS selector — never trigger inside elements matching this. */
  ignoreSelector?: string;
  /**
   * Keyboard shortcut to open the menu when text is selected. Default `mod+.`
   * Format: `mod+<key>` where `mod` = Ctrl on Win/Linux, Cmd on Mac.
   * Alternative modifiers: `alt+<key>`, `shift+<key>`, combinations like
   * `mod+alt+<key>`.
   */
  shortcut?: string;
  /**
   * Override the system prompt sent to the LLM for inline edits. The
   * default is universal (works for any input language — the LLM detects
   * + replies in the same language) and enforces a strict JSON output
   * shape (`{ replacement: string }`) so the host can splice the result
   * back deterministically. Set this only if you need fully custom edit
   * semantics — your prompt MUST still produce the same JSON shape or
   * the splice will fail.
   */
  systemPrompt?: string;
  /**
   * Opt-in: type a prefix anywhere in an editable surface to fire an LLM
   * call with the rest of the text as instruction. Default OFF — has to
   * be enabled explicitly because it hijacks the input.
   *
   * Example: with `prefix: '/inline ai '` and `submitOn: 'enter'`, the
   * user types `/inline ai write me a haiku about ducks` and presses
   * Enter — the editable's whole value is replaced with the LLM result.
   *
   * Submit semantics:
   *  - `'enter'` (default): plain Enter submits. Newlines in textareas
   *    are NOT possible while a prefix is active.
   *  - `'mod-enter'`: Cmd/Ctrl+Enter submits, Enter still adds a newline.
   *  - `'double-newline'`: two consecutive `\n` submit (typing two Enters).
   */
  prefixTrigger?: {
    enabled: boolean;
    prefix?: string;
    minChars?: number;
    submitOn?: 'enter' | 'mod-enter' | 'double-newline';
    /** Show a "AI will replace this" confirmation step before commit. */
    confirmBeforeReplace?: boolean;
  };
  /**
   * Optional tool-call layer for inline-agent actions. **Default OFF.**
   *
   * When this array is non-empty the inline agent switches from a
   * single-shot LLM call to a small tool-call loop. The LLM can call
   * any tool listed here BEFORE producing the final `{ replacement }`
   * JSON — useful for "look up the customer in the CRM before
   * rewriting", "fetch the glossary term before translating", or any
   * other host-side data fetch that should ground the answer.
   *
   * Tools follow webagent's `ActionDefinition` shape so anything you
   * can hand to WebAgent works here unchanged. The loop stops as soon
   * as the LLM produces content without a tool call, or after
   * `maxToolRounds` rounds (safety cap).
   *
   * Leave undefined / empty to keep the original single-shot behaviour
   * — no tool calls, no extra latency.
   */
  tools?: ActionDefinition[];
  /**
   * When `true` and `tools` is non-empty, the inline agent uses
   * `dddk.subtitle` to narrate progress during the tool loop ("Looking
   * up customer record…", "Done — applying the rewrite"). Requires
   * `attachTo(dddk)` so the agent has a Subtitle handle. **Default false.**
   */
  enableSubtitle?: boolean;
  /**
   * Safety cap on the tool-call loop. Default `3`. Hosts with chained
   * lookups (search → fetch → verify) may want 4-5.
   */
  maxToolRounds?: number;
}

export interface InlineActionHandlerCtx {
  text: string;
  target: HTMLElement;
  selection: { start: number; end: number };
  agent: InlineAgent;
}

export interface InlineAction {
  id: string;
  /** Visible label. Pass an `{ en, 'zh-TW' }` object for i18n. */
  label: string | { en: string; 'zh-TW': string };
  icon?: string;
  /** Which column this action lives in when `layout: 'two-column'`. Default 1. Ignored in single-column. */
  row?: 1 | 2;
  /**
   * Where to put the LLM result.
   *  - `'replace'` (default): splice the result back over the user's
   *    selection immediately. The canonical inline edit (Translate,
   *    Rewrite, Fix grammar, …).
   *  - `'subtitle'`: don't touch the editable. Show the result in the
   *    subtitle bar — the right behaviour for actions like Explain /
   *    Summarise / Define where the user wants info, not to destroy
   *    their original text.
   *  - `'confirm'`: show the result in the subtitle bar with accept /
   *    reject buttons. ONLY on accept do we splice it back. Use this
   *    for risky / opinionated edits where the user wants to preview
   *    before commit. Space accepts, double-tap Space rejects (same as
   *    every other subtitle action prompt).
   */
  displayAs?: 'replace' | 'subtitle' | 'confirm';
  /**
   * Static LLM instruction. Either set this OR `build` OR `handler`.
   * Precedence: `handler` > `build` > `instruction`.
   */
  instruction?: string;
  /**
   * Dynamic instruction. Use this when you need to ask the user for more
   * info first (e.g. Translate sub-menu picks a target language). Return
   * `null` to cancel without running the LLM.
   */
  build?: (ctx: { text: string; agent: InlineAgent }) => Promise<string | null> | string | null;
  /**
   * Custom handler — runs INSTEAD of the LLM round-trip. Use for non-AI
   * actions like "wrap selection in **bold**", "insert markdown table",
   * "change color via document.execCommand". When defined, the LLM is
   * not called. The handler can read selection text + boundary indices
   * and mutate the editable directly.
   */
  handler?: (ctx: InlineActionHandlerCtx) => void | Promise<void>;
}

export class InlineAgent {
  private cfg: Required<Pick<InlineAgentConfig, 'locale' | 'hideAfterMs' | 'translateTargets' | 'layout' | 'enableSubtitle' | 'maxToolRounds'>>
    & Pick<InlineAgentConfig, 'ignoreSelector' | 'llm' | 'columnLabels' | 'prefixTrigger' | 'systemPrompt' | 'tools'>;
  private llm: LLMSource;
  private actions: InlineAction[];
  private menu: HTMLDivElement | null = null;
  private menuList: HTMLDivElement | null = null;
  private subMenu: HTMLDivElement | null = null;
  private currentEditable: HTMLElement | null = null;
  private currentSelection: { text: string; start: number; end: number } | null = null;
  private currentRect: DOMRect | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanups: Array<() => void> = [];
  private dddk: DotDotDuck | null = null;
  private cursor = 0;
  private enabled = true;
  /** IME composing flag — `selectionchange` fires mid-composition for CJK
   *  input. We suppress menu show/hide while composing to avoid flicker.
   *  Set on `compositionstart`, cleared on `compositionend`. */
  private isComposing = false;
  /** Parsed shortcut spec (`{ ctrl, alt, shift, key }`) or `null`. */
  private shortcutSpec: { ctrl?: boolean; alt?: boolean; shift?: boolean; key: string } | null = null;
  /** In-flight run token — drops stale LLM results when the user fires a
   *  second action before the first finishes. */
  private runToken = 0;
  /** Prefix-trigger state: tracks whether the focused editable is currently
   *  in "prefix mode" (text starts with the configured prefix). */
  private prefixActive = false;

  constructor(config: InlineAgentConfig) {
    this.cfg = {
      llm: config.llm,
      locale: config.locale ?? 'en',
      hideAfterMs: config.hideAfterMs ?? 0,
      translateTargets: config.translateTargets ?? DEFAULT_TRANSLATE_TARGETS,
      ignoreSelector: config.ignoreSelector,
      layout: config.layout ?? 'single-column',
      columnLabels: config.columnLabels,
      prefixTrigger: config.prefixTrigger,
      systemPrompt: config.systemPrompt,
      tools: config.tools && config.tools.length > 0 ? config.tools : undefined,
      enableSubtitle: config.enableSubtitle ?? false,
      maxToolRounds: config.maxToolRounds ?? 3,
    };
    this.llm = config.llm;

    // Action set assembly:
    //   - `actions` (when provided) REPLACES defaults entirely.
    //   - `disabledActions` filters specific defaults by id.
    //   - `appendActions` adds to whatever remained after the above.
    const base = config.actions ?? this.buildDefaultActions();
    const filtered = config.disabledActions?.length
      ? base.filter((a) => !config.disabledActions!.includes(a.id))
      : base;
    this.actions = config.appendActions?.length
      ? [...filtered, ...config.appendActions]
      : filtered;

    // Parse keyboard shortcut. Format: `mod+<key>` / `alt+<key>` etc.
    // `mod` resolves to Cmd on Mac, Ctrl elsewhere — checked at runtime
    // via `e.metaKey || e.ctrlKey`. Default `mod+.` so the menu can be
    // opened without a mouse selection (e.g. user typed something, wants
    // to invoke AI without re-selecting it — they can just hit Cmd+.).
    this.shortcutSpec = parseShortcut(config.shortcut ?? 'mod+.');
  }

  /**
   * Switch the menu / dialog locale at runtime. Pass any BCP-47-ish tag —
   * the bundled `en` / `zh-TW` translations are picked when they match;
   * other tags fall back to `en`.
   */
  setLocale(locale: string): void {
    this.cfg.locale = locale;
    // Menu DOM was painted at mount time with the construction-time locale.
    // Switching language (e.g. sidebar toggle) without refreshing leaves the
    // header + row labels in the previous language.
    if (this.menu) {
      const header = this.menu.querySelector('.ia-header');
      if (header) header.textContent = this.t('header');
    }
    this.refreshMenu();
  }

  private t(key: keyof typeof I18N['en']): string {
    const dict = (I18N as unknown as Record<string, Record<string, string>>)[this.cfg.locale];
    return dict?.[key] ?? I18N.en[key];
  }

  private buildDefaultActions(): InlineAction[] {
    const t = (k: keyof typeof I18N['en']) => this.t(k);
    return [
      {
        id: 'translate', icon: '文',
        label: { en: I18N.en.translate, 'zh-TW': I18N['zh-TW'].translate },
        // Dynamic — ask user for target language first.
        build: async (ctx) => {
          const target = await this.pickFromSubmenu(
            this.t('pickLanguage'),
            this.cfg.translateTargets.map((l) => ({ id: l.code, label: l.label })),
          );
          if (!target) return null;
          return `Translate the text to ${target.label} (locale ${target.id}). Keep the same tone. Output only the translation. Source text:\n"""\n${ctx.text}\n"""`;
        },
      },
      { id: 'improve', icon: '✦',
        label: { en: I18N.en.improve, 'zh-TW': I18N['zh-TW'].improve },
        instruction: `Rewrite to improve clarity, flow, and grammar. Keep the same meaning AND the same language. Output only the rewritten text.`,
      },
      { id: 'fix', icon: '✓',
        label: { en: I18N.en.fix, 'zh-TW': I18N['zh-TW'].fix },
        instruction: `Fix spelling and grammar. Do not change meaning, language, or style. Output only the corrected text.`,
      },
      { id: 'shorter', icon: '↤',
        label: { en: I18N.en.shorter, 'zh-TW': I18N['zh-TW'].shorter },
        // Aggressive shortening — the previous prompt ("~30% shorter while
        // keeping all key information") asked the model to do two opposing
        // things at once, so most outputs only trimmed a couple of filler
        // words. We name concrete things to drop (hedging, repetition,
        // examples, qualifiers) and set a HARD floor of "at least half".
        instruction: `Aggressively shorten this text to AT MOST half its original length. Keep only the core point. Drop: filler words, hedging ("perhaps", "I think", "可能", "或許"), repetition, redundant clauses, examples, qualifiers, and any sentence that merely restates a previous one. If two sentences can be one, make it one. Keep the same language as the input. Output ONLY the shortened text — no preamble, no explanation, no quotes.`,
      },
      { id: 'longer', icon: '↦',
        label: { en: I18N.en.longer, 'zh-TW': I18N['zh-TW'].longer },
        instruction: `Expand the text with more detail and examples. Keep the same language. Output only the result.`,
      },
      { id: 'tone', icon: '◐',
        label: { en: I18N.en.tone, 'zh-TW': I18N['zh-TW'].tone },
        instruction: `Rewrite the text in a more professional, formal tone. Keep the same language. Output only the result.`,
      },
      { id: 'explain', icon: '?',
        label: { en: I18N.en.explain, 'zh-TW': I18N['zh-TW'].explain },
        instruction: `Explain the text in plain language as 2-3 short sentences. Keep the same language as the original. Output only the explanation.`,
        // The user wants information about the selection, NOT to
        // overwrite it. Show the explanation in the subtitle bar.
        displayAs: 'subtitle',
      },
    ];
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  attachTo(dddk: DotDotDuck): void {
    if (typeof document === 'undefined') return;
    this.dddk = dddk;
    ensureInlineAgentStyles();

    const onSelChange = () => this.handleSelectionChange();
    // Scroll: reposition the menu rather than hiding it.
    const onScroll = () => this.repositionMenu();
    const onMouseDown = (e: MouseEvent) => {
      if (this.menu && e.target instanceof Element && !this.menu.contains(e.target)
          && (!this.subMenu || !this.subMenu.contains(e.target))) {
        // Click outside menu — but ONLY hide if user is no longer in an
        // editable with selection (handleSelectionChange handles that on its
        // own via the next `selectionchange` event).
        // Defer to allow selectionchange to fire first.
        setTimeout(() => this.maybeHide(), 0);
      }
    };
    const onKey = (e: KeyboardEvent) => this.handleKey(e);
    // IME guard: while the user is composing a CJK / accent character,
    // `selectionchange` fires mid-composition and a half-typed character
    // would trigger the menu to flash open/closed. Suppress show/hide
    // entirely during composition.
    const onCompStart = () => { this.isComposing = true; };
    const onCompEnd = () => {
      this.isComposing = false;
      // Re-evaluate after composition ends — the final character may now
      // satisfy the 2-char selection threshold.
      this.handleSelectionChange();
    };
    // Shortcut listener — `mod+.` (default) opens the menu for the current
    // selection without requiring `selectionchange` to have fired first.
    const onShortcut = (e: KeyboardEvent) => this.handleShortcut(e);
    // Prefix-trigger input listener (opt-in). Scans for the configured
    // prefix in any focused editable's value on every `input`.
    const onInput = (e: Event) => this.handlePrefixInput(e);

    document.addEventListener('selectionchange', onSelChange);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('compositionstart', onCompStart, true);
    document.addEventListener('compositionend', onCompEnd, true);
    document.addEventListener('keydown', onShortcut, true);
    if (this.cfg.prefixTrigger?.enabled) {
      document.addEventListener('input', onInput, true);
    }
    this.cleanups.push(
      () => document.removeEventListener('selectionchange', onSelChange),
      () => document.removeEventListener('scroll', onScroll, true),
      () => document.removeEventListener('mousedown', onMouseDown, true),
      () => document.removeEventListener('keydown', onKey),
      () => document.removeEventListener('compositionstart', onCompStart, true),
      () => document.removeEventListener('compositionend', onCompEnd, true),
      () => document.removeEventListener('keydown', onShortcut, true),
      () => document.removeEventListener('input', onInput, true),
    );
  }

  destroy(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.hide();
    this.menu?.remove();
    this.menu = null;
    this.subMenu?.remove();
    this.subMenu = null;
  }

  // ─── Public runtime customisation ───────────────────────────

  /** Append a new action to the bottom of the menu. */
  addAction(action: InlineAction): void {
    this.actions.push(action);
    this.refreshMenu();
  }
  /** Remove an action by id. */
  removeAction(id: string): void {
    this.actions = this.actions.filter((a) => a.id !== id);
    this.refreshMenu();
  }
  /** Partial update of an existing action's fields. */
  updateAction(id: string, patch: Partial<InlineAction>): void {
    this.actions = this.actions.map((a) => (a.id === id ? { ...a, ...patch } : a));
    this.refreshMenu();
  }
  /** Replace the entire action list. */
  setActions(actions: InlineAction[]): void {
    this.actions = actions;
    this.refreshMenu();
  }
  /** Toggle module on/off without unmounting. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.hide();
  }
  isEnabled(): boolean { return this.enabled; }

  // ─── Selection detection ────────────────────────────────────

  private handleSelectionChange(): void {
    if (!this.enabled) return;
    // IME composition window: bail. compositionend re-fires this method,
    // so the menu still surfaces correctly when the composed char lands.
    if (this.isComposing) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) { this.hide(); return; }
    if (this.cfg.ignoreSelector && active.closest(this.cfg.ignoreSelector)) { this.hide(); return; }

    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      const start = active.selectionStart ?? -1;
      const end = active.selectionEnd ?? -1;
      if (start < 0 || end <= start) { this.hide(); return; }
      const text = active.value.slice(start, end).trim();
      if (text.length < 2) { this.hide(); return; }
      this.currentEditable = active;
      this.currentSelection = { text, start, end };
      this.currentRect = this.getSelectionRect(active);
      this.showMenu();
      return;
    }

    if (active.isContentEditable) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) { this.hide(); return; }
      const text = sel.toString().trim();
      if (text.length < 2) { this.hide(); return; }
      this.currentEditable = active;
      this.currentSelection = { text, start: -1, end: -1 };
      this.currentRect = sel.getRangeAt(0).getBoundingClientRect();
      this.showMenu();
      return;
    }

    // Non-editable: leave it to the palette flow.
    this.hide();
  }

  // ─── Menu ───────────────────────────────────────────────────

  private showMenu(): void {
    if (!this.menu) this.mountMenu();
    if (!this.menu || !this.currentRect) return;
    this.menu.style.display = 'block';
    this.cursor = 0;
    this.paintActive();
    this.repositionMenu();
    // Re-arm auto-hide if configured (default 0 = never).
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.cfg.hideAfterMs > 0) {
      this.hideTimer = setTimeout(() => this.hide(), this.cfg.hideAfterMs);
    }
  }

  private repositionMenu(): void {
    if (!this.menu || !this.currentRect || !this.currentEditable) return;
    if (this.menu.style.display === 'none') return;
    // Recompute selection rect (it moves with scroll / DOM changes).
    const rect = this.getSelectionRect(this.currentEditable);
    if (!rect) return;
    this.currentRect = rect;

    const menuW = this.menu.offsetWidth || 260;
    const menuH = this.menu.offsetHeight || 240;
    const viewportRight = window.scrollX + document.documentElement.clientWidth;
    const viewportBottom = window.scrollY + document.documentElement.clientHeight;

    // Horizontal: anchor at the right edge of the selection. Flip left
    // if it'd overflow the viewport.
    let left = rect.right + window.scrollX + 8;
    if (left + menuW > viewportRight) {
      left = rect.left + window.scrollX - menuW - 8;
    }

    // Vertical: open BELOW the selection by default. Opening alongside
    // (top-aligned with the selection) used to overlap the user's text
    // on narrow screens — they complained the menu was covering the
    // sentence they were trying to edit. We flip back to ABOVE only
    // when there isn't enough room below AND there's more room above
    // it than below.
    const viewportTopY = window.scrollY;
    let top = rect.bottom + window.scrollY + 6;
    if (top + menuH > viewportBottom) {
      const above = (rect.top + window.scrollY) - viewportTopY;
      const below = viewportBottom - (rect.bottom + window.scrollY);
      if (above > below) {
        top = rect.top + window.scrollY - menuH - 6;
      }
    }

    this.menu.style.left = `${Math.max(8, left)}px`;
    this.menu.style.top = `${Math.max(8, top)}px`;
  }

  private mountMenu(): void {
    const menu = document.createElement('div');
    menu.setAttribute(UI_ATTR, 'inline-agent');
    if (this.cfg.layout === 'two-column') menu.setAttribute('data-layout', 'two-column');
    const list = document.createElement('div');
    list.className = 'ia-list';
    const header = document.createElement('div');
    header.className = 'ia-header';
    header.textContent = this.t('header');
    menu.appendChild(header);
    menu.appendChild(list);
    document.body.appendChild(menu);
    this.menu = menu;
    this.menuList = list;
    this.renderActions();
  }

  private refreshMenu(): void {
    if (!this.menuList) return;
    this.renderActions();
  }

  private renderActions(): void {
    if (!this.menuList) return;
    this.menuList.innerHTML = '';

    if (this.cfg.layout === 'two-column') {
      this.renderTwoColumn();
    } else {
      this.renderSingleColumn();
    }
  }

  private renderSingleColumn(): void {
    if (!this.menuList) return;
    this.menuList.className = 'ia-list';
    this.actions.forEach((action, idx) => {
      this.menuList!.appendChild(this.buildActionRow(action, idx));
    });
  }

  private renderTwoColumn(): void {
    if (!this.menuList) return;
    this.menuList.className = 'ia-list ia-two-col';
    const col1 = document.createElement('div');
    col1.className = 'ia-col';
    const col2 = document.createElement('div');
    col2.className = 'ia-col';

    // Optional column headers (e.g. "Format" / "AI").
    if (this.cfg.columnLabels?.col1) {
      const h = document.createElement('div');
      h.className = 'ia-col-label';
      h.textContent = this.cfg.columnLabels.col1;
      col1.appendChild(h);
    }
    if (this.cfg.columnLabels?.col2) {
      const h = document.createElement('div');
      h.className = 'ia-col-label';
      h.textContent = this.cfg.columnLabels.col2;
      col2.appendChild(h);
    }

    // Actions partition: row=2 goes to col2, everything else to col1.
    // We still pass each action its position in `this.actions` as `idx`
    // so cursor / keyboard nav stays consistent across layouts.
    this.actions.forEach((action, idx) => {
      const target = action.row === 2 ? col2 : col1;
      target.appendChild(this.buildActionRow(action, idx));
    });

    this.menuList.appendChild(col1);
    this.menuList.appendChild(col2);
  }

  private buildActionRow(action: InlineAction, idx: number): HTMLButtonElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ia-row';
    row.dataset.idx = String(idx);
    const label = typeof action.label === 'string'
      ? action.label
      : (action.label as Record<string, string>)[this.cfg.locale] ?? action.label.en;
    row.innerHTML = `
      <span class="ia-icon">${action.icon ?? '·'}</span>
      <span class="ia-label">${escapeHtml(label)}</span>
    `;
    // Use mousedown so editable focus is preserved.
    row.addEventListener('mousedown', (e) => { e.preventDefault(); this.runAction(action); });
    row.addEventListener('mouseenter', () => { this.cursor = idx; this.paintActive(); });
    return row;
  }

  private paintActive(): void {
    if (!this.menuList) return;
    const rows = this.menuList.querySelectorAll<HTMLButtonElement>('[data-idx]');
    rows.forEach((r) => {
      if (Number(r.dataset.idx) === this.cursor) r.setAttribute('data-active', '');
      else r.removeAttribute('data-active');
    });
  }

  private hide(): void {
    if (this.menu) this.menu.style.display = 'none';
    if (this.subMenu) this.subMenu.remove();
    this.subMenu = null;
    this.currentEditable = null;
    this.currentSelection = null;
    this.currentRect = null;
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
  }

  /** Hide ONLY if there's currently no selection. Used after outside clicks
   *  to avoid hiding while user is mid-drag re-selecting. */
  private maybeHide(): void {
    const active = document.activeElement;
    let hasSel = false;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      hasSel = (active.selectionEnd ?? 0) > (active.selectionStart ?? 0);
    } else if (active instanceof HTMLElement && active.isContentEditable) {
      const sel = window.getSelection();
      hasSel = !!sel && sel.toString().trim().length >= 2;
    }
    if (!hasSel) this.hide();
  }

  // ─── Keyboard ───────────────────────────────────────────────

  private handleKey(e: KeyboardEvent): void {
    if (!this.menu || this.menu.style.display === 'none') return;
    // Only handle navigation keys when an editable with selection is focused —
    // we don't want to swallow Esc / ArrowDown in other contexts.
    if (e.key === 'Escape') { this.hide(); return; }
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      this.cursor = Math.min(this.actions.length - 1, this.cursor + 1);
      this.paintActive();
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      this.cursor = Math.max(0, this.cursor - 1);
      this.paintActive();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || e.altKey)) {
      // Use modifier + Enter so plain Enter in the editable still adds a newline.
      e.preventDefault();
      const action = this.actions[this.cursor];
      if (action) this.runAction(action);
    }
  }

  // ─── Sub-menu picker (for Translate target language etc.) ──

  private pickFromSubmenu(
    title: string,
    items: Array<{ id: string; label: string }>,
  ): Promise<{ id: string; label: string } | null> {
    return new Promise((resolve) => {
      if (this.subMenu) this.subMenu.remove();
      const wrap = document.createElement('div');
      wrap.setAttribute(UI_ATTR, 'inline-agent');
      wrap.className = 'ia-submenu';
      wrap.innerHTML = `<div class="ia-header">${escapeHtml(title)}</div><div class="ia-list"></div>`;
      const list = wrap.querySelector<HTMLElement>('.ia-list')!;
      let cursor = 0;
      const paint = () => {
        list.querySelectorAll<HTMLButtonElement>('[data-idx]').forEach((b) => {
          if (Number(b.dataset.idx) === cursor) b.setAttribute('data-active', '');
          else b.removeAttribute('data-active');
        });
      };
      const cleanup = () => {
        wrap.remove();
        document.removeEventListener('keydown', onKey, true);
        this.subMenu = null;
      };
      const choose = (idx: number) => {
        const it = items[idx];
        cleanup();
        resolve(it ?? null);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(); resolve(null); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); cursor = (cursor + 1) % items.length; paint(); }
        else if (e.key === 'ArrowUp')   { e.preventDefault(); cursor = (cursor - 1 + items.length) % items.length; paint(); }
        else if (e.key === 'Enter')     { e.preventDefault(); choose(cursor); }
      };
      items.forEach((it, idx) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ia-row';
        b.dataset.idx = String(idx);
        b.innerHTML = `<span class="ia-label">${escapeHtml(it.label)}</span>`;
        b.addEventListener('mousedown', (e) => { e.preventDefault(); choose(idx); });
        b.addEventListener('mouseenter', () => { cursor = idx; paint(); });
        list.appendChild(b);
      });
      // Position relative to the main menu (to the right of it).
      document.body.appendChild(wrap);
      this.subMenu = wrap;
      if (this.menu && this.currentRect) {
        const r = this.menu.getBoundingClientRect();
        wrap.style.left = `${r.right + window.scrollX + 4}px`;
        wrap.style.top = `${r.top + window.scrollY}px`;
      }
      document.addEventListener('keydown', onKey, true);
      paint();
    });
  }

  // ─── Run an action ──────────────────────────────────────────

  private async runAction(action: InlineAction): Promise<void> {
    if (!this.currentEditable || !this.currentSelection) return;
    const target = this.currentEditable;
    const sel = this.currentSelection;

    // Custom handler — runs INSTEAD of the LLM round-trip. Use for
    // formatting actions (bold / colour / insert table) where no LLM is
    // needed; the host directly mutates the editable.
    if (action.handler) {
      this.hide();
      try {
        await action.handler({
          text: sel.text,
          target,
          selection: { start: sel.start, end: sel.end },
          agent: this,
        });
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[inline-agent] handler threw:', (err as Error).message);
      }
      return;
    }

    // Resolve the instruction. Sub-menu handlers may abort.
    let instruction = action.instruction;
    if (action.build) {
      const built = await action.build({ text: sel.text, agent: this });
      if (built == null) return;          // user cancelled the sub-menu
      instruction = built;
    }
    if (!instruction) return;

    this.hide();
    // Indicator shown only as a brief flash — the streaming path tears
    // it down on the first delta and writes straight into the target.
    this.dddk?.subtitle.showIndicator('processing', this.t('processing'));
    this.runToken++;
    const myToken = this.runToken;

    // Build the context window — N chars around the selection. For
    // contenteditable targets we don't have offset indices, so we use the
    // selection's text alone as a degenerate "context" (LLM still gets the
    // instruction; just no surrounding paragraph).
    let contextPrompt: string;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      contextPrompt = buildContextPrompt(target.value, sel.start, sel.end);
    } else {
      // contenteditable — use the parent element's textContent as context.
      const parent = (target.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, div') ?? target) as HTMLElement;
      const fullText = parent.innerText ?? parent.textContent ?? sel.text;
      const idx = fullText.indexOf(sel.text);
      if (idx >= 0) {
        contextPrompt = buildContextPrompt(fullText, idx, idx + sel.text.length);
      } else {
        contextPrompt = `[[SEL]]${sel.text}[[/SEL]]`;
      }
    }

    try {
      const llm = resolveLLM(this.llm, 'inline');
      const userMessage = `Instruction: ${instruction}\n\nContext (with selection marked):\n"""\n${contextPrompt}\n"""`;
      const systemMessage = this.cfg.systemPrompt ?? SYSTEM_PROMPT;
      const mode = action.displayAs ?? 'replace';

      const streamingProvider = llm as unknown as StreamingProvider;
      const canStream = typeof streamingProvider.streamComplete === 'function' && !this.cfg.tools;

      if (canStream && (mode === 'replace' || mode === 'subtitle' || mode === 'confirm')) {
        const handle = streamingProvider.streamComplete!({
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: userMessage },
          ],
          thinking: 'off',
          temperature: 0,
          maxTokens: Math.max(256, sel.text.length * 4 + 200),
        });
        const replacement = await this.consumeStream(handle, target, sel, mode, myToken);
        if (myToken !== this.runToken) return;
        if (mode === 'confirm' && replacement) {
          // Confirm mode: we streamed into the subtitle bar; finalize
          // with accept/reject. The result is NOT applied until the
          // user accepts.
          this.dddk?.subtitle.finalizeStreamed({ autoHide: 0 });
          // Replace the streaming bar with an accept/reject bar carrying
          // the same text — the user gets a clear decision moment.
          this.dddk?.subtitle.show({
            text: replacement,
            type: 'agent',
            onAccept: () => this.applyResult(target, sel, replacement),
            onReject: () => { /* discard */ },
          });
        } else if (mode === 'subtitle') {
          this.dddk?.subtitle.finalizeStreamed({ autoHide: 0 });
        }
      } else {
        const result = this.cfg.tools
          ? await this.runWithTools(llm, systemMessage, userMessage, sel.text.length, myToken)
          : await llm.complete({
              messages: [
                { role: 'system', content: systemMessage },
                { role: 'user', content: userMessage },
              ],
              thinking: 'off',
              temperature: 0,
              maxTokens: Math.max(256, sel.text.length * 4 + 200),
            });
        if (myToken !== this.runToken) return;
        const replacement = extractReplacement(result.content);
        if (replacement) {
          if (mode === 'replace') {
            this.applyResult(target, sel, replacement);
          } else if (mode === 'subtitle') {
            this.dddk?.subtitle.show({ text: replacement, type: 'agent' });
          } else if (mode === 'confirm') {
            this.dddk?.subtitle.show({
              text: replacement,
              type: 'agent',
              onAccept: () => this.applyResult(target, sel, replacement),
              onReject: () => { /* discard */ },
            });
          }
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.dddk as any)?.emitIntent?.({
        kind: 'palette_activated',
        itemId: `inline.${action.id}`,
        arg: sel.text.slice(0, 60),
        attachmentsCount: 0,
        timestamp: Date.now(),
      });
    } catch (err) {
      // Friendly subtitle — strip raw JSON error blobs that look like
      // `Gemini HTTP 500: { "error": ... }` (LLM vendor errors). Surface
      // only the human-readable hint so the user sees "rewrite failed,
      // try again" instead of a stack trace. Full message still goes to
      // console for diagnosis.
      const rawMsg = (err as Error).message ?? '';
      const friendly = humanizeLLMError(rawMsg, this.cfg.locale);
      this.dddk?.subtitle.show({
        text: `${this.t('failed')}: ${friendly}`,
        type: 'info',
        autoHide: 3500,
      });
      if (typeof console !== 'undefined') console.warn('[inline-agent] LLM call failed:', rawMsg);
    } finally {
      this.dddk?.subtitle.hideIndicator();
    }
  }

  /**
   * Stream tokens from the LLM straight into the target — character by
   * character into an input/textarea (mode=replace) or into the live
   * subtitle bar (mode=subtitle/confirm). Watches for the
   * `<<<REPLACEMENT>>>` start marker so we don't emit any preamble the
   * model leaks, and stops at `<<<END>>>` so trailing tokens don't
   * contaminate. Returns the final concatenated replacement string —
   * mode=confirm uses it to build the accept/reject UI after streaming.
   */
  private async consumeStream(
    handle: AsyncIterable<StreamChunk>,
    target: HTMLElement,
    sel: { text: string; start: number; end: number },
    mode: 'replace' | 'subtitle' | 'confirm',
    myToken: number,
  ): Promise<string> {
    let inReplacement = false;
    let processedLen = 0;
    let replacementBuf = '';
    let replaceCursor = sel.start;
    let replaceStarted = false;

    // For replace mode: blank out the selection up-front. As deltas
    // arrive we splice them in at cursor.
    const isFormInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

    // Hide the indicator on first delta (we'll get the visual progress
    // from the input or the streaming bar).
    let indicatorCleared = false;

    for await (const chunk of handle) {
      if (myToken !== this.runToken) return replacementBuf;
      if (!indicatorCleared) {
        this.dddk?.subtitle.hideIndicator();
        indicatorCleared = true;
      }

      const totalText = chunk.text;

      if (!inReplacement) {
        const startIdx = totalText.indexOf(REPLACEMENT_START);
        if (startIdx < 0) continue;
        inReplacement = true;
        processedLen = startIdx + REPLACEMENT_START.length;
        if (mode === 'replace' && isFormInput && !replaceStarted) {
          // Blank the selection now — the model has committed to a
          // replacement and we want the deletion to land on the SAME
          // tick as the first character so the cursor doesn't dance.
          const el = target as HTMLInputElement | HTMLTextAreaElement;
          const before = el.value.slice(0, sel.start);
          const after = el.value.slice(sel.end);
          el.value = before + after;
          el.setSelectionRange(sel.start, sel.start);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          replaceStarted = true;
        }
      }

      // Process whatever's new since last iteration, watching for any
      // recognised end-marker variant (canonical `<<<END>>>` plus the
      // hybrid SEL-style variants small models sometimes emit).
      const newRaw = totalText.slice(processedLen);
      const end = findEndMarker(newRaw);

      let safeChunk: string;
      let consumeLen: number;
      let finished = false;
      if (end !== null) {
        safeChunk = newRaw.slice(0, end.idx);
        consumeLen = end.idx + end.len;
        finished = true;
      } else {
        // Hold back the tail if it could be the start of ANY end-marker
        // variant. Otherwise a chunk boundary mid-marker would leak the
        // marker's leading characters into the input.
        let safeEnd = newRaw.length;
        for (const variant of REPLACEMENT_END_VARIANTS) {
          const partialIdx = findPartialMarkerTail(newRaw, variant);
          if (partialIdx >= 0 && partialIdx < safeEnd) safeEnd = partialIdx;
        }
        safeChunk = newRaw.slice(0, safeEnd);
        consumeLen = safeEnd;
      }

      // Trim the leading newline that the prompt encourages but the
      // replacement body shouldn't carry. Only on the very first
      // emitted chunk after the start marker.
      let emit = safeChunk;
      if (replacementBuf === '' && emit.startsWith('\n')) emit = emit.slice(1);
      else if (replacementBuf === '' && emit.startsWith('\r\n')) emit = emit.slice(2);

      if (emit) {
        replacementBuf += emit;
        if (mode === 'replace' && isFormInput) {
          this.insertAtCursor(target as HTMLInputElement | HTMLTextAreaElement, replaceCursor, emit);
          replaceCursor += emit.length;
        } else if (mode === 'subtitle' || mode === 'confirm') {
          this.dddk?.subtitle.appendStreamed(emit);
        }
      }
      processedLen += consumeLen;
      if (finished) break;
    }

    // Strip trailing newline left over from the closing marker on its own line.
    if (replacementBuf.endsWith('\n')) {
      replacementBuf = replacementBuf.slice(0, -1);
      // No visual fix-up needed — the trailing newline is already on screen
      // but harmless. We could trim from the input here, but a single
      // newline at end-of-replacement isn't worth the splice ceremony.
    }

    return replacementBuf;
  }

  /** Splice text into an input / textarea at a known cursor position
   *  and update the cursor. Uses the React-aware native value setter so
   *  controlled inputs see the change. */
  private insertAtCursor(
    el: HTMLInputElement | HTMLTextAreaElement,
    cursorPos: number,
    text: string,
  ): void {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const cur = el.value;
    const next = cur.slice(0, cursorPos) + text + cur.slice(cursorPos);
    if (setter) setter.call(el, next);
    else el.value = next;
    const newCursor = cursorPos + text.length;
    el.setSelectionRange(newCursor, newCursor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * Mini tool-call loop used when the host configured `tools` on
   * `InlineAgentConfig`. The LLM may call any tool any number of
   * times (up to `maxToolRounds`) before producing the final
   * `{ replacement }` JSON. Optional subtitle narration surfaces
   * the agent's progress so the user knows what's being looked up
   * before their text changes.
   */
  private async runWithTools(
    llm: ReturnType<typeof resolveLLM>,
    systemMessage: string,
    userMessage: string,
    selLength: number,
    myToken: number,
  ): Promise<{ content: string }> {
    const tools = this.cfg.tools ?? [];
    const toolDefs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
    const messages: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string;
      toolCallId?: string;
      toolCalls?: ToolCall[];
    }> = [
      { role: 'system', content: systemMessage + '\n\n' + this.toolSystemSuffix() },
      { role: 'user', content: userMessage },
    ];

    const abort = new AbortController();
    // If the user fires a second action mid-loop, runToken changes and
    // we abort any in-flight tool fetch.
    const tokenWatch = setInterval(() => {
      if (myToken !== this.runToken) abort.abort();
    }, 80);

    try {
      for (let round = 0; round < this.cfg.maxToolRounds; round++) {
        const result = await llm.complete({
          messages,
          tools: toolDefs,
          thinking: 'off',
          temperature: 0,
          maxTokens: Math.max(384, selLength * 4 + 320),
          signal: abort.signal,
        });
        if (myToken !== this.runToken) return { content: '' };

        const calls = result.toolCalls ?? [];
        if (calls.length === 0) {
          // No more tools — this is the final reply.
          return { content: result.content ?? '' };
        }

        // Append the assistant's tool-call turn so the LLM keeps context.
        messages.push({
          role: 'assistant',
          content: result.content ?? '',
          toolCalls: calls,
        });

        // Execute each requested tool sequentially and append the
        // result back as a `role: 'tool'` message.
        for (const call of calls) {
          if (myToken !== this.runToken) return { content: '' };
          const def = tools.find((t) => t.name === call.name);
          if (!def) {
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              content: JSON.stringify({ ok: false, reason: 'unknown_tool' }),
            });
            continue;
          }
          if (this.cfg.enableSubtitle) {
            const lookingUp = this.cfg.locale === 'zh-TW'
              ? `查詢中:${def.name}…`
              : `Looking up: ${def.name}…`;
            this.dddk?.subtitle.show({ text: lookingUp, type: 'info' });
          }
          let toolResult: unknown;
          try {
            toolResult = await def.handler(
              call.arguments as never,
              {
                // Inline tools don't have a real AgentSession; pass a thin
                // shim with the bits a tool might actually consult.
                session: {
                  id: 'inline-' + myToken,
                  task: userMessage,
                  status: 'running',
                  currentPage: typeof location !== 'undefined' ? location.pathname : '/',
                  steps: [],
                  startedAt: Date.now(),
                } as never,
                signal: abort.signal,
                // Inline agent has no indexed DOM dump — pass CSS selectors
                // through to querySelector. The numeric-index resolution path
                // only matters for the webagent (tour mode).
                resolveTarget: (target: string | number) => {
                  if (typeof target !== 'string' || typeof document === 'undefined') return null;
                  try { return document.querySelector(target); } catch { return null; }
                },
              },
            );
          } catch (err) {
            toolResult = { ok: false, reason: 'thrown', message: (err as Error).message };
          }
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            content: JSON.stringify(toolResult),
          });
        }
      }
      // Safety cap reached — ask for the final answer with no tools.
      const final = await llm.complete({
        messages: [
          ...messages,
          {
            role: 'user',
            content: 'Max tool rounds reached. Produce the final JSON `{ "replacement": "..." }` now using whatever you already have.',
          },
        ],
        thinking: 'off',
        temperature: 0,
        maxTokens: Math.max(256, selLength * 4 + 200),
        signal: abort.signal,
      });
      return { content: final.content ?? '' };
    } finally {
      clearInterval(tokenWatch);
    }
  }

  /**
   * Suffix appended to the system prompt when tools are configured —
   * tells the LLM the loop shape (call tools first, then return the
   * final JSON) without rewriting the entire base prompt.
   */
  private toolSystemSuffix(): string {
    return (
      'You may call any of the provided tools to gather context before producing ' +
      'the final answer. Each tool returns JSON. When you have enough information, ' +
      'reply WITHOUT a tool call and produce the final `{ "replacement": "..." }` ' +
      'object. Do not narrate your tool calls in the final reply — just the JSON.'
    );
  }

  private applyResult(
    target: HTMLElement,
    sel: { text: string; start: number; end: number },
    result: string,
  ): void {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const before = target.value.slice(0, sel.start);
      const after = target.value.slice(sel.end);
      target.value = `${before}${result}${after}`;
      const cursor = before.length + result.length;
      target.setSelectionRange(cursor, cursor);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (target.isContentEditable) {
      const winSel = window.getSelection();
      if (winSel && winSel.rangeCount > 0) {
        const range = winSel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(result));
      }
    }
  }

  // ─── helpers ────────────────────────────────────────────────

  // ─── Shortcut + prefix trigger ─────────────────────────────

  /**
   * Keyboard shortcut handler — opens the menu for the current selection
   * even if `selectionchange` didn't fire (e.g. user is typing and wants
   * AI without re-selecting). When triggered with no active selection,
   * we fall back to selecting the focused word OR opening the menu
   * anchored at the caret with `prefixActive=false`.
   */
  private handleShortcut(e: KeyboardEvent): void {
    if (!this.enabled || !this.shortcutSpec) return;
    const sc = this.shortcutSpec;
    const modOk = sc.ctrl ? (e.metaKey || e.ctrlKey) : true;
    const altOk = sc.alt ? e.altKey : !e.altKey || sc.alt === false;
    const shiftOk = sc.shift ? e.shiftKey : !e.shiftKey || sc.shift === false;
    // Loose mod matching — we always accept Cmd OR Ctrl as `mod`.
    if (!modOk) return;
    if (sc.alt !== undefined && sc.alt !== e.altKey) return;
    if (sc.shift !== undefined && sc.shift !== e.shiftKey) return;
    if (e.key.toLowerCase() !== sc.key.toLowerCase()) return;
    e.preventDefault();
    // Re-run selection detection to pick up the current focused editable.
    this.handleSelectionChange();
  }

  /**
   * Prefix-trigger input handler. When `prefixTrigger.enabled` is true,
   * we watch every focused editable for text starting with the configured
   * prefix (default `/inline ai `). When detected, we mark `prefixActive`
   * so the next Enter (or mod+Enter / double newline) submits.
   *
   * The detection runs on every `input` event so it captures both typing
   * and paste. We do NOT auto-submit on typing — only on the configured
   * submit gesture, so the user can edit their prompt mid-typing.
   */
  private handlePrefixInput(e: Event): void {
    if (!this.enabled || !this.cfg.prefixTrigger?.enabled) return;
    const target = e.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (this.cfg.ignoreSelector && target.closest(this.cfg.ignoreSelector)) return;

    const prefix = this.cfg.prefixTrigger.prefix ?? '/inline ai ';
    const minChars = this.cfg.prefixTrigger.minChars ?? 4;
    const value = target.value;
    const wasActive = this.prefixActive;
    this.prefixActive = value.startsWith(prefix) && value.length >= prefix.length + minChars;

    // Subtle visual hint via the subtitle indicator when prefix becomes
    // active (so the user knows "AI is armed, press Enter to run").
    if (this.prefixActive && !wasActive) {
      const zh = this.cfg.locale === 'zh-TW';
      this.dddk?.subtitle.show({
        text: zh ? `偵測到 ${prefix.trim()} — 按 Enter 跑 AI` : `${prefix.trim()} detected — press Enter to run AI`,
        type: 'info',
        autoHide: 2500,
      });
    }

    // Wire the submit detector once. Plain Enter is the default — that
    // means a textarea using prefix mode loses literal newlines while
    // prefix is active (acceptable: prefix submissions are short prompts).
    const onSubmit = this.makePrefixSubmitter(target, prefix) as EventListener;
    target.addEventListener('keydown', onSubmit);
    // Self-removing — runs once and unbinds. Re-attaches on the next
    // input event if the user fires it again.
    target.addEventListener(
      'blur',
      () => target.removeEventListener('keydown', onSubmit),
      { once: true },
    );
  }

  private makePrefixSubmitter(
    target: HTMLInputElement | HTMLTextAreaElement,
    prefix: string,
  ): (e: KeyboardEvent) => void {
    const submitOn = this.cfg.prefixTrigger?.submitOn ?? 'enter';
    let lastWasNewline = false;
    return (e: KeyboardEvent) => {
      if (!this.prefixActive) { lastWasNewline = false; return; }
      const shouldSubmit =
        submitOn === 'enter'
          ? e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey
        : submitOn === 'mod-enter'
          ? e.key === 'Enter' && (e.metaKey || e.ctrlKey)
        : submitOn === 'double-newline'
          ? e.key === 'Enter' && lastWasNewline
        : false;
      lastWasNewline = e.key === 'Enter';
      if (!shouldSubmit) return;
      e.preventDefault();
      void this.runPrefixSubmit(target, prefix);
    };
  }

  private async runPrefixSubmit(
    target: HTMLInputElement | HTMLTextAreaElement,
    prefix: string,
  ): Promise<void> {
    const fullValue = target.value;
    if (!fullValue.startsWith(prefix)) return;
    const instruction = fullValue.slice(prefix.length).trim();
    if (!instruction) return;

    if (this.cfg.prefixTrigger?.confirmBeforeReplace) {
      const zh = this.cfg.locale === 'zh-TW';
      // Cheap confirm via window.confirm — the host can override by
      // setting `confirmBeforeReplace: false` and adding their own UI.
      const ok = window.confirm(
        zh ? `用 AI 跑以下指令並覆蓋輸入框?\n\n${instruction}` : `Run AI with this prompt and replace the input?\n\n${instruction}`,
      );
      if (!ok) return;
    }

    this.dddk?.subtitle.showIndicator('processing', this.t('processing'));
    this.runToken++;
    const myToken = this.runToken;
    try {
      const llm = resolveLLM(this.llm, 'inline');
      const result = await llm.complete({
        messages: [
          { role: 'system', content: this.cfg.systemPrompt ?? SYSTEM_PROMPT },
          { role: 'user', content: `Instruction: ${instruction}\n\nContext (with selection marked):\n"""\n[[SEL]][[/SEL]]\n"""\n\nReturn JSON: { "replacement": "..." }` },
        ],
        thinking: 'off',
        jsonMode: true,
        temperature: 0,
        maxTokens: 1024,
      });
      if (myToken !== this.runToken) return;
      const replacement = extractReplacement(result.content) ?? result.content.trim();
      target.value = replacement;
      target.setSelectionRange(replacement.length, replacement.length);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      this.prefixActive = false;
    } catch (err) {
      const rawMsg = (err as Error).message ?? '';
      const friendly = humanizeLLMError(rawMsg, this.cfg.locale);
      this.dddk?.subtitle.show({
        text: `${this.t('failed')}: ${friendly}`,
        type: 'info',
        autoHide: 3500,
      });
      if (typeof console !== 'undefined') console.warn('[inline-agent] prefix submit failed:', rawMsg);
    } finally {
      this.dddk?.subtitle.hideIndicator();
    }
  }

  // ─── helpers ────────────────────────────────────────────────

  private getSelectionRect(target: HTMLElement): DOMRect | null {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      // Mirror-div technique: clone the input's typographic styles into an
      // off-screen <div>, set its text to the input's value up to the
      // selection boundary, and read the caret span's coords. Without this,
      // the menu would anchor to the input element's bbox — fine for a
      // 200×40 input, completely wrong for a tall multiline textarea
      // where the menu floats next to the textarea border instead of the
      // selected text. Algorithm adapted from textarea-caret-position.
      const start = target.selectionStart ?? 0;
      const end = target.selectionEnd ?? start;
      const startCoords = getCaretCoords(target, start);
      const endCoords = getCaretCoords(target, end);
      // Build a DOMRect that spans selectionStart → selectionEnd. The
      // popover reads `rect.right` / `rect.top` from this to anchor at
      // the end of the selection.
      const top = Math.min(startCoords.top, endCoords.top);
      const bottom = Math.max(
        startCoords.top + startCoords.height,
        endCoords.top + endCoords.height,
      );
      // Multi-line selection → anchor the menu at the END of the
      // selection (where the user's cursor is) with zero width. A
      // left=0 fallback here would place the menu at viewport-left for
      // textareas on the right side of the page, far from the selection.
      const sameLine = Math.abs(endCoords.top - startCoords.top) < startCoords.height * 0.5;
      if (!sameLine) {
        return new DOMRect(endCoords.left, endCoords.top, 0, endCoords.height);
      }
      const left = Math.min(startCoords.left, endCoords.left);
      const right = Math.max(startCoords.left, endCoords.left);
      return new DOMRect(left, top, Math.max(0, right - left), bottom - top);
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return sel.getRangeAt(0).getBoundingClientRect();
  }
}

/**
 * Convert a raw LLM provider error into a short subtitle message.
 * Inputs are things like:
 *   `Gemini HTTP 500: { "error": { "code": 500, "message": "Internal..." } }`
 *   `OpenAI HTTP 429: { ... rate limit ... }`
 *   `Gemini HTTP 400: { ... Thinking budget is not supported ... }`
 *
 * We pluck the vendor + status, drop the JSON blob, and translate the
 * common cases into 1-line guidance. Full original message goes to
 * console for engineers to grep.
 */
/**
 * Find the index in `text` where a prefix of `marker` starts at the tail.
 * Used by the streaming consumer to avoid emitting characters that
 * might be the leading edge of a closing marker we haven't fully
 * received yet (e.g. `<<<EN` is held back until the next chunk reveals
 * whether it's `<<<END>>>` or just literal text).
 * Returns -1 if no prefix overlap.
 */
function findPartialMarkerTail(text: string, marker: string): number {
  // Longest prefix of `marker` that the tail of `text` ends with.
  const maxLen = Math.min(text.length, marker.length - 1);
  for (let n = maxLen; n > 0; n--) {
    if (text.endsWith(marker.slice(0, n))) return text.length - n;
  }
  return -1;
}

function humanizeLLMError(raw: string, locale: string): string {
  const zh = locale === 'zh-TW';
  const m = raw.match(/^(\w+)\s+HTTP\s+(\d+)/i);
  if (!m) return raw.length > 80 ? raw.slice(0, 77) + '…' : raw;
  const vendor = m[1];
  const status = parseInt(m[2]!, 10);
  if (status === 429) return zh ? `${vendor} 速率上限，稍等幾秒再試` : `${vendor} rate limit — wait a few seconds and retry`;
  if (status >= 500 && status < 600) return zh ? `${vendor} 暫時忙線，請再試一次` : `${vendor} is having a moment — please retry`;
  if (status === 400) return zh ? `${vendor} 拒絕請求(請求格式問題)` : `${vendor} rejected the request (bad shape)`;
  if (status === 401 || status === 403) return zh ? `${vendor} 認證失敗` : `${vendor} auth failed`;
  return zh ? `${vendor} 失敗 (${status})` : `${vendor} failed (${status})`;
}

/**
 * Parse a shortcut spec like `mod+.` / `ctrl+alt+k` / `shift+enter`.
 * `mod` is a synonym for Ctrl on non-Mac and Cmd on Mac (resolved at runtime).
 */
function parseShortcut(spec: string): { ctrl?: boolean; alt?: boolean; shift?: boolean; key: string } | null {
  if (!spec) return null;
  const parts = spec.toLowerCase().split('+').map((s) => s.trim());
  const out: { ctrl?: boolean; alt?: boolean; shift?: boolean; key: string } = { key: '' };
  for (const p of parts) {
    if (p === 'mod' || p === 'ctrl' || p === 'cmd' || p === 'meta') out.ctrl = true;
    else if (p === 'alt' || p === 'option') out.alt = true;
    else if (p === 'shift') out.shift = true;
    else out.key = p;
  }
  return out.key ? out : null;
}

// ─── caret coords for inputs / textareas ─────────────────────────────
//
// Mirror-div technique: render the input's value into an invisible
// absolutely-positioned <div> styled IDENTICALLY to the input, with a
// <span> at the requested character position. The span's offset
// coordinates give us the caret position in viewport space after
// adding the input's bounding rect and adjusting for the input's own
// scroll. Cached property list is the minimum subset of computed style
// properties that affect text layout (font, padding, border, wrapping).

const MIRROR_PROPS = [
  'direction', 'boxSizing',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch',
  'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily',
  'textAlign', 'textTransform', 'textIndent', 'textDecoration',
  'letterSpacing', 'wordSpacing',
  'tabSize', 'MozTabSize',
] as const;

interface CaretCoords {
  top: number;
  left: number;
  height: number;
}

function getCaretCoords(
  el: HTMLInputElement | HTMLTextAreaElement,
  position: number,
): CaretCoords {
  const isTextarea = el.tagName === 'TEXTAREA';
  const computed = window.getComputedStyle(el);

  const mirror = document.createElement('div');
  document.body.appendChild(mirror);
  const s = mirror.style;
  // Take it out of layout flow.
  s.position = 'absolute';
  s.visibility = 'hidden';
  s.top = '0';
  s.left = '0';
  s.whiteSpace = isTextarea ? 'pre-wrap' : 'pre';
  s.wordWrap = isTextarea ? 'break-word' : 'normal';
  s.overflow = 'hidden';
  s.width = isTextarea ? `${el.clientWidth}px` : 'auto';
  s.height = 'auto';

  for (const prop of MIRROR_PROPS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s as any)[prop] = (computed as any)[prop];
  }

  const value = el.value;
  // Single-line <input>: collapse whitespace to NBSPs so the mirror
  // doesn't wrap differently from the input.
  const before = value.substring(0, position);
  mirror.textContent = isTextarea ? before : before.replace(/\s/g, ' ');

  // Span at the caret position. Need SOME content so it has dimensions —
  // use the next character of value, or '.' as a placeholder.
  const span = document.createElement('span');
  span.textContent = value.substring(position) || '.';
  mirror.appendChild(span);

  const elRect = el.getBoundingClientRect();
  const lineHeight = parseInt(computed.lineHeight, 10) ||
    parseInt(computed.fontSize, 10) * 1.2;

  const coords: CaretCoords = {
    top: elRect.top + span.offsetTop - el.scrollTop,
    left: elRect.left + span.offsetLeft - el.scrollLeft,
    height: lineHeight,
  };

  document.body.removeChild(mirror);
  return coords;
}

