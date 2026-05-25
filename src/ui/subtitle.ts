/**
 * Subtitle bar — DOM-rendered, CSS-variable themed.
 * 詳細規劃見 ../../docs/07-subtitle-ui.md
 */

import type { SubtitleChoiceOptions, SubtitleShowOptions, SubtitleType } from '../types';
import { escapeHtml, injectScopedStyle } from '../utils/dom';
import { applyPlacement } from './placement';

const UI_ATTR = 'data-dddk-ui';
const STYLE_ID = 'dddk-subtitle-style';

export class Subtitle {
  private el: HTMLDivElement | null = null;
  private indicator: HTMLDivElement | null = null;
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private currentOpts: SubtitleShowOptions | null = null;
  private delegatedHandler: ((e: Event) => void) | null = null;
  /** Extra teardown for the multi-choice mode (keyboard listener on document). */
  private choiceTeardown: (() => void) | null = null;
  /** Click-anywhere / any-key dismiss teardown for info subtitles. */
  private dismissTeardown: (() => void) | null = null;
  private locale: string;

  constructor(opts: { locale?: string } = {}) {
    this.locale = opts.locale ?? 'en';
  }

  setLocale(locale: string): void {
    this.locale = locale;
  }
  /** Set by the orchestrator so it can flip GestureManager.hasSuggestion
   *  whenever a subtitle becomes visible / hidden. Without this hookup a
   *  single space tap on a proactive prompt would be a no-op (space-tap
   *  → accept only fires when `hasSuggestion` is true). */
  private onVisibilityChange?: (visible: boolean) => void;

  setVisibilityListener(fn: (visible: boolean) => void): void {
    this.onVisibilityChange = fn;
  }

  /**
   * Pluggable TTS hook. Every subtitle copy in dddk is written to be
   * naturally readable aloud (no debug log lines, no JSON blobs — that
   * is the editorial rule, see project memory). If the host wires up a
   * TTSProvider via `setTTSProvider`, every `subtitle.show()` call also
   * sends the text through it for real-time speech synthesis. The host
   * decides what provider (free Web Speech `speechSynthesis` / OpenAI
   * TTS / Gemini TTS / Azure / ElevenLabs) and how to gate it with a
   * user pref toggle.
   *
   * The provider is called fire-and-forget — failures don't block the
   * subtitle render, they just mean no audio for that line.
   */
  private ttsProvider?: (text: string, opts: { locale: string; type: SubtitleType }) => void;

  setTTSProvider(fn: typeof this.ttsProvider | null): void {
    this.ttsProvider = fn ?? undefined;
  }

  show(opts: SubtitleShowOptions): void {
    if (typeof document === 'undefined') return;
    ensureStyles();

    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }

