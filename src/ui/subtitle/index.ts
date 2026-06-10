/**
 * Subtitle bar — DOM-rendered, CSS-variable themed. Shell file: public
 * class surface + state. Implementation in sibling modules (streaming /
 * choice / indicator / paging / markdown / styles / dismiss / touch).
 * See ../../../docs/07-subtitle-ui.md for the full design.
 */

import type { SubtitleChoiceOptions, SubtitleShowOptions, SubtitleType } from '../../types';
import { escapeHtml, UI_ATTR } from '../../utils/dom';
import { applyPlacement } from '../placement';
import { ensureStyles } from './styles';
import { renderInlineMarkdown } from './markdown';
import { renderCurrentPage as renderCurrentPageImpl, splitIntoPages } from './paging';
import { bindTouchTapGestures, isTouchOnlyDevice } from './touch';
import {
  appendStreamed as appendStreamedImpl,
  replaceStreamed as replaceStreamedImpl,
  finalizeStreamed as finalizeStreamedImpl,
  clearStreamed as clearStreamedImpl,
  applyStreamingPauseHint as applyStreamingPauseHintImpl,
  clearStreamingPauseHint as clearStreamingPauseHintImpl,
} from './streaming';
import { showChoice as showChoiceImpl } from './choice';
import {
  showIndicator as showIndicatorImpl,
  hideIndicator as hideIndicatorImpl,
  resolveRunningLabel,
} from './indicator';
import { installInteractionDismiss, clearAutoHide } from './dismiss';

export class Subtitle {
  /** @internal */ _el: HTMLDivElement | null = null;
  /** @internal */ _indicator: HTMLDivElement | null = null;
  /** @internal */ _autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  /** @internal */ _currentOpts: SubtitleShowOptions | null = null;
  /** @internal */ _delegatedHandler: ((e: Event) => void) | null = null;
  /** @internal Document keydown teardown for multi-choice mode. */
  _choiceTeardown: (() => void) | null = null;
  /** @internal Click-anywhere / any-key dismiss teardown. */
  _dismissTeardown: (() => void) | null = null;
  /** @internal */ _locale: string;
  /** @internal Indicator request queued while a subtitle is visible;
   *  materialises on hide(). Subtitle + indicator are mutually exclusive. */
  _pendingIndicator: { state: 'listening' | 'processing' | 'done'; label?: string } | null = null;
  /** @internal Multi-page state for a single `show()` call. */
  _pages: string[] | null = null;
  /** @internal */ _pageIdx = 0;
  /** @internal Host hook for "user explicitly closed the bar". */
  _closeHandler: (() => void) | null = null;
  /** @internal Live Text node the streaming bar appends into. */
  _streamingTextNode: Text | null = null;
  /** @internal */ _streamingCursor: HTMLSpanElement | null = null;
  /** @internal Untranscribed tail held for sentence-boundary TTS flush. */
  _streamingTtsBuffer = '';
  /** @internal Raw accumulated streaming text (for replaceStreamed). */
  _streamingFullText = '';
  /** @internal Pause-hint callbacks — invokeAccept = advance, invokeReject = stop. */
  _streamingPauseAccept: (() => void) | null = null;
  /** @internal */ _streamingPauseReject: (() => void) | null = null;
  /** @internal Override for the "running" indicator label after accept/reject. */
  _runningLabel: string | null = null;
  /** @internal Orchestrator hook — flips GestureManager.hasSuggestion so
   *  space-tap on a proactive prompt isn't a no-op. */
  _onVisibilityChange?: (visible: boolean) => void;
  /** @internal Fire-and-forget TTS hook — failures swallowed (no audio
   *  is strictly better than blocking the visual subtitle). */
  _ttsProvider?: (text: string, opts: { locale: string; type: SubtitleType }) => void;

  constructor(opts: { locale?: string } = {}) {
    this._locale = opts.locale ?? 'en';
  }

