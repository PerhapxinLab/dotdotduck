/**
 * GestureManager — unified space-based gesture system.
 * See ../../docs/02-space-gesture.md for the full design.
 *
 * Detects:
 *   - Single space tap (<150ms hold, 350ms gap) → accept
 *   - Double space tap (two taps <350ms) → reject
 *   - Long space press (>150ms) → voice start
 *   - Tab → accept next line (when subtitle showing)
 *   - Escape → dismiss
 *   - Ctrl+K / Cmd+K → command palette
 *   - Ctrl+Space (in input) → accept while typing
 *
 * Space is ONLY intercepted when shouldIntercept() returns true
 * (i.e. there's a pending UI awaiting user response).
 */

// Long-press threshold for voice. Bumped from 200ms → 400ms because
// 200ms was triggering on normal taps when the user was typing fast or
// composing CJK characters (IME hold state). 400ms is firmly past the
// "tap" range and well under any user's patience for a deliberate hold.
const DEFAULT_HOLD_THRESHOLD_MS = 400;
const DOUBLE_TAP_WINDOW_MS = 350;

export interface GestureCallbacks {
  onAccept: () => void;
  onReject: () => void;
  onAcceptLine: () => void;
  onVoiceStart: (selection: string, images: string[]) => void;
  onVoiceEnd: () => void;
  onPaletteToggle: (selection: string) => void;
  onEscape: () => void;
}

export interface GestureManagerOptions {
  callbacks: GestureCallbacks;
  /** Function called on every space keydown to decide whether to intercept. */
  shouldIntercept?: () => boolean;
  /** Legacy: use 'ctrl' for backwards-compat with old Ctrl-based UI. Default 'space'. */
  gestureKey?: 'space' | 'ctrl';
  /**
   * How long the user must hold the gesture key before voice_start fires.
   * Default 200ms. Lower = more responsive but easier to mis-trigger;
   * higher = less mis-trigger but voice feels laggy.
   */
  holdThresholdMs?: number;
}

export class GestureManager {
  private callbacks: GestureCallbacks;
  private shouldIntercept: () => boolean;
  private gestureKey: 'space' | 'ctrl';
  private holdThresholdMs: number;

  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private tapTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTapAt = 0;
  private isHolding = false;
  /** Pre-captured selection — refreshed on every selectionchange/mouseup. */
  private lastSelection = '';
  /**
   * Set on space-keydown inside an input field. If user releases before the
   * hold threshold, we insert the missing space character manually (since we
   * preventDefault'd the keydown to keep voice-hold possible). If the hold
   * threshold fires, voice triggers without any space being inserted —
   * which is the desired behavior for "long-press to dictate".
   */
  private pendingSpaceInput: HTMLElement | null = null;

  private cleanups: Array<() => void> = [];

  /** Set by host when a suggestion/subtitle/surface is visible. Enables accept/reject/tab. */
  hasSuggestion = false;

  constructor(opts: GestureManagerOptions) {
    this.callbacks = opts.callbacks;
    this.shouldIntercept = opts.shouldIntercept ?? (() => this.hasSuggestion);
    this.gestureKey = opts.gestureKey ?? 'space';
    this.holdThresholdMs = opts.holdThresholdMs ?? DEFAULT_HOLD_THRESHOLD_MS;
  }

  start(): void {
    if (typeof document === 'undefined') return;

    const onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
    const onKeyUp = (e: KeyboardEvent) => this.handleKeyUp(e);
    const onSelectionChange = () => {
      const s = this.readSelection();
      if (s) this.lastSelection = s;
    };

    // Use capture phase for keys so we get Ctrl+K BEFORE the browser's
    // own search-bar focus shortcut. Without capture, some browsers (Chrome
    // on certain platforms / extensions) intercept Ctrl+K at the window
    // level before our bubble-phase listener runs.
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('mouseup', onSelectionChange);

    this.cleanups.push(
      () => document.removeEventListener('keydown', onKeyDown, true),
      () => document.removeEventListener('keyup', onKeyUp, true),
      () => document.removeEventListener('selectionchange', onSelectionChange),
      () => document.removeEventListener('mouseup', onSelectionChange)
    );
  }

  destroy(): void {
    this.cancelHold();
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
  }

  /** Read currently selected text (live, from DOM/input). */
  captureSelection(): string {
    if (this.lastSelection) {
      const s = this.lastSelection;
      this.lastSelection = '';
      return s;
    }
    return this.readSelection();
  }