    const wasVisible = this.el !== null;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.setAttribute(UI_ATTR, 'bar');
      // Positioning (fixed, center-bottom, max-width, z-index) comes from
      // the shared placement module — same slot is used by Proactive's
      // subtitle-based render and any host code that mounts custom UI
      // in the bottom-center bar.
      applyPlacement(this.el, 'subtitle');
      document.body.appendChild(this.el);
    }
    if (!wasVisible) this.onVisibilityChange?.(true);

    this.currentOpts = opts;
    this.el.setAttribute('data-dddk-bar-type', opts.type);
    this.el.innerHTML = `
      <div ${UI_ATTR}="bar-text">${renderInlineMarkdown(opts.text)}</div>
      ${this.renderHints(opts)}
      ${this.renderButtons(opts)}
    `;

    this.wireButtons(opts);
    document.body.dataset.dddkActive = 'true';

    // Fire-and-forget TTS — host wires this up; if not, no-op. We pass
    // the same plain-prose `opts.text` the user sees, so the rule "all
    // subtitle copy must be readable aloud" makes the audio sensible
    // without further transformation. Failures swallowed on purpose
    // (no audio is strictly better than blocking the visual subtitle).
    if (this.ttsProvider) {
      try { this.ttsProvider(opts.text, { locale: this.locale, type: opts.type }); }
      catch { /* swallow */ }
    }

    // Auto-hide policy:
    //   - Every subtitle auto-hides after 12 seconds by default. Long
    //     enough that users can finish reading even verbose agent
    //     narrations or proactive prompts; short enough that an idle
    //     subtitle doesn't camp on screen forever when the user walked
    //     away. The interaction-based dismiss (click anywhere / any
    //     non-modifier key for info subtitles; Space / double-tap Space
    //     for action subtitles) still fires first when the user acts.
    //   - Caller can pass `autoHide` to override (e.g. `30000` for very
    //     long messages, `0` to disable auto-hide entirely).
    // Default OFF — caller must opt-in by passing `autoHide: <ms>`.
    // Subtitles stick until: click anywhere outside the bar, press any
    // non-modifier key, double-tap Space, or call `hide()`.
    const DEFAULT_AUTO_HIDE = 0;
    const autoHideMs = opts.autoHide ?? DEFAULT_AUTO_HIDE;
    if (autoHideMs > 0) {
      this.autoHideTimer = setTimeout(() => this.hide(), autoHideMs);
    }
    this.installInteractionDismiss(opts);
  }

  /**
   * Click-anywhere / any-key dismiss handler.
   *
   * Applies to EVERY subtitle — info or action:
   *  - Click OUTSIDE the bar dismisses (info: hide; action: same, no
   *    accept/reject fired so it's just "ignore the prompt").
   *  - Click INSIDE the bar is ignored — that's a button click and the
   *    button's own handler should fire (wireButtons attaches that).
   *  - Any non-modifier key press dismisses (Space / double-Space are
   *    handled by the gesture manager BEFORE this listener fires, so
   *    Accept / Reject still work).
   *
   * 120ms attach delay so the click that OPENED the subtitle (a palette
   * row click etc.) doesn't immediately dismiss it.
   */
  private installInteractionDismiss(_opts: SubtitleShowOptions): void {
    if (this.dismissTeardown) {
      this.dismissTeardown();
      this.dismissTeardown = null;
    }
    const ac = new AbortController();
    setTimeout(() => {
      if (ac.signal.aborted) return;
      const onClick = (e: Event): void => {
        // Clicks on the bar itself = let the bar's button handler fire.
        const target = e.target as Element | null;
        if (target && this.el && this.el.contains(target)) return;
        this.hide();
      };
      const onKey = (e: KeyboardEvent): void => {
        // Skip pure modifier presses — preparing for a shortcut isn't dismissal.
        if (['Control', 'Shift', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
        // Skip Space / Escape — those route through the GestureManager
        // first (onAccept / onReject / onEscape) and would double-fire
        // here. The gesture manager calls hide() itself when needed.
        if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Escape') return;
        this.hide();
      };
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
      this.dismissTeardown = () => {
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey, true);
      };
    }, 120);
    // hide() before listeners attach → abort the setTimeout so we don't
    // leak. The setter above will overwrite this once attached.
    this.dismissTeardown = () => { ac.abort(); };
  }

  update(text: string): void {
    if (!this.el) return;
    const textEl = this.el.querySelector(`[${UI_ATTR}="bar-text"]`);
    if (textEl) textEl.innerHTML = renderInlineMarkdown(text);
    if (this.currentOpts) this.currentOpts.text = text;
  }

  /**
   * Multi-choice variant of `show()`. Renders the question + numbered
   * option list inside the subtitle bar. The user picks via click, digit
   * key (1..N), or — if `allowFreeText` is true (default) — by typing
   * into the inline free-text input and pressing Enter.
   *
   * The subtitle bar is replaced wholesale (any current single-line
   * subtitle is dismissed first). Esc invokes `onCancel`.
   *
   * Designed to mirror Claude Code's AskUserQuestion envelope (2–4
   * options + optional free-text fallback), but rendered into the
   * standard subtitle slot so a host that already styles the subtitle
   * gets a consistent look for both yes/no and multi-choice prompts.
   */
  showChoice(opts: SubtitleChoiceOptions): void {
    if (typeof document === 'undefined') return;
    ensureStyles();

    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }

    const allowFreeText = opts.allowFreeText !== false;
    const freeTextLabel =
      opts.freeTextLabel ??
      (this.locale === 'zh-TW' ? '其他 (按 Enter 送出)' : 'Other (press Enter)');

    const wasVisible = this.el !== null;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.setAttribute(UI_ATTR, 'bar');
      applyPlacement(this.el, 'subtitle');
      document.body.appendChild(this.el);
    }
    if (!wasVisible) this.onVisibilityChange?.(true);

    // Wire the choice's cancel-path into all three negative gestures so
    // the user can dismiss the picker however feels natural:
    //   - `invokeCancel()`  ← Esc gesture from GestureManager
    //   - `invokeReject()`  ← double-tap Space
    //   - `invokeAccept()`  ← single-tap Space when no specific option is
    //                         pinned (treats the bar as informational; a
    //                         showChoice with nothing focused-by-default
    //                         shouldn't auto-pick option 1)
    // We map all three to opts.onCancel so the consumer sees one unified
    // "user dismissed without choosing" event.
    const cancelPath = (): void => {
      const cb = opts.onCancel;
      this.hide();
      cb?.();
    };
    this.currentOpts = {
      text: opts.question,
      type: 'agent',
      onCancel: cancelPath,
      onReject: cancelPath,
    };
    this.el.setAttribute('data-dddk-bar-type', 'agent');
    this.el.setAttribute('data-dddk-bar-mode', 'choice');

    const optionsHtml = opts.options
      .map((label, i) => {
        const safe = escapeHtml(label);
        return `<button ${UI_ATTR}="choice-row" data-dddk-action="choose" data-choice-index="${i}">
          <kbd ${UI_ATTR}="choice-key">${i + 1}</kbd>
          <span ${UI_ATTR}="choice-label">${safe}</span>
        </button>`;
      })
      .join('');

    const freeTextHtml = allowFreeText
      ? `<div ${UI_ATTR}="choice-freetext">
          <input type="text" ${UI_ATTR}="choice-input" placeholder="${escapeHtml(freeTextLabel)}" />
        </div>`
      : '';

    const hintText = this.locale === 'zh-TW'
      ? `按數字鍵選 ｜ 點擊也可以 ｜ esc 取消${allowFreeText ? ' ｜ Other 區可以直接打字' : ''}`
      : `digit to pick · click works too · esc cancels${allowFreeText ? ' · type into Other to free-text' : ''}`;

    this.el.innerHTML = `
      <div ${UI_ATTR}="bar-text">${renderInlineMarkdown(opts.question)}</div>
      <div ${UI_ATTR}="choice-list">${optionsHtml}</div>
      ${freeTextHtml}
      <div ${UI_ATTR}="bar-hints">${hintText}</div>
    `;

    this.wireChoice(opts, allowFreeText);
    document.body.dataset.dddkActive = 'true';

    if (this.ttsProvider) {
      try { this.ttsProvider(opts.question, { locale: this.locale, type: 'agent' }); }
      catch { /* swallow */ }
    }

    // Default OFF — caller must opt-in by passing `autoHide: <ms>`.
    const DEFAULT_AUTO_HIDE = 0;
    const autoHideMs = opts.autoHide ?? DEFAULT_AUTO_HIDE;
    if (autoHideMs > 0) {
      this.autoHideTimer = setTimeout(() => this.hide(), autoHideMs);
    }

    // Click-outside / Esc dismissal — same shape as `installInteractionDismiss`
    // for info subtitles, with two adjustments for the choice picker:
    //   1. Esc fires here too (info subtitles let GestureManager handle it,
    //      but the choice picker has an `onCancel` callback that must fire,
    //      and GestureManager.onEscape doesn't know about it).
    //   2. Keys typed INTO the free-text input never dismiss the picker —
    //      otherwise typing a single letter would close the bar.
    this.installChoiceDismiss(opts);
  }

  private installChoiceDismiss(opts: SubtitleChoiceOptions): void {
    if (this.dismissTeardown) {
      this.dismissTeardown();
      this.dismissTeardown = null;
    }
    const ac = new AbortController();
    setTimeout(() => {
      if (ac.signal.aborted) return;
      const cancelAndHide = (): void => {
        const cb = opts.onCancel;
        this.hide();
        cb?.();
      };
      const onClick = (e: Event): void => {
        const target = e.target as Element | null;
        if (target && this.el && this.el.contains(target)) return;
        cancelAndHide();
      };
      const onKey = (e: KeyboardEvent): void => {
        // IME composition guard. A CJK user composing a candidate fires
        // keydown with `isComposing: true` / `keyCode: 229` for every
        // keystroke including Space and Escape — those belong to the IME
        // (Space commits, Esc cancels the candidate), NOT to this picker.
        if (e.isComposing || (e as KeyboardEvent & { keyCode?: number }).keyCode === 229) return;
        if (['Control', 'Shift', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
        // Space is fully owned by the gesture manager (single tap, double
        // tap, long-press voice, and space-in-input insertion). Bailing
        // here keeps Chinese typing in the free-text input intact and lets
        // double-tap Space land on `invokeReject` → `cancelPath`.
        if (e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space') return;
        // Keys aimed at the inline free-text input must not dismiss —
        // they belong to whatever the user is typing.
        const target = e.target as Element | null;
        if (target && this.el && this.el.contains(target)) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelAndHide();
          return;
        }
        // Digit keys 1-9 are wired into wireChoice for option selection.
        if (/^[1-9]$/.test(e.key)) return;
        cancelAndHide();
      };
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
      this.dismissTeardown = () => {
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey, true);
      };
    }, 120);
    this.dismissTeardown = () => { ac.abort(); };
  }

  hide(): void {
    const wasVisible = this.el !== null;
    if (this.el && this.delegatedHandler) {
      this.el.removeEventListener('click', this.delegatedHandler);
      this.delegatedHandler = null;
    }
    if (this.choiceTeardown) {
      this.choiceTeardown();
      this.choiceTeardown = null;
    }
    if (this.dismissTeardown) {
      this.dismissTeardown();
      this.dismissTeardown = null;
    }
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    this.currentOpts = null;
    delete document.body.dataset.dddkActive;
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
    if (wasVisible) this.onVisibilityChange?.(false);
  }

  isVisible(): boolean {
    return this.el !== null;
  }

  /**
   * Programmatically trigger the current subtitle's accept/reject/cancel
   * callback. Used by the orchestrator's gesture manager — single space
   * tap → `invokeAccept()`, double tap → `invokeReject()`, Esc →
   * `invokeCancel()`. Without these the subtitle bar would only respond
   * to mouse clicks on its buttons.
   *
   * No-ops when no subtitle is currently shown.
   */
  invokeAccept(): boolean {
    const cb = this.currentOpts?.onAccept;
    if (!cb) return false;
    cb();
    return true;
  }
  invokeReject(): boolean {
    const cb = this.currentOpts?.onReject;
    if (!cb) return false;
    cb();
    return true;
  }
  invokeCancel(): boolean {
    const cb = this.currentOpts?.onCancel;
    if (!cb) return false;
    cb();
    return true;
  }

  showIndicator(state: 'listening' | 'processing', label?: string): void {
    ensureStyles();
    if (!this.indicator) {
      this.indicator = document.createElement('div');
      this.indicator.setAttribute(UI_ATTR, 'indicator');
      // Same shared placement system as the subtitle bar — `indicator`
      // slot sits just above the subtitle slot so both can coexist.
      applyPlacement(this.indicator, 'indicator');
      document.body.appendChild(this.indicator);
    }
    this.indicator.setAttribute('data-state', state);
    this.indicator.innerHTML = `
      <div ${UI_ATTR}="indicator-dots">
        <span></span><span></span><span></span>
      </div>
      ${label ? `<div ${UI_ATTR}="indicator-label">${escapeHtml(label)}</div>` : ''}
    `;
  }

  hideIndicator(): void {
    this.indicator?.remove();
    this.indicator = null;
  }

  // ─── private ────────────────────────────────────────────────────

  private renderHints(opts: SubtitleShowOptions): string {
    if (opts.hints) return `<div ${UI_ATTR}="bar-hints">${escapeHtml(opts.hints)}</div>`;

    // Bundled defaults: SDK ships `en` + `zh-TW` strings. Any other locale
    // (`ja`, `es`, `fr`, …) falls back to `en` so the UI never breaks.
    // Hosts that want a native translation pass it through the `hints`
    // option on `Subtitle.show()` or via the `i18n` config on DotDotDuck.
    const defaults: Record<string, Record<SubtitleShowOptions['type'], string>> = {
      'zh-TW': {
        voice: 'Tab 一行 ｜ space 同意 ｜ 雙擊 space 拒絕',
        selection: 'space 接受 ｜ 雙擊 space 拒絕',
        agent: 'space 繼續 ｜ 雙擊 space 結束 ｜ esc 取消',
        post: 'space 接受 ｜ 雙擊 space 拒絕',
        info: '',
      },
      en: {
        voice: 'Tab line · space accept · double-tap reject',
        selection: 'space accept · double-tap reject',
        agent: 'space continue · double-tap exit · esc cancel',
        post: 'space accept · double-tap reject',
        info: '',
      },
    };
    const dict = defaults[this.locale] ?? defaults.en!;
    const text = dict[opts.type];
    return text ? `<div ${UI_ATTR}="bar-hints">${text}</div>` : '';
  }

  private renderButtons(opts: SubtitleShowOptions): string {
    if (opts.type === 'info') return '';
    const showCopy = opts.onCopy !== undefined;
    // Monochrome glyphs only — see user UI memo. Avoid emoji like 📋.
    return `
      <div ${UI_ATTR}="bar-buttons">
        ${showCopy ? `<button data-dddk-action="copy" aria-label="Copy">⎘</button>` : ''}
        ${opts.onAccept ? `<button data-dddk-action="accept" aria-label="Accept">✓</button>` : ''}
        ${opts.onReject ? `<button data-dddk-action="reject" aria-label="Reject">✕</button>` : ''}
      </div>
    `;
  }

  /**
   * Single delegated listener (vs three direct addEventListeners). Cheaper
   * to install per show() and means we never accumulate dangling listeners
   * if innerHTML is replaced mid-life by update() variants.
   */
  private wireButtons(opts: SubtitleShowOptions): void {
    if (!this.el) return;
    if (this.delegatedHandler) {
      this.el.removeEventListener('click', this.delegatedHandler);
      this.delegatedHandler = null;
    }
    const handler = (e: Event) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>(
        'button[data-dddk-action]'
      );
      if (!btn) return;
      const action = btn.dataset.dddkAction;
      if (action === 'accept') opts.onAccept?.();
      else if (action === 'reject') opts.onReject?.();
      else if (action === 'copy') opts.onCopy?.();
    };
    this.el.addEventListener('click', handler);
    this.delegatedHandler = handler;
  }

  /**
   * Wire keyboard + click for the multi-choice bar.
   *  - 1..N digit keys pick the corresponding option and call onChoose.
   *  - Click on any `[data-dddk-action="choose"]` row picks that option.
   *  - When free-text is allowed, Enter inside the input submits the
   *    typed value with `index === -1`.
   *
   * The keyboard listener is installed on `document` (capture phase) so
   * digit keys are caught even when focus is elsewhere. We remove it on
   * `hide()` via the existing delegatedHandler cleanup path.
   */
  private wireChoice(opts: SubtitleChoiceOptions, allowFreeText: boolean): void {
    if (!this.el) return;
    // Wipe any previous handlers (single-line show() may have run before).
    if (this.delegatedHandler) {
      this.el.removeEventListener('click', this.delegatedHandler);
      this.delegatedHandler = null;
    }
    if (this.choiceTeardown) {
      this.choiceTeardown();
      this.choiceTeardown = null;
    }

    const input = allowFreeText
      ? this.el.querySelector<HTMLInputElement>(`[${UI_ATTR}="choice-input"]`)
      : null;

    let resolved = false;
    const resolve = (value: string, index: number): void => {
      if (resolved) return;
      resolved = true;
      // hide() runs the teardown, then we deliver the answer. Doing it
      // in this order lets the consumer reopen a new choice bar inside
      // onChoose without racing our listeners.
      this.hide();
      opts.onChoose(value, index);
    };

    const onClick = (e: Event): void => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>(
        'button[data-dddk-action="choose"]'
      );
      if (!btn) return;
      const idx = Number(btn.dataset.choiceIndex);
      if (Number.isNaN(idx)) return;
      resolve(opts.options[idx] ?? '', idx);
    };

    const onKey = (e: KeyboardEvent): void => {
      // IME composition guard — every keystroke during CJK composition
      // (including Enter and digit keys) belongs to the IME, not to this
      // picker. Bail so the user can pick a candidate without resolving.
      if (e.isComposing || (e as KeyboardEvent & { keyCode?: number }).keyCode === 229) return;
      // Don't hijack digits typed into the free-text input.
      if (e.target === input) {
        if (e.key === 'Enter' && input) {
          e.preventDefault();
          const v = input.value.trim();
          if (v) resolve(v, -1);
        }
        return;
      }
      // If focus is on ANY other interactive surface (the palette input,
      // a textarea, a contenteditable, etc.) — don't hijack the digit.
      // Otherwise a user who opens the palette while the choice bar is
      // up would have their first "1" / "2" stolen.
      const active = document.activeElement;
      if (active && active !== document.body) {
        const tag = active.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if ((active as HTMLElement).isContentEditable) return;
      }
      if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (idx < opts.options.length) {
          e.preventDefault();
          resolve(opts.options[idx] ?? '', idx);
        }
      }
    };

    this.el.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey, true);

    // hide() reads `delegatedHandler` to detach the click listener, and
    // calls `choiceTeardown` to detach anything else (the document-level
    // keydown). Both run on every hide path — Esc gesture, programmatic
    // hide, or a resolve() above.
    this.delegatedHandler = onClick;
    this.choiceTeardown = () => {
      document.removeEventListener('keydown', onKey, true);
    };
  }
}