  setLocale(locale: string): void { this._locale = locale; }
  setVisibilityListener(fn: (visible: boolean) => void): void { this._onVisibilityChange = fn; }
  setTTSProvider(fn: typeof this._ttsProvider | null): void { this._ttsProvider = fn ?? undefined; }
  /** Hook for × button + outside dismiss — orchestrator typically
   *  stops the agent loop here. */
  setCloseHandler(fn: (() => void) | null): void { this._closeHandler = fn; }

  show(opts: SubtitleShowOptions): void {
    if (typeof document === 'undefined') return;
    ensureStyles();

    // Subtitle + indicator are mutually exclusive — tuck the indicator
    // into _pendingIndicator and let hide() restore it.
    if (this._indicator) {
      const state = (this._indicator.getAttribute('data-state') as 'listening' | 'processing' | 'done') ?? 'processing';
      const labelEl = this._indicator.querySelector<HTMLElement>(`[${UI_ATTR}="indicator-label"]`);
      this._pendingIndicator = { state, label: labelEl?.textContent ?? undefined };
      this._indicator.remove();
      this._indicator = null;
    }

    clearAutoHide(this);

    // Wipe streaming state so a confirm Space-accept replacing a
    // streaming bar isn't misrouted as "stop the agent".
    this._streamingTextNode = null;
    this._streamingCursor = null;
    this._streamingFullText = '';
    this._streamingTtsBuffer = '';

    const wasVisible = this._el !== null;
    if (!this._el) {
      this._el = document.createElement('div');
      this._el.setAttribute(UI_ATTR, 'bar');
      applyPlacement(this._el, 'subtitle');
      document.body.appendChild(this._el);
      bindTouchTapGestures(this._el);
    } else {
      // Reusing the el for a different mode — clear bar-mode so
      // streaming / streaming-done CSS selectors stop applying.
      this._el.removeAttribute('data-dddk-bar-mode');
    }
    if (!wasVisible) this._onVisibilityChange?.(true);

    // Paginate long content on sentence boundaries — keeps the bar's
    // three-line layout intact, lets Space advance pages instead of
    // forcing a scroll that loses Space-tap context.
    const maxPerPage = opts.maxCharsPerPage ?? 220;
    if (maxPerPage > 0 && opts.text.length > maxPerPage) {
      this._pages = splitIntoPages(opts.text, maxPerPage);
      this._pageIdx = 0;
    } else {
      this._pages = null;
      this._pageIdx = 0;
    }

    this._currentOpts = opts;
    renderCurrentPageImpl(this);
    document.body.dataset.dddkActive = 'true';

    if (this._ttsProvider) {
      try { this._ttsProvider(opts.text, { locale: this._locale, type: opts.type }); }
      catch { /* swallow */ }
    }

    // Default OFF — caller opts in via `autoHide: <ms>`. Bars stick
    // until: click outside, any non-modifier key, double-tap Space, or hide().
    const DEFAULT_AUTO_HIDE = 0;
    const autoHideMs = opts.autoHide ?? DEFAULT_AUTO_HIDE;
    if (autoHideMs > 0) {
      this._autoHideTimer = setTimeout(() => this.hide(), autoHideMs);
    }
    installInteractionDismiss(this, opts);
  }

  update(text: string): void {
    if (!this._el) return;
    const textEl = this._el.querySelector(`[${UI_ATTR}="bar-text"]`);
    if (textEl) textEl.innerHTML = renderInlineMarkdown(text);
    if (this._currentOpts) this._currentOpts.text = text;
  }

  // ── streaming ───────────────────────────────────────────────────

  appendStreamed(delta: string): void { appendStreamedImpl(this, delta); }
  replaceStreamed(text: string): void { replaceStreamedImpl(this, text); }
  finalizeStreamed(opts?: { autoHide?: number }): void { finalizeStreamedImpl(this, opts); }
  clearStreamed(): void { clearStreamedImpl(this); }

