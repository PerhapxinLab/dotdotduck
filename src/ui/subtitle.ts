/**
 * Subtitle bar — DOM-rendered, CSS-variable themed.
 * See ../../docs/07-subtitle-ui.md for the full design.
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
  /** Indicator request that was suppressed because a subtitle was
   *  visible. Materialises when the subtitle hides — that way an
   *  agent loop's 'thinking' indicator gets queued behind the current
   *  subtitle instead of stacking on top of it. */
  private pendingIndicator: { state: 'listening' | 'processing' | 'done'; label?: string } | null = null;

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

  /**
   * Wire a host-supplied handler for the bar's × close button (and
   * any equivalent "user dismissed without committing" gestures). The
   * orchestrator typically wires this to stop the agent loop + surface
   * a brief "stopped — say something new" feedback subtitle.
   */
  setCloseHandler(fn: (() => void) | null): void {
    this.closeHandler = fn;
  }

  /** Multi-page state for a single `show()` call. When the caller's text
   *  exceeds maxCharsPerPage we paginate; Space advances. The final
   *  page's accept callback fires the original onAccept. */
  private pages: string[] | null = null;
  private pageIdx = 0;
  /** Host-supplied "user explicitly closed the bar" handler (typically
   *  wired to stop the agent + show a brief stopped-feedback subtitle). */
  private closeHandler: (() => void) | null = null;

  // ─── streaming mode state ───────────────────────────────────────
  /** Live text node the streaming appendStreamed() writes into. */
  private streamingTextNode: Text | null = null;
  /** Cursor element shown after the live text node (blinking caret). */
  private streamingCursor: HTMLSpanElement | null = null;
  /** Untranscribed text held back for sentence-boundary TTS. */
  private streamingTtsBuffer = '';
  /** Raw accumulated streaming text (for replaceStreamed / introspection). */
  private streamingFullText = '';
  /** Active "pause hint" callbacks — set by applyStreamingPauseHint
   *  when the agent pauses mid-stream. Space invokeAccept fires
   *  accept (advances the agent), double-tap fires reject (stops it).
   *  Both clear the hint and the callbacks. */
  private streamingPauseAccept: (() => void) | null = null;
  private streamingPauseReject: (() => void) | null = null;

  show(opts: SubtitleShowOptions): void {
    if (typeof document === 'undefined') return;
    ensureStyles();

    // Subtitle and indicator are mutually exclusive — the indicator
    // is a "loading dots" pip that should NOT cover an actionable
    // subtitle bar. If an indicator is currently visible, tuck it
    // away (it'll re-materialise when this subtitle hides).
    if (this.indicator) {
      // Remember what the indicator was showing so we can restore it.
      const state = (this.indicator.getAttribute('data-state') as 'listening' | 'processing' | 'done') ?? 'processing';
      const labelEl = this.indicator.querySelector<HTMLElement>(`[${UI_ATTR}="indicator-label"]`);
      this.pendingIndicator = { state, label: labelEl?.textContent ?? undefined };
      this.indicator.remove();
      this.indicator = null;
    }

    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }

    // Transitioning OUT of streaming mode → wipe the streaming-specific
    // state so the new bar isn't misclassified as a still-streaming
    // bar by `isStreaming()` / `invokeAccept()`. Without this, when a
    // confirm subtitle replaces a streaming bar, Space-accept on the
    // confirm gets misrouted as "stop the streaming agent".
    this.streamingTextNode = null;
    this.streamingCursor = null;
    this.streamingFullText = '';
    this.streamingTtsBuffer = '';

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
      this.bindTouchTapGestures(this.el);
    } else {
      // Reusing the existing el for a different mode — clear the
      // bar-mode attribute so CSS selectors targeting streaming /
      // streaming-done don't keep applying.
      this.el.removeAttribute('data-dddk-bar-mode');
    }
    if (!wasVisible) this.onVisibilityChange?.(true);

    // Paginate long content. Translations / rewrites / summaries can
    // return prose that doesn't fit comfortably in three lines; rather
    // than render a tiny scrollable bar (loses Space-tap context) we
    // split on sentence boundaries and let the user advance with Space.
    const maxPerPage = opts.maxCharsPerPage ?? 220;
    if (maxPerPage > 0 && opts.text.length > maxPerPage) {
      this.pages = splitIntoPages(opts.text, maxPerPage);
      this.pageIdx = 0;
    } else {
      this.pages = null;
      this.pageIdx = 0;
    }

    this.currentOpts = opts;
    this.renderCurrentPage();
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
        // Click-outside is treated as an explicit user dismissal —
        // same semantics as the × button. Route through handleCloseClick
        // so the host's closeHandler (stop the agent loop + clear any
        // running indicator) fires alongside the hide.
        this.handleCloseClick();
      };
      const onKey = (e: KeyboardEvent): void => {
        // Skip pure modifier presses — preparing for a shortcut isn't dismissal.
        if (['Control', 'Shift', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
        // Skip Space / Escape — those route through the GestureManager
        // first (onAccept / onReject / onEscape) and would double-fire
        // here. The gesture manager calls hide() itself when needed.
        if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Escape') return;
        // Paged / action subtitles must NOT dismiss on arbitrary key
        // presses — that would close a multi-page translation in the
        // middle when the user touched any key. Only pure info
        // subtitles (no paging, no accept/reject) auto-dismiss on
        // any-key.
        const isPaged = this.pages !== null && this.pages.length > 1;
        const hasAction = !!(this.currentOpts?.onAccept || this.currentOpts?.onReject);
        if (isPaged || hasAction) return;
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

  // ─── streaming mode ────────────────────────────────────────────────
  //
  // Used by the agent loop: the LLM streams text between tool calls;
  // each delta is appended to a live Text node so the bar "types itself".
  // The bar persists across SPA navigation (it sits on document.body, the
  // same as the rest of subtitle UI), so a continuous narrative reads
  // across page changes without flicker.

  /**
   * Append a text delta to the streaming bar. First call materialises
   * the bar in streaming mode. Sentence-boundary TTS is buffered and
   * flushed automatically — see `flushStreamingTts`.
   */
  appendStreamed(delta: string): void {
    if (typeof document === 'undefined' || !delta) return;
    this.ensureStreamingBar();
    // Subtitle bar renders prose, not docs — the SDK system prompt
    // asks the LLM to skip markdown, but smaller models still slip
    // `**bold**` in for emphasis. Strip the markers as a guard so the
    // bar doesn't read with raw asterisks. A `*` split across two
    // deltas can occasionally leak; that's a fair tradeoff for the
    // simple code path.
    const cleaned = delta.replace(/\*\*/g, '');
    if (this.streamingTextNode) {
      this.streamingTextNode.appendData(cleaned);
      this.streamingFullText += cleaned;
      this.autoScrollStream();
    }
    this.streamingTtsBuffer += cleaned;
    this.flushStreamingTts(false);
  }

  /**
   * Wipe the streaming bar's current text and replace with `text`.
   * Use when the host wants a "明確一步一步" refresh between agent
   * steps. Passing an empty string clears the bar but keeps it visible.
   */
  replaceStreamed(text: string): void {
    if (typeof document === 'undefined') return;
    // Flush whatever's in the TTS buffer so the previous paragraph
    // doesn't drop a fragment when we wipe.
    this.flushStreamingTts(true);
    this.ensureStreamingBar();
    if (this.streamingTextNode) {
      this.streamingTextNode.data = text;
      this.streamingFullText = text;
    }
    this.streamingTtsBuffer = text;
    this.flushStreamingTts(false);
  }

  /**
   * Mark the streaming bar as "settled" — remove the typing cursor and
   * apply standard dismiss + autoHide. After this the bar behaves like
   * any other `show()` info subtitle (any-key / click dismiss).
   */
  finalizeStreamed(opts?: { autoHide?: number }): void {
    // Flush any tail text the model left in the buffer before going silent.
    this.flushStreamingTts(true);
    if (!this.el) return;
    this.el.setAttribute('data-dddk-bar-mode', 'streaming-done');
    if (this.streamingCursor) {
      this.streamingCursor.remove();
      this.streamingCursor = null;
    }
    // Append a faint "press space to close" hint so the user has a
    // discoverable dismiss gesture (in addition to the × button).
    const scroll = this.el.querySelector<HTMLDivElement>(`[${UI_ATTR}="bar-scroll"]`);
    if (scroll && !scroll.querySelector(`[${UI_ATTR}="bar-hints"]`)) {
      const hintText = this.locale === 'zh-TW' ? '按 space 關閉' : 'press space to close';
      const hintEl = document.createElement('div');
      hintEl.setAttribute(UI_ATTR, 'bar-hints');
      hintEl.textContent = hintText;
      scroll.appendChild(hintEl);
    }
    // Install any-key / click-outside dismiss for the now-static text.
    const dismissOpts: SubtitleShowOptions = {
      text: this.streamingFullText,
      type: 'agent',
    };
    this.currentOpts = dismissOpts;
    this.installInteractionDismiss(dismissOpts);
    const autoHideMs = opts?.autoHide;
    if (typeof autoHideMs === 'number' && autoHideMs > 0) {
      if (this.autoHideTimer) clearTimeout(this.autoHideTimer);
      this.autoHideTimer = setTimeout(() => this.hide(), autoHideMs);
    }
  }

  /**
   * Tear down the streaming bar immediately. Used when the agent run
   * stops mid-stream (cancel / error). Distinct from `hide()` only in
   * that it always resets streaming state — `hide()` is the universal
   * "bar gone" used by every mode.
   */
  clearStreamed(): void {
    this.flushStreamingTts(true);
    this.streamingTextNode = null;
    this.streamingCursor = null;
    this.streamingFullText = '';
    this.streamingTtsBuffer = '';
    this.hide();
  }

  isStreaming(): boolean {
    return this.streamingTextNode !== null && this.el?.getAttribute('data-dddk-bar-mode') === 'streaming';
  }

  /**
   * Attach a "press space to continue" pause UI to the active
   * streaming bar — without replacing the bar or wiping the text the
   * agent just streamed. The hint sits BELOW the streamed text so the
   * user can finish reading before deciding.
   *
   * Wiring:
   *   - Space tap (invokeAccept) → fires opts.onAccept, clears hint.
   *   - Double-tap Space (invokeReject) → fires opts.onReject, clears
   *     hint. Host typically stops the agent on reject.
   *   - × button → behaves like double-tap (fires reject + close).
   */
  applyStreamingPauseHint(opts: {
    hint: string;
    rejectHint?: string;
    onAccept: () => void;
    onReject: () => void;
  }): void {
    if (!this.el) return;
    // Remove any prior hint (in case pause fires twice without clearing).
    this.clearStreamingPauseHint();

    // Stop the blinking cursor — the agent has paused, not "still typing".
    if (this.streamingCursor) {
      this.streamingCursor.style.opacity = '0.35';
      this.streamingCursor.style.animation = 'none';
    }

    const scroll = this.el.querySelector<HTMLDivElement>(`[${UI_ATTR}="bar-scroll"]`);
    if (!scroll) return;
    const hintEl = document.createElement('div');
    hintEl.setAttribute(UI_ATTR, 'streaming-pause');
    hintEl.innerHTML = `
      <div ${UI_ATTR}="streaming-pause-text">${escapeHtml(opts.hint)}</div>
      <div ${UI_ATTR}="streaming-pause-hints">${escapeHtml(opts.rejectHint ?? this.defaultPauseRejectHint())}</div>
    `;
    scroll.appendChild(hintEl);
    // Auto-scroll so the hint is visible.
    this.autoScrollStream();

    this.streamingPauseAccept = opts.onAccept;
    this.streamingPauseReject = opts.onReject;
  }

  /**
   * Tear down the pause hint and restore the cursor. Called on accept
   * (the agent will continue with new deltas) and on reject. Safe to
   * call when no hint is active.
   */
  clearStreamingPauseHint(): void {
    if (!this.el) return;
    const hintEl = this.el.querySelector(`[${UI_ATTR}="streaming-pause"]`);
    if (hintEl) hintEl.remove();
    this.streamingPauseAccept = null;
    this.streamingPauseReject = null;
    if (this.streamingCursor) {
      this.streamingCursor.style.opacity = '';
      this.streamingCursor.style.animation = '';
    }
  }

  private defaultPauseRejectHint(): string {
    if (isTouchOnlyDevice()) {
      return this.locale === 'zh-TW'
        ? '點一下繼續 ｜ 雙擊結束'
        : 'tap to continue · double-tap to exit';
    }
    return this.locale === 'zh-TW'
      ? 'space 繼續 ｜ 雙擊 space 結束'
      : 'space continue · double-tap to exit';
  }

  /** Keep the scrollable inner pinned to the bottom as new text streams
   *  in — but only if the user hasn't scrolled up to re-read. If they
   *  scrolled up, leave them there. */
  private autoScrollStream(): void {
    if (!this.el) return;
    const scroll = this.el.querySelector<HTMLDivElement>(`[${UI_ATTR}="bar-scroll"]`);
    if (!scroll) return;
    const distFromBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
    if (distFromBottom < 80) {
      scroll.scrollTop = scroll.scrollHeight;
    }
  }

  private ensureStreamingBar(): void {
    // Already streaming → reuse.
    if (this.streamingTextNode && this.el?.getAttribute('data-dddk-bar-mode') === 'streaming') return;

    ensureStyles();

    // Tear down any existing non-streaming bar first.
    if (this.indicator) {
      this.indicator.remove();
      this.indicator = null;
      this.pendingIndicator = null;
    }
    if (this.dismissTeardown) {
      this.dismissTeardown();
      this.dismissTeardown = null;
    }
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }

    const wasVisible = this.el !== null;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.setAttribute(UI_ATTR, 'bar');
      applyPlacement(this.el, 'subtitle');
      document.body.appendChild(this.el);
      this.bindTouchTapGestures(this.el);
    }
    this.el.setAttribute('data-dddk-bar-type', 'agent');
    this.el.setAttribute('data-dddk-bar-mode', 'streaming');

    // Build the streaming layout — wrapped in the standard bar shell so
    // the × close button and max-height scroll behave identically to
    // every other bar mode.
    this.el.innerHTML = this.wrapBarShell(`<div ${UI_ATTR}="bar-text"></div>`);
    this.wireClose();

    const textWrap = this.el.querySelector<HTMLDivElement>(`[${UI_ATTR}="bar-text"]`);
    if (!textWrap) return;
    const textNode = document.createTextNode('');
    const cursor = document.createElement('span');
    cursor.setAttribute(UI_ATTR, 'streaming-cursor');
    cursor.textContent = '▍';
    textWrap.appendChild(textNode);
    textWrap.appendChild(cursor);

    this.streamingTextNode = textNode;
    this.streamingCursor = cursor;
    this.streamingFullText = '';
    this.streamingTtsBuffer = '';
    this.currentOpts = null;
    document.body.dataset.dddkActive = 'true';
    if (!wasVisible) this.onVisibilityChange?.(true);
  }

  /**
   * Send buffered streaming text through TTS at sentence boundaries.
   * `force = true` flushes whatever's left regardless of punctuation
   * (used on finalize / replace).
   *
   * Sentence-end characters covered: `。 . ！ ! ？ ? \n`. To avoid
   * choppy mid-clause reads, we also require either a sentence-end OR
   * buffer length ≥ 80 characters before flushing in non-forced mode.
   */
  private flushStreamingTts(force: boolean): void {
    if (!this.ttsProvider) {
      // No TTS wired — keep the buffer trimmed so it doesn't grow forever.
      this.streamingTtsBuffer = '';
      return;
    }
    const buf = this.streamingTtsBuffer;
    if (!buf) return;

    if (force) {
      try { this.ttsProvider(buf, { locale: this.locale, type: 'agent' }); } catch { /* swallow */ }
      this.streamingTtsBuffer = '';
      return;
    }

    // Find the LAST sentence-end punctuation in the buffer. Everything up
    // to (and including) that point is one or more complete sentences;
    // anything after stays buffered until the next delta brings more.
    const SENTENCE_END = /[。．.！!？?\n]/g;
    let lastIdx = -1;
    let m: RegExpExecArray | null;
    while ((m = SENTENCE_END.exec(buf)) !== null) lastIdx = m.index;
    if (lastIdx < 0) {
      if (buf.length < 80) return;
      // No punctuation but buffer is long enough — flush at the closest
      // whitespace (less likely to break a word) or just flush the whole
      // thing.
      const ws = buf.lastIndexOf(' ');
      const cut = ws > 30 ? ws + 1 : buf.length;
      const head = buf.slice(0, cut);
      this.streamingTtsBuffer = buf.slice(cut);
      try { this.ttsProvider(head, { locale: this.locale, type: 'agent' }); } catch { /* swallow */ }
      return;
    }
    const head = buf.slice(0, lastIdx + 1);
    this.streamingTtsBuffer = buf.slice(lastIdx + 1);
    try { this.ttsProvider(head, { locale: this.locale, type: 'agent' }); } catch { /* swallow */ }
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
      this.bindTouchTapGestures(this.el);
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

    this.el.innerHTML = this.wrapBarShell(`
      <div ${UI_ATTR}="bar-text">${renderInlineMarkdown(opts.question)}</div>
      <div ${UI_ATTR}="choice-list">${optionsHtml}</div>
      ${freeTextHtml}
      <div ${UI_ATTR}="bar-hints">${hintText}</div>
    `);

    this.wireChoice(opts, allowFreeText);
    this.wireClose();
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
        // Treat outside-dismiss as user cancel — also stop the agent
        // loop + clear any thinking indicator that was up. Same path
        // as the × button on regular subtitles.
        this.closeHandler?.();
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
    // Streaming state is owned by the bar el — when it goes, reset.
    this.streamingTextNode = null;
    this.streamingCursor = null;
    this.streamingFullText = '';
    this.streamingTtsBuffer = '';
    delete document.body.dataset.dddkActive;
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
    if (wasVisible) this.onVisibilityChange?.(false);
    // Subtitle is gone — if an indicator was queued behind it (e.g.
    // agent loop fired 'thinking' while a subtitle was up), surface
    // it now. This makes the indicator and subtitle behave like two
    // priority slots: subtitle wins while visible, indicator takes
    // over the moment the subtitle goes away.
    if (this.pendingIndicator) {
      const p = this.pendingIndicator;
      this.pendingIndicator = null;
      this.showIndicator(p.state, p.label);
    }
  }

  isVisible(): boolean {
    return this.el !== null;
  }

  /**
   * Touch-only tap routing on the subtitle bar itself — single tap calls
   * `invokeAccept()` and double tap calls `invokeReject()`, so phone /
   * tablet users without a physical Space key can advance the streaming
   * pause, accept a confirm gate, etc. by tapping the bar.
   *
   * Mouse clicks pass through unchanged (single-tap-to-accept on a
   * desktop bar would be a footgun — users misclick). We feature-detect
   * `pointerType === 'touch'` rather than viewport size so a laptop in
   * tablet mode also gets the gesture.
   *
   * Taps on the embedded × button bubble up to here too — we ignore
   * them by checking the event target's role.
   */
  private bindTouchTapGestures(el: HTMLElement): void {
    let lastTapAt = 0;
    let singleTapTimer: ReturnType<typeof setTimeout> | null = null;
    const doubleTapMs = 320;
    el.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') return;
      // Ignore taps on interactive children (× close, choice rows,
      // free-text input, etc.) — they handle themselves.
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, input, textarea, a, [role="button"]')) return;
      const now = Date.now();
      if (now - lastTapAt < doubleTapMs) {
        // Double tap → reject (or close)
        if (singleTapTimer !== null) {
          clearTimeout(singleTapTimer);
          singleTapTimer = null;
        }
        lastTapAt = 0;
        // Dispatch a DOM custom event so the orchestrator runs the
        // full gesture pipeline (emit `gesture_reject`, exit script
        // skills, log intent) — NOT just subtitle.invokeReject() in
        // isolation, which would miss the gesture event listeners.
        document.dispatchEvent(new CustomEvent('dddk:bar-tap-reject'));
        return;
      }
      lastTapAt = now;
      singleTapTimer = setTimeout(() => {
        singleTapTimer = null;
        document.dispatchEvent(new CustomEvent('dddk:bar-tap-accept'));
      }, doubleTapMs);
    });
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
    // Paged subtitle: Space advances to the next page until we run out.
    if (this.pages && this.pageIdx < this.pages.length - 1) {
      this.pageIdx += 1;
      this.renderCurrentPage();
      return true;
    }
    // Streaming bar with an active pause hint — Space ADVANCES the
    // agent past the pause (does NOT stop it). The hint clears, the
    // streamed text stays; the next agent turn's deltas will keep
    // appending (or the agent will wipe via clear before next subject).
    if (this.streamingPauseAccept) {
      const cb = this.streamingPauseAccept;
      this.clearStreamingPauseHint();
      cb();
      return true;
    }
    // Streaming IN PROGRESS (cursor still blinking, no pause hint
    // attached): Space stops the agent — routes through the host's
    // close handler so the orchestrator can stop the loop AND show a
    // polished "stopped" feedback line.
    if (this.isStreaming()) {
      this.handleCloseClick();
      return true;
    }
    // Streaming-done / info bars (no accept callback bound): Space
    // closes the bar. Consistent dismiss gesture across modes.
    if (this.el && !this.currentOpts?.onAccept) {
      this.hide();
      return true;
    }
    const cb = this.currentOpts?.onAccept;
    if (!cb) {
      if (this.pages) {
        this.hide();
        return true;
      }
      return false;
    }
    // Acknowledge the tap immediately: hide the gated subtitle + show
    // a "running" indicator so the user sees their gesture landed. The
    // next agent step will replace this with its own subtitle. Without
    // this the previous step's bar lingers for 3-5s of LLM latency and
    // users assume the Space tap was ignored.
    this.hide();
    this.showIndicator('processing', this.resolveRunningLabel());
    cb();
    return true;
  }
  invokeReject(): boolean {
    // Pause-hint reject takes priority — fires the pause's reject
    // callback (host typically stops the agent) and clears the hint
    // without going through hide() since the streaming bar should
    // wind down via the host's stop-feedback path instead.
    if (this.streamingPauseReject) {
      const cb = this.streamingPauseReject;
      this.clearStreamingPauseHint();
      cb();
      return true;
    }
    const cb = this.currentOpts?.onReject;
    if (!cb) return false;
    this.hide();
    this.showIndicator('processing', this.resolveRunningLabel());
    cb();
    return true;
  }
  invokeCancel(): boolean {
    const cb = this.currentOpts?.onCancel;
    if (!cb) return false;
    this.hide();
    cb();
    return true;
  }

  /**
   * Override the "running" indicator label shown immediately after the
   * user taps Space accept / reject. The default is locale-aware
   * ("處理中…" / "Working…") via `setLocale()`. Hosts that want a
   * different word ("Thinking…", "Running automation…") set their own.
   * Pass `null` to fall back to the bundled default.
   */
  private runningLabel: string | null = null;
  setRunningLabel(label: string | null): void {
    this.runningLabel = label;
  }

  private resolveRunningLabel(): string | undefined {
    if (this.runningLabel) return this.runningLabel;
    // Locale-aware default. Bundled `en` / `zh-TW`; anything else falls
    // back to English so the indicator never breaks on unknown locales.
    if (this.locale === 'zh-TW') return 'Agent 執行中…';
    return 'Agent running…';
  }

  showIndicator(state: 'listening' | 'processing' | 'done', label?: string): void {
    // Subtitle takes priority — if one is visible, queue this indicator
    // and let `hide()` materialise it later. Stacking a "thinking…" pip
    // on top of an actionable subtitle bar was the bug the user kept
    // hitting (indicator drawn over the agent's reply they were
    // reading).
    if (this.el) {
      this.pendingIndicator = { state, label };
      return;
    }
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
    // Done state replaces the bouncing dots with a static checkmark — no
    // motion implies "finished, not waiting on anything".
    const visual = state === 'done'
      ? `<div ${UI_ATTR}="indicator-check">✓</div>`
      : `<div ${UI_ATTR}="indicator-dots"><span></span><span></span><span></span></div>`;
    this.indicator.innerHTML = `
      ${visual}
      ${label ? `<div ${UI_ATTR}="indicator-label">${escapeHtml(label)}</div>` : ''}
    `;
  }

  hideIndicator(): void {
    this.indicator?.remove();
    this.indicator = null;
    // An explicit hideIndicator from the host means "STOP showing it",
    // not "tuck it away" — drop the pending buffer too so the next
    // subtitle hide doesn't accidentally re-summon a stale indicator.
    this.pendingIndicator = null;
  }

  // ─── private ────────────────────────────────────────────────────

  /**
   * Render whichever page of `pages` we're on right now into the bar.
   * When pages is null we just render the original opts.text. Each
   * intermediate page hides the accept-callback presence so wireButtons
   * doesn't double-fire; the final page restores it. We also append a
   * `(n/N · space →)` paging hint so the user knows there's more.
   */
  private renderCurrentPage(): void {
    if (!this.el || !this.currentOpts) return;
    const opts = this.currentOpts;
    const isPaged = this.pages !== null;
    const isLastPage = !isPaged || this.pageIdx === this.pages!.length - 1;
    const pageText = isPaged ? this.pages![this.pageIdx]! : opts.text;

    // For intermediate pages we strip onAccept/onReject from the
    // wireButtons render so the buttons disappear (no accidental
    // "accept on page 2 of 5"). We restore the original opts after
    // the last page so the normal flow continues.
    const effectiveOpts: SubtitleShowOptions = isLastPage
      ? opts
      : { ...opts, onAccept: undefined, onReject: undefined, onCopy: undefined };

    const pageHint = isPaged
      ? this.formatPageHint(this.pageIdx + 1, this.pages!.length, isLastPage)
      : '';
    const hints = pageHint
      || (isLastPage ? this.renderHints(effectiveOpts) : '');

    this.el.setAttribute('data-dddk-bar-type', opts.type);
    this.el.innerHTML = this.wrapBarShell(`
      <div ${UI_ATTR}="bar-text">${renderInlineMarkdown(pageText)}</div>
      ${hints.startsWith(`<div ${UI_ATTR}="bar-hints"`) ? hints : (hints ? `<div ${UI_ATTR}="bar-hints">${escapeHtml(hints)}</div>` : '')}
      ${this.renderButtons(effectiveOpts)}
    `);
    this.wireButtons(effectiveOpts);
    this.wireClose();
  }

  /**
   * Wrap any bar inner-HTML in a frame that gives us:
   *   1. a non-scrolling × close button pinned to the top-right corner,
   *      always reachable even when long content scrolls
   *   2. a `bar-scroll` inner container so the content can be max-height
   *      capped + scrolled without losing the close button
   */
  private wrapBarShell(innerHtml: string): string {
    return `
      <button ${UI_ATTR}="bar-close" data-dddk-action="close" aria-label="${escapeHtml(this.closeLabel())}" title="${escapeHtml(this.closeLabel())}">×</button>
      <div ${UI_ATTR}="bar-scroll">${innerHtml}</div>
    `;
  }

  private closeLabel(): string {
    return this.locale === 'zh-TW' ? '關閉' : 'Close';
  }

  /**
   * Wire the × close button's click to hide() + fire any host-supplied
   * close handler. Idempotent — safe to call after any render path that
   * uses `wrapBarShell`.
   */
  private wireClose(): void {
    if (!this.el) return;
    const btn = this.el.querySelector<HTMLButtonElement>(`button[${UI_ATTR}="bar-close"]`);
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleCloseClick();
    });
  }

  private handleCloseClick(): void {
    // The close button is always "user explicitly dismissed". Treat it
    // like Esc — invoke onCancel if present so a confirm subtitle's
    // host hook fires (e.g. agent.stop). Then hide.
    const cancel = this.currentOpts?.onCancel;
    // Drop any pending indicator BEFORE hide() — otherwise hide() would
    // re-materialise the "thinking" pip we're about to clear via the
    // closeHandler, causing a 1-frame flicker.
    this.pendingIndicator = null;
    this.hide();
    // Also kill any currently-visible indicator. The host's closeHandler
    // will redundantly hide it, but doing it here means a host that
    // didn't wire a closeHandler still gets a clean dismiss.
    this.hideIndicator();
    cancel?.();
    // Always notify the host so it can run cross-cutting cleanup
    // (e.g. stop the agent loop even when there was no per-subtitle
    // onCancel — which is the case for streaming bars).
    this.closeHandler?.();
  }

  private formatPageHint(idx: number, total: number, isLast: boolean): string {
    const zh = this.locale === 'zh-TW';
    if (isLast) {
      return zh
        ? `${idx}/${total} ｜ space 同意 ｜ 雙擊 space 拒絕`
        : `${idx}/${total} · space accept · double-tap reject`;
    }
    return zh
      ? `${idx}/${total} ｜ space → 下一段`
      : `${idx}/${total} · space → next page`;
  }

  private renderHints(opts: SubtitleShowOptions): string {
    if (opts.hints) return `<div ${UI_ATTR}="bar-hints">${escapeHtml(opts.hints)}</div>`;

    // Subtitles WITHOUT explicit accept/reject AND without an `agent`
    // type (which is gesture-driven via the script-skill pipeline) get
    // a faint "press space to close" hint so the user knows the
    // dismiss gesture without having to find the × button.
    const isDecisionless = !opts.onAccept && !opts.onReject;
    if (isDecisionless && opts.type !== 'agent') {
      const touch = isTouchOnlyDevice();
      const text = touch
        ? (this.locale === 'zh-TW' ? '點一下關閉' : 'tap to dismiss')
        : (this.locale === 'zh-TW' ? '按 space 關閉' : 'press space to close');
      return `<div ${UI_ATTR}="bar-hints">${text}</div>`;
    }

    // Bundled defaults: SDK ships `en` + `zh-TW` strings. Any other locale
    // (`ja`, `es`, `fr`, …) falls back to `en` so the UI never breaks.
    // Hosts that want a native translation pass it through the `hints`
    // option on `Subtitle.show()` or via the `i18n` config on DotDotDuck.
    // Touch-only devices (phones / tablets) get tap-language copy in
    // place of the keyboard hints — there's no Space to press there.
    const touch = isTouchOnlyDevice();
    const defaults: Record<string, Record<SubtitleShowOptions['type'], string>> = touch ? {
      'zh-TW': {
        voice: '點一下繼續 ｜ 雙擊結束',
        selection: '點一下接受 ｜ 雙擊拒絕',
        agent: '點一下繼續 ｜ 雙擊結束',
        post: '點一下接受 ｜ 雙擊拒絕',
        info: '點一下關閉',
      },
      en: {
        voice: 'tap to continue · double-tap to exit',
        selection: 'tap to accept · double-tap to reject',
        agent: 'tap to continue · double-tap to exit',
        post: 'tap to accept · double-tap to reject',
        info: 'tap to dismiss',
      },
    } : {
      'zh-TW': {
        voice: 'Tab 一行 ｜ space 同意 ｜ 雙擊 space 拒絕',
        selection: 'space 接受 ｜ 雙擊 space 拒絕',
        agent: 'space 繼續 ｜ 雙擊 space 結束',
        post: 'space 接受 ｜ 雙擊 space 拒絕',
        info: '按 space 關閉',
      },
      en: {
        voice: 'Tab line · space accept · double-tap reject',
        selection: 'space accept · double-tap reject',
        agent: 'space continue · double-tap exit',
        post: 'space accept · double-tap reject',
        info: 'press space to close',
      },
    };
    const dict = defaults[this.locale] ?? defaults.en!;
    const text = dict[opts.type];
    return text ? `<div ${UI_ATTR}="bar-hints">${text}</div>` : '';
  }

  private renderButtons(opts: SubtitleShowOptions): string {
    if (opts.type === 'info') return '';
    const showCopy = opts.onCopy !== undefined;
    // On touch devices the bar itself is tap-to-accept / double-tap-to-
    // reject (see `bindTouchTapGestures`), so the ✓ / ✕ button pair is
    // redundant and visually heavy on small screens. Hide them on touch;
    // keep `copy` (it has no gesture equivalent).
    const touch = isTouchOnlyDevice();
    // Monochrome glyphs only — see user UI memo. Avoid emoji like 📋.
    return `
      <div ${UI_ATTR}="bar-buttons">
        ${showCopy ? `<button data-dddk-action="copy" aria-label="Copy">⎘</button>` : ''}
        ${!touch && opts.onAccept ? `<button data-dddk-action="accept" aria-label="Accept">✓</button>` : ''}
        ${!touch && opts.onReject ? `<button data-dddk-action="reject" aria-label="Reject">✕</button>` : ''}
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
/**
 * Split a long block of subtitle text into chunks no larger than
 * `maxChars`, broken on natural sentence boundaries
 * (`. ! ? 。 ！ ？`) and double newlines. Each returned page is
 * trimmed; no empty pages. Falls back to a hard-cut at maxChars
 * when no breakable boundary exists inside the window (e.g. a
 * single very long sentence). The end result reads well aloud and
 * keeps the bar's three-line layout intact while Space-paged.
 */
/** Touch-only environment heuristic — true on phones / tablets where
 *  the user has no physical Space key. We swap "press space" hints for
 *  "tap to continue" copy on these devices. Conservatively requires
 *  BOTH a touch capability AND a coarse pointer, so a 2-in-1 laptop in
 *  laptop mode still gets the keyboard hint. */
function isTouchOnlyDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  if (!hasTouch) return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return hasTouch;
  }
}

function splitIntoPages(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxChars) {
    // Look for the latest sentence-end inside the window.
    const window = remaining.slice(0, maxChars);
    // Try paragraph break first (best read-aloud rhythm).
    let cut = window.lastIndexOf('\n\n');
    if (cut < maxChars * 0.3) {
      // Then sentence terminators. Iterate over candidate marks and
      // take the latest hit within the window.
      const marks = ['. ', '! ', '? ', '。', '！', '？', '\n'];
      for (const m of marks) {
        const idx = window.lastIndexOf(m);
        if (idx > cut) cut = idx + m.length;
      }
    } else {
      cut += 2; // consume the paragraph break
    }
    if (cut < maxChars * 0.3) cut = maxChars; // hard cut — no boundary
    out.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) out.push(remaining);
  return out.length > 0 ? out : [text];
}

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
      position: relative;
      background: var(--dddk-bar-bg, var(--dddk-bg-elevated, rgba(255, 255, 255, 0.985)));
      color: var(--dddk-bar-text, var(--dddk-text, #1a1a1a));
      border: 1px solid var(--dddk-bar-border, var(--dddk-border, rgba(0, 0, 0, 0.08)));
      border-radius: var(--dddk-bar-radius, 16px);
      box-shadow: var(--dddk-bar-shadow, 0 18px 48px -12px rgba(0, 0, 0, 0.32), 0 4px 14px rgba(0, 0, 0, 0.08));
      padding: 0;
      font-family: var(--dddk-bar-font, var(--dddk-font, system-ui, -apple-system, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif));
      font-size: var(--dddk-bar-font-size, 15.5px);
      line-height: 1.65;
      letter-spacing: 0.005em;
      backdrop-filter: blur(var(--dddk-blur, 18px));
      -webkit-backdrop-filter: blur(var(--dddk-blur, 18px));
    }
    [${UI_ATTR}="bar-scroll"] {
      max-height: var(--dddk-bar-max-height, min(52vh, 460px));
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 18px 56px 18px 22px;
      display: flex; flex-direction: column; gap: 10px;
      scrollbar-width: thin;
      scrollbar-color: var(--dddk-border, rgba(0,0,0,0.18)) transparent;
    }
    [${UI_ATTR}="bar-scroll"]::-webkit-scrollbar { width: 8px; }
    [${UI_ATTR}="bar-scroll"]::-webkit-scrollbar-track { background: transparent; }
    [${UI_ATTR}="bar-scroll"]::-webkit-scrollbar-thumb {
      background: var(--dddk-border, rgba(0,0,0,0.18));
      border-radius: 4px;
    }
    [${UI_ATTR}="bar-close"] {
      position: absolute;
      top: 10px; right: 10px;
      width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--dddk-close-bg, rgba(0,0,0,0.05));
      color: var(--dddk-close-fg, var(--dddk-text, #1a1a1a));
      border: 1px solid var(--dddk-close-border, rgba(0,0,0,0.08));
      border-radius: 10px;
      font-size: 18px; line-height: 1;
      font-weight: 500;
      cursor: pointer;
      padding: 0;
      transition: background 0.12s, color 0.12s, border-color 0.12s, transform 0.08s;
      z-index: 2;
      -webkit-tap-highlight-color: transparent;
    }
    [${UI_ATTR}="bar-close"]:hover {
      background: var(--dddk-close-bg-hover, rgba(0,0,0,0.1));
      border-color: var(--dddk-close-border-hover, rgba(0,0,0,0.16));
    }
    [${UI_ATTR}="bar-close"]:focus-visible {
      outline: 2px solid var(--dddk-accent, #6366f1);
      outline-offset: 2px;
    }
    [${UI_ATTR}="bar-close"]:active { transform: scale(0.92); }
    [${UI_ATTR}="bar-hints"] {
      color: var(--dddk-bar-hints, var(--dddk-text-muted, #6b7280));
      font-size: var(--dddk-font-size-sm, 12.5px);
      margin-top: 2px;
    }
    [${UI_ATTR}="bar-text"] { line-height: 1.65; font-size: inherit; }
    /* Streaming mode: the bar shows live LLM output token-by-token. A
       blinking block cursor sits at the tail of the text node so users
       know more text is on the way. Once the agent loop ends and
       finalizeStreamed runs, the bar flips to streaming-done and the
       cursor is removed. */
    [${UI_ATTR}="bar"][data-dddk-bar-mode="streaming"] [${UI_ATTR}="bar-text"] {
      white-space: pre-wrap;
      word-break: break-word;
    }
    [${UI_ATTR}="streaming-cursor"] {
      display: inline-block;
      margin-left: 2px;
      color: var(--dddk-accent, #6366f1);
      animation: dddk-cursor-blink 1s steps(2) infinite;
      font-weight: 400;
      transform: translateY(-1px);
    }
    [${UI_ATTR}="bar"][data-dddk-bar-mode="streaming-done"] [${UI_ATTR}="bar-text"] {
      white-space: pre-wrap;
      word-break: break-word;
    }
    @keyframes dddk-cursor-blink {
      0%, 49% { opacity: 1; }
      50%, 100% { opacity: 0; }
    }
    /* Pause hint — attached BELOW the streamed text without replacing
       the bar. Visually a soft divider + a hint line so the user can
       still read what just streamed before deciding to continue. */
    [${UI_ATTR}="streaming-pause"] {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px dashed var(--dddk-border, rgba(0, 0, 0, 0.12));
      display: flex; flex-direction: column; gap: 4px;
    }
    [${UI_ATTR}="streaming-pause-text"] {
      font-size: var(--dddk-font-size-md, 14.5px);
      color: var(--dddk-text, #1a1a1a);
    }
    [${UI_ATTR}="streaming-pause-hints"] {
      font-size: var(--dddk-font-size-sm, 12.5px);
      color: var(--dddk-text-muted, #6b7280);
    }
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
    [${UI_ATTR}="indicator"][data-state="done"] {
      background: var(--dddk-success, #16a34a);
    }
    [${UI_ATTR}="indicator-check"] {
      font-size: 16px; line-height: 1;
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