// ─── inline markdown ─────────────────────────────────────────────
//
// Minimal markdown renderer for subtitle text. Supports:
//   - `**bold**` / `__bold__`        → <strong>
//   - `*italic*` / `_italic_`         → <em>
//   - `` `code` ``                    → <code>
//   - line breaks (`\n`)              → <br>
//   - `- item` / `* item` lists      → <ul><li>
//   - `1. item` ordered lists         → <ol><li>
//   - http(s)://… auto-link           → <a target="_blank">
//
// LLMs love to emit `**emphasis**` and bullet lists by default, so the
// subtitle bar needs to render them properly. We do NOT pull marked.js —
// the subtitle module already stays under 30KB and we want to keep it
// that way. All other markdown (headings, blockquotes, tables, images)
// is silently passed through as text — subtitles shouldn't carry those.
//
// Order of operations matters: we escape FIRST, then run pattern
// substitutions on the escaped string. That way user-supplied `<script>`
// can't sneak in via the markdown patterns.
function renderInlineMarkdown(raw: string): string {
  let html = escapeHtml(raw);

  // List blocks — process before inline because list markers anchor at
  // the start of a line. Group consecutive `- ` / `* ` lines into <ul>,
  // `1. ` lines into <ol>.
  html = html.replace(
    /(?:^|\n)((?:[-*]\s.+\n?)+)/g,
    (_match, group: string) => {
      const items = group
        .trim()
        .split('\n')
        .map((line) => line.replace(/^[-*]\s+/, ''))
        .map((item) => `<li>${item.trim()}</li>`)
        .join('');
      return `\n<ul>${items}</ul>`;
    },
  );
  html = html.replace(
    /(?:^|\n)((?:\d+\.\s.+\n?)+)/g,
    (_match, group: string) => {
      const items = group
        .trim()
        .split('\n')
        .map((line) => line.replace(/^\d+\.\s+/, ''))
        .map((item) => `<li>${item.trim()}</li>`)
        .join('');
      return `\n<ol>${items}</ol>`;
    },
  );

  // Inline code first — its content shouldn't be re-processed for bold/italic.
  // Use a placeholder shuffle so subsequent regexes skip code spans.
  const codeSpans: string[] = [];
  html = html.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codeSpans.push(code);
    return `\x00CODE${codeSpans.length - 1}\x00`;
  });

  // Bold and italic. **bold** / __bold__ before *italic* / _italic_ so
  // the doubled markers don't get half-matched.
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '<em>$1</em>');
  html = html.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '<em>$1</em>');

  // Auto-link bare URLs. Strict pattern to avoid eating trailing punctuation.
  html = html.replace(
    /(https?:\/\/[^\s<]+[^\s<.,!?])/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  // Restore code spans.
  html = html.replace(/\x00CODE(\d+)\x00/g, (_m, idx: string) => {
    return `<code>${codeSpans[Number(idx)] ?? ''}</code>`;
  });

  // Line breaks (after lists, so list \n's are already consumed).
  html = html.replace(/\n/g, '<br>');

  return html;
}