  isStreaming(): boolean {
    return this._streamingTextNode !== null && this._el?.getAttribute('data-dddk-bar-mode') === 'streaming';
  }

  applyStreamingPauseHint(opts: {
    hint: string;
    rejectHint?: string;
    onAccept: () => void;
    onReject: () => void;
  }): void {
    applyStreamingPauseHintImpl(this, opts);
  }

  clearStreamingPauseHint(): void { clearStreamingPauseHintImpl(this); }

  // ── choice ──────────────────────────────────────────────────────

  showChoice(opts: SubtitleChoiceOptions): void { showChoiceImpl(this, opts); }

  // ── hide / visibility ───────────────────────────────────────────

  hide(): void {
    const wasVisible = this._el !== null;
    if (this._el && this._delegatedHandler) {
      this._el.removeEventListener('click', this._delegatedHandler);
      this._delegatedHandler = null;
    }
    if (this._choiceTeardown) { this._choiceTeardown(); this._choiceTeardown = null; }
    if (this._dismissTeardown) { this._dismissTeardown(); this._dismissTeardown = null; }
    if (this._el) { this._el.remove(); this._el = null; }
    this._currentOpts = null;
    // Streaming state lives on the bar el; reset when it goes.
    this._streamingTextNode = null;
    this._streamingCursor = null;
    this._streamingFullText = '';
    this._streamingTtsBuffer = '';
    delete document.body.dataset.dddkActive;
    clearAutoHide(this);
    if (wasVisible) this._onVisibilityChange?.(false);
    // Materialise queued indicator now that the bar is gone.
    if (this._pendingIndicator) {
      const p = this._pendingIndicator;
      this._pendingIndicator = null;
      this.showIndicator(p.state, p.label);
    }
  }

  isVisible(): boolean {
    return this._el !== null;
  }

  // ── gesture entry points ────────────────────────────────────────

  /** Gesture entry points — single space → invokeAccept, double tap →
   *  invokeReject, Esc → invokeCancel. Without these the bar would
   *  only respond to clicks. */
  invokeAccept(): boolean {
    // Paged: Space advances to the next page until we run out.
    if (this._pages && this._pageIdx < this._pages.length - 1) {
      this._pageIdx += 1;
      renderCurrentPageImpl(this);
      return true;
    }
    // Streaming + pause hint — Space ADVANCES past the pause (does
    // NOT stop the agent); hint clears, streamed text stays.
    if (this._streamingPauseAccept) {
      const cb = this._streamingPauseAccept;
      this.clearStreamingPauseHint();
      cb();
      return true;
    }
    // Streaming IN PROGRESS (cursor blinking, no pause): Space stops
    // the agent via the host close handler so the orchestrator can
    // run its stop-feedback path.
    if (this.isStreaming()) {
      this._handleCloseClick();
      return true;
    }
    // Streaming-done / info bars (no accept callback): Space closes.
    if (this._el && !this._currentOpts?.onAccept) {
      this.hide();
      return true;
    }
    const cb = this._currentOpts?.onAccept;
    if (!cb) {
      if (this._pages) { this.hide(); return true; }
      return false;
    }
    // Acknowledge the tap immediately — hide the gated bar + show a
    // "running" indicator. Without this the previous step's bar
    // lingers for 3-5s of LLM latency and users assume Space was eaten.
    this.hide();
    this.showIndicator('processing', resolveRunningLabel(this));
    cb();
    return true;
  }

  invokeReject(): boolean {
    // Pause-hint reject takes priority — fires reject (host stops the
    // agent) and clears the hint without going through hide(); the
    // streaming bar winds down via host stop-feedback instead.
    if (this._streamingPauseReject) {
      const cb = this._streamingPauseReject;
      this.clearStreamingPauseHint();
      cb();
      return true;
    }
    const cb = this._currentOpts?.onReject;
    if (!cb) return false;
    this.hide();
    this.showIndicator('processing', resolveRunningLabel(this));
    cb();
    return true;
  }