  captureImages(): string[] {
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0) return [];
    const out: string[] = [];
    const range = sel.getRangeAt(0);
    range.cloneContents().querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src');
      if (src) out.push(src);
    });
    return out;
  }

  // ─── private ────────────────────────────────────────────────────

  private handleKeyDown(e: KeyboardEvent): void {
    // IME composition guard. When a CJK user is actively composing a
    // character, `e.isComposing` is true; space pressed in that state
    // is committing the candidate, NOT a voice gesture. Bail so the
    // IME owns the keystroke.
    //
    // We intentionally DO NOT also check `keyCode === 229`: on Edge
    // with Bopomofo / Microsoft Pinyin IME selected, *every* keydown
    // (including autorepeat space outside composition) reports
    // keyCode 229. Returning on that signal blocks our preventDefault
    // and the OS leaks a stream of literal spaces into the focused
    // input when the user holds space for voice. `isComposing` alone
    // is the reliable per-keystroke "this is composition" signal.
    if (e.isComposing) {
      return;
    }

    // Always: Ctrl+K toggles palette regardless of intercept state.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const sel = this.captureSelection();
      this.cancelHold();
      this.callbacks.onPaletteToggle(sel);
      return;
    }

    // Escape always dismisses.
    if (e.key === 'Escape') {
      this.callbacks.onEscape();
      return;
    }

    // Tab accepts a line when suggestion is showing.
    if (e.key === 'Tab' && this.hasSuggestion) {
      e.preventDefault();
      this.callbacks.onAcceptLine();
      return;
    }

    // The main gesture key.
    if (!this.matchesGestureKey(e)) {
      // Any other key combined with gesture key → cancel hold (it's a chord).
      if (this.isHolding && (e.ctrlKey || e.metaKey || e.altKey)) {
        this.cancelHold();
      }
      return;
    }

    // Decide whether to intercept space at all.
    const inInput = isInInputField(e.target);

    // In an input AND user holds ctrl+space → that's the explicit accept shortcut,
    // not the start of a long-press voice. Treat as accept and don't preventDefault
    // (browser will insert a normal space if there's no intercept).
    if (this.gestureKey === 'space' && inInput && e.ctrlKey) {
      if (this.hasSuggestion) {
        e.preventDefault();
        this.callbacks.onAccept();
      }
      return;
    }

    // Space inside an input field — special handling:
    //   1. preventDefault on keydown so the space character isn't immediately
    //      inserted (otherwise voice-hold would always leave a stray space)
    //   2. Start the hold timer
    //   3. If keyup before threshold → insert space manually (it was a normal tap)
    //   4. If hold threshold fires → trigger voice (no stray space)
    //
    // This preserves "long-press to dictate" even when typing in the palette
    // input / textarea / contenteditable, while keeping normal space typing
    // smooth (imperceptible 150ms delay).
    if (this.gestureKey === 'space' && inInput) {
      e.preventDefault();
      if (e.repeat || this.holdTimer) return;
      this.pendingSpaceInput = e.target as HTMLElement;

      const selection = this.captureSelection();
      const images = this.captureImages();

      this.holdTimer = setTimeout(() => {
        this.holdTimer = null;
        this.isHolding = true;
        if (this.tapTimer) {
          clearTimeout(this.tapTimer);
          this.tapTimer = null;
        }
        // Hold confirmed → voice. Drop the pending-space (we won't insert it).
        this.pendingSpaceInput = null;
        this.callbacks.onVoiceStart(selection, images);
      }, this.holdThresholdMs);
      return;
    }

    // Page-level space (not in an input). Always intercept so the browser
    // doesn't scroll the page on space-down.
    e.preventDefault();

    if (e.repeat || this.holdTimer) return;

    const selection = this.captureSelection();
    const images = this.captureImages();

    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      this.isHolding = true;
      if (this.tapTimer) {
        clearTimeout(this.tapTimer);
        this.tapTimer = null;
      }
      this.callbacks.onVoiceStart(selection, images);
    }, this.holdThresholdMs);
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (!this.matchesGestureKey(e)) return;

    // Cancel hold if released before threshold
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }

    // If this was a short tap inside an input, the space character was
    // suppressed by handleKeyDown — insert it now manually so the user sees
    // a normal space land in their text.
    if (this.pendingSpaceInput && !this.isHolding) {
      insertSpaceAt(this.pendingSpaceInput);
      this.pendingSpaceInput = null;
      // Don't trigger accept/reject — this was a text edit, not a UI gesture.
      return;
    }
    this.pendingSpaceInput = null;

    if (!this.isHolding) {
      // Tap (no voice). Check double-tap window.
      const now = Date.now();
      if (now - this.lastTapAt < DOUBLE_TAP_WINDOW_MS) {
        if (this.tapTimer) {
          clearTimeout(this.tapTimer);
          this.tapTimer = null;
        }
        this.lastTapAt = 0;
        this.callbacks.onReject();
      } else {
        this.lastTapAt = now;
        if (this.tapTimer) clearTimeout(this.tapTimer);
        this.tapTimer = setTimeout(() => {
          this.tapTimer = null;
          if (this.hasSuggestion) this.callbacks.onAccept();
        }, DOUBLE_TAP_WINDOW_MS);
      }
      return;
    }

    // Was holding → voice end
    this.isHolding = false;
    this.callbacks.onVoiceEnd();
  }

  private matchesGestureKey(e: KeyboardEvent): boolean {
    if (this.gestureKey === 'space') {
      return e.key === ' ' || e.code === 'Space';
    }
    return e.key === 'Control' || e.key === 'Meta';
  }

  private cancelHold(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    if (this.isHolding) {
      this.isHolding = false;
      this.callbacks.onVoiceEnd();
    }
  }

  private readSelection(): string {
    let sel = window.getSelection?.()?.toString().trim() ?? '';
    if (!sel) {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
        const input = active as HTMLInputElement | HTMLTextAreaElement;
        const s = input.selectionStart ?? 0;
        const e = input.selectionEnd ?? 0;
        if (e > s) sel = input.value.substring(s, e);
      }
    }
    return sel;
  }
}

function isInInputField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || el.isContentEditable;
}

/**
 * Insert a literal space at the caret position of the given input/textarea/
 * contenteditable. Used by GestureManager when a short space tap inside an
 * input was suppressed (to allow voice-hold to also work in inputs).
 */
function insertSpaceAt(el: HTMLElement): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + ' ' + el.value.slice(end);
    const caret = start + 1;
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (el.isContentEditable) {
    try {
      document.execCommand('insertText', false, ' ');
    } catch {
      // execCommand deprecated in some envs; fall back silently
    }
  }
}