// ─── styles ─────────────────────────────────────────────────────────

function ensureStyles(): void {
  injectScopedStyle(STYLE_ID, `
    /* Positioning (fixed / center-bottom / z-index / max-width) lives in
     * placement.ts — the rules below only style the bar's chrome
     * (background / radius / padding / blur).
     *
     * Theming: prefer host-bridged tokens (--dddk-bg-elevated / --dddk-text
     * / --dddk-border) so a host that defines a dark theme via those
     * tokens gets a properly-themed bar automatically — no separate
     * --dddk-bar-bg override needed, no "white-on-black inverted" look.
     * The hard-coded fallback at the end of each chain is only for hosts
     * that haven't bridged anything yet. */
    [${UI_ATTR}="bar"] {
      background: var(--dddk-bar-bg, var(--dddk-bg-elevated, rgba(255, 255, 255, 0.96)));
      color: var(--dddk-bar-text, var(--dddk-text, #1a1a1a));
      border: 1px solid var(--dddk-bar-border, var(--dddk-border, rgba(0, 0, 0, 0.06)));
      border-radius: var(--dddk-bar-radius, 12px);
      box-shadow: var(--dddk-bar-shadow, 0 8px 32px rgba(0, 0, 0, 0.18));
      padding: var(--dddk-bar-padding, 12px 16px);
      font-family: var(--dddk-bar-font, var(--dddk-font, system-ui, sans-serif));
      font-size: var(--dddk-font-size-md, 14px);
      display: flex; flex-direction: column; gap: 6px;
      backdrop-filter: blur(var(--dddk-blur, 12px));
      -webkit-backdrop-filter: blur(var(--dddk-blur, 12px));
    }
    [${UI_ATTR}="bar-hints"] {
      color: var(--dddk-bar-hints, var(--dddk-text-muted, #6b6b6b));
    }
    [${UI_ATTR}="bar-text"] { line-height: var(--dddk-line-height, 1.5); }
    /* Markdown rendering inside subtitle text — LLMs emit **bold** and
       bullet lists by default, so the bar needs to render them properly. */
    [${UI_ATTR}="bar-text"] strong { font-weight: 700; }
    [${UI_ATTR}="bar-text"] em { font-style: italic; }
    [${UI_ATTR}="bar-text"] code {
      font-family: var(--dddk-mono, ui-monospace, "SF Mono", Menlo, monospace);
      font-size: 0.92em;
      padding: 1px 5px;
      background: var(--dddk-row-hover, rgba(0,0,0,0.06));
      border-radius: 4px;
    }
    [${UI_ATTR}="bar-text"] ul,
    [${UI_ATTR}="bar-text"] ol {
      margin: 6px 0 6px 0;
      padding-left: 20px;
    }
    [${UI_ATTR}="bar-text"] li { margin: 2px 0; }
    [${UI_ATTR}="bar-text"] a {
      color: var(--dddk-accent, #6366f1);
      text-decoration: underline;
    }
    [${UI_ATTR}="bar-hints"] {
      font-size: var(--dddk-font-size-sm, 12px);
    }
    [${UI_ATTR}="bar-buttons"] {
      display: flex; gap: 8px; justify-content: flex-end;
      margin-top: 4px;
    }
    [${UI_ATTR}="bar-buttons"] button {
      border: 0;
      /* Tap target — 44x44 minimum on mobile per WCAG. Desktop reads the
         same comfortable size; no harm having a 44px button up there. */
      min-width: 44px; min-height: 36px;
      padding: 6px 16px;
      border-radius: var(--dddk-radius-sm, 6px);
      background: var(--dddk-accent, #ec4899);
      color: var(--dddk-text-on-accent, #fff);
      cursor: pointer;
      font-size: var(--dddk-font-size-md, 14px);
      font-weight: 600;
      display: inline-flex; align-items: center; justify-content: center; gap: 4px;
      -webkit-tap-highlight-color: transparent;
      transition: background 0.1s, transform 0.08s;
    }
    [${UI_ATTR}="bar-buttons"] button:hover {
      background: var(--dddk-accent-hover, #db2777);
    }
    [${UI_ATTR}="bar-buttons"] button:active {
      transform: scale(0.96);
    }
    /* Reject button gets a softer treatment so accept reads as primary. */
    [${UI_ATTR}="bar-buttons"] button[data-dddk-action="reject"] {
      background: transparent;
      color: var(--dddk-text-muted, #6b6b6b);
      border: 1px solid var(--dddk-border, rgba(0,0,0,0.15));
    }
    [${UI_ATTR}="bar-buttons"] button[data-dddk-action="reject"]:hover {
      background: var(--dddk-row-hover, rgba(0,0,0,0.04));
      color: var(--dddk-text, #1a1a1a);
    }
    /* ── multi-choice mode ─────────────────────────────────────────
       Triggered by Subtitle.showChoice(); the bar gets
       [data-dddk-bar-mode="choice"]. Layout:
         question (bar-text — reuses single-line styles)
         ↓ choice-list with N rows
         ↓ optional free-text input
         ↓ hint line (reuses bar-hints) */
    [${UI_ATTR}="choice-list"] {
      display: flex; flex-direction: column; gap: 4px;
      margin: 4px 0 2px;
    }
    [${UI_ATTR}="choice-row"] {
      display: flex; align-items: center; gap: 10px;
      width: 100%;
      padding: 7px 10px;
      border: 1px solid transparent;
      border-radius: var(--dddk-radius-sm, 6px);
      background: var(--dddk-row-bg, transparent);
      color: inherit;
      font: inherit;
      cursor: pointer;
      text-align: left;
    }
    [${UI_ATTR}="choice-row"]:hover,
    [${UI_ATTR}="choice-row"]:focus-visible {
      background: var(--dddk-row-hover, rgba(0,0,0,0.05));
      border-color: var(--dddk-border-subtle, rgba(0,0,0,0.08));
      outline: none;
    }
    [${UI_ATTR}="choice-key"] {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 22px; height: 20px;
      padding: 0 6px;
      border-radius: 4px;
      background: var(--dddk-kbd-bg, rgba(0,0,0,0.06));
      color: var(--dddk-text-muted, #6b6b6b);
      font-size: 11px;
      font-family: var(--dddk-mono, ui-monospace, monospace);
      font-weight: 600;
    }
    [${UI_ATTR}="choice-label"] { font-size: var(--dddk-font-size-md, 14px); }
    [${UI_ATTR}="choice-freetext"] { margin-top: 4px; }
    [${UI_ATTR}="choice-input"] {
      width: 100%;
      padding: 7px 10px;
      border: 1px solid var(--dddk-border, rgba(0,0,0,0.12));
      border-radius: var(--dddk-radius-sm, 6px);
      background: var(--dddk-input-bg, transparent);
      color: inherit;
      font: inherit;
    }
    [${UI_ATTR}="choice-input"]:focus {
      outline: none;
      border-color: var(--dddk-accent, #ec4899);
    }
    /* Listening / processing indicator chrome. Positioning comes from
       placement.ts; below is only the visual styling.

       Background is the ACCENT colour (not bg-elevated) so the indicator
       is clearly visible on any theme — dark sites kept getting an
       invisible "black on black" indicator with the previous bg-elevated
       fallback. Text + dots are on-accent for high contrast.

       The "listening" state also gets a pulsing ring (box-shadow keyframe)
       to make it OBVIOUS that the mic is hot. The previous version had
       only the bouncing dots, which was easy to miss. */
    [${UI_ATTR}="indicator"] {
      background: var(--dddk-accent, #6366f1);
      color: var(--dddk-text-on-accent, #fff);
      border-radius: var(--dddk-radius-pill, 999px);
      padding: 10px 20px;
      box-shadow: var(--dddk-shadow-md, 0 6px 20px rgba(0,0,0,0.25));
      display: flex; align-items: center; gap: 10px;
      font-size: var(--dddk-font-size-md, 14px);
      font-weight: 600;
      border: 1px solid rgba(255,255,255,0.15);
    }
    [${UI_ATTR}="indicator"][data-state="listening"] {
      animation: dddk-indicator-pulse 1.4s ease-in-out infinite;
    }
    [${UI_ATTR}="indicator-dots"] {
      display: inline-flex; gap: 4px;
    }
    [${UI_ATTR}="indicator-dots"] span {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--dddk-text-on-accent, #fff);
      animation: dddk-dot-bounce 1.2s infinite ease-in-out;
    }
    [${UI_ATTR}="indicator-dots"] span:nth-child(2) { animation-delay: 0.15s; }
    [${UI_ATTR}="indicator-dots"] span:nth-child(3) { animation-delay: 0.3s; }
    [${UI_ATTR}="indicator-label"] { letter-spacing: 0.02em; }
    @keyframes dddk-dot-bounce {
      0%, 80%, 100% { transform: scale(0.7); opacity: 0.55; }
      40% { transform: scale(1); opacity: 1; }
    }
    @keyframes dddk-indicator-pulse {
      0%, 100% {
        box-shadow:
          var(--dddk-shadow-md, 0 6px 20px rgba(0,0,0,0.25)),
          0 0 0 0 rgba(99, 102, 241, 0.55);
      }
      50% {
        box-shadow:
          var(--dddk-shadow-md, 0 6px 20px rgba(0,0,0,0.25)),
          0 0 0 12px rgba(99, 102, 241, 0);
      }
    }
  `);
}