  invokeCancel(): boolean {
    // Persistent bars refuse Esc / outside-cancel — host has declared
    // the user must explicitly pick accept or reject.
    if (this._currentOpts?.persistent) return false;
    const cb = this._currentOpts?.onCancel;
    if (!cb) return false;
    this.hide();
    cb();
    return true;
  }

  /** Override the "running" indicator label; `null` falls back to the
   *  locale-aware default ("處理中…" / "Working…"). */
  setRunningLabel(label: string | null): void {
    this._runningLabel = label;
  }

  // ── indicator ───────────────────────────────────────────────────

  showIndicator(state: 'listening' | 'processing' | 'done', label?: string): void {
    showIndicatorImpl(this, state, label);
  }

  hideIndicator(): void { hideIndicatorImpl(this); }

  // ── internal renderers (used by paging.ts / streaming.ts) ───────

  /** @internal Wrap inner HTML in the shell — pinned × button + a
   *  `bar-scroll` container that can max-height-cap + scroll without
   *  losing the close button. Persistent opts skip the ×. */
  _wrapBarShell(innerHtml: string): string {
    const persistent = this._currentOpts?.persistent === true;
    const closeBtn = persistent
      ? ''
      : `<button ${UI_ATTR}="bar-close" data-dddk-action="close" aria-label="${escapeHtml(this._closeLabel())}" title="${escapeHtml(this._closeLabel())}">×</button>`;
    return `
      ${closeBtn}
      <div ${UI_ATTR}="bar-scroll">${innerHtml}</div>
    `;
  }

  /** @internal */
  _closeLabel(): string {
    return this._locale === 'zh-TW' ? '關閉' : 'Close';
  }

  /** @internal Idempotent — safe to call after any wrapBarShell render. */
  _wireClose(): void {
    if (!this._el) return;
    const btn = this._el.querySelector<HTMLButtonElement>(`button[${UI_ATTR}="bar-close"]`);
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._handleCloseClick();
    });
  }

  /** @internal */
  _handleCloseClick(): void {
    // × is "user explicitly dismissed". Drop pending indicator BEFORE
    // hide() to avoid a 1-frame flicker of the pip we're about to clear.
    const cancel = this._currentOpts?.onCancel;
    this._pendingIndicator = null;
    this.hide();
    this.hideIndicator();
    cancel?.();
    // Notify the host so cross-cutting cleanup (stop the agent loop
    // even when there was no per-subtitle onCancel — case for
    // streaming bars) can run.
    this._closeHandler?.();
  }

  /** @internal Touch devices use the bar's tap-gesture instead of the
   *  ✓/✕ buttons (redundant + heavy on small screens). Copy stays —
   *  no gesture equivalent. Monochrome glyphs only — no emoji. */
  _renderButtons(opts: SubtitleShowOptions): string {
    if (opts.type === 'info') return '';
    const showCopy = opts.onCopy !== undefined;
    const touch = isTouchOnlyDevice();
    return `
      <div ${UI_ATTR}="bar-buttons">
        ${showCopy ? `<button data-dddk-action="copy" aria-label="Copy">⎘</button>` : ''}
        ${!touch && opts.onAccept ? `<button data-dddk-action="accept" aria-label="Accept">✓</button>` : ''}
        ${!touch && opts.onReject ? `<button data-dddk-action="reject" aria-label="Reject">✕</button>` : ''}
      </div>
    `;
  }

  /** @internal Single delegated click listener (vs per-button) so no
   *  dangling listeners accumulate when innerHTML is replaced mid-life. */
  _wireButtons(opts: SubtitleShowOptions): void {
    if (!this._el) return;
    if (this._delegatedHandler) {
      this._el.removeEventListener('click', this._delegatedHandler);
      this._delegatedHandler = null;
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
    this._el.addEventListener('click', handler);
    this._delegatedHandler = handler;
  }
}
