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

// Long-press threshold for voice. 250ms keeps the gesture snappy
// (anything longer felt sluggish) while staying clear of the natural
// space-tap range (~80-200ms in fast typing). If you hit accidental
// voice triggers on fast prose typing, push this back up to 350-400ms.
const DEFAULT_HOLD_THRESHOLD_MS = 250;
// Default window for double-tap-reject detection. Two space taps
// completing within this window are treated as "reject". Configurable
// via `GestureManagerOptions.doubleTapWindowMs`.
const DEFAULT_DOUBLE_TAP_WINDOW_MS = 350;

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
   * Default 250ms. Lower = more responsive but easier to mis-trigger on
   * fast prose typing; higher = less mis-trigger but voice feels laggy.
   */
  holdThresholdMs?: number;
  /**
   * Window for "two taps in this many ms → reject" detection. Default
   * 350ms. Raise if users with slower fingers can't reliably double-tap;
   * lower for power users who want reject to fire snappier.
   */
  doubleTapWindowMs?: number;
}

export class GestureManager {
  private callbacks: GestureCallbacks;
  private shouldIntercept: () => boolean;
  private gestureKey: 'space' | 'ctrl';
  private holdThresholdMs: number;
  private doubleTapWindowMs: number;

  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private tapTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTapAt = 0;
  private isHolding = false;
  /**
   * Set on space-keydown inside an input field. If user releases before the
   * hold threshold, we insert the missing space character manually (since we
   * preventDefault'd the keydown to keep voice-hold possible). If the hold
   * threshold fires, voice triggers without any space being inserted —
   * which is the desired behavior for "long-press to dictate".
   */
  private pendingSpaceInput: HTMLElement | null = null;

  /**
   * Disposer for the per-hold reactive guard that watches the focused
   * input for unexpected value changes during voice. Set when voice
   * triggers, called from `handleKeyUp` when the user releases. The
   * guard's job is to revert any character the OS-level IME slips into
   * the input despite `readOnly = true` — bullet-proofing against Edge
   * + Microsoft Bopomofo, which on some builds writes one stray space
   * AFTER readOnly is set (in-flight queued keystroke from the 250ms
   * detection window).
   */
  private holdRevertDispose: (() => void) | null = null;

  private cleanups: Array<() => void> = [];

  /** Set by host when a suggestion/subtitle/surface is visible. Enables accept/reject/tab. */
  hasSuggestion = false;

  constructor(opts: GestureManagerOptions) {
    this.callbacks = opts.callbacks;
    this.shouldIntercept = opts.shouldIntercept ?? (() => this.hasSuggestion);
    this.gestureKey = opts.gestureKey ?? 'space';
    this.holdThresholdMs = opts.holdThresholdMs ?? DEFAULT_HOLD_THRESHOLD_MS;
    this.doubleTapWindowMs = opts.doubleTapWindowMs ?? DEFAULT_DOUBLE_TAP_WINDOW_MS;
  }

  start(): void {
    if (typeof document === 'undefined') return;

    const onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
    const onKeyUp = (e: KeyboardEvent) => this.handleKeyUp(e);

    // Edge + Microsoft IME (Bopomofo / Pinyin) inserts characters at
    // the OS level BEFORE our document-capture keydown handler runs,
    // so `preventDefault` on keydown is too late — a stream of literal
    // spaces leaks into the input while the user is holding space for
    // voice. `beforeinput` fires after keydown but right BEFORE the
    // input's value mutates, and `preventDefault` here is honoured
    // even for IME-mediated inserts. Block input mutations while we
    // are detecting (`holdTimer` set) or actively voice-holding
    // (`isHolding`). Normal taps still type a space via the
    // `insertSpaceAt` path on keyup.
    const onBeforeInput = (e: InputEvent) => {
      if (this.isHolding || this.holdTimer !== null) {
        // Only block space-character inserts so other input (paste of
        // pre-existing text, deletion, etc.) keeps working.
        if (e.data === ' ' || e.inputType === 'insertText' && e.data === ' ') {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }
    };

    // Use capture phase for keys so we get Ctrl+K BEFORE the browser's
    // own search-bar focus shortcut. Without capture, some browsers (Chrome
    // on certain platforms / extensions) intercept Ctrl+K at the window
    // level before our bubble-phase listener runs.
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('beforeinput', onBeforeInput, true);

    this.cleanups.push(
      () => document.removeEventListener('keydown', onKeyDown, true),
      () => document.removeEventListener('keyup', onKeyUp, true),
      () => document.removeEventListener('beforeinput', onBeforeInput, true),
    );
  }

  destroy(): void {
    this.cancelHold();
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
  }

  /**
   * Read currently selected text (live, from DOM/input). Always queried
   * at the moment of the gesture — no cached state. Previously we kept
   * a `lastSelection` mirror updated by selectionchange / mouseup, but
   * that cache survived SPA navigation and leaked the previous page's
   * selection into the next page's first Ctrl+K. The fix is to never
   * cache: if the browser has live selection at gesture time, use it;
   * otherwise the gesture has no selection context.
   */
  captureSelection(): string {
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
      const targetInput = e.target as HTMLElement;

      // Snapshot the input's pre-hold state. Edge's IME can still leak
      // 1-2 literal spaces into the input during the detection window
      // (between this keydown and the hold timer firing) — the OS path
      // runs ahead of our preventDefault. When voice triggers, we
      // restore this snapshot so the input is in its ORIGINAL state.
      const isFormInput =
        targetInput instanceof HTMLInputElement ||
        targetInput instanceof HTMLTextAreaElement;
      const snapshotValue = isFormInput
        ? (targetInput as HTMLInputElement | HTMLTextAreaElement).value
        : null;
      const snapshotStart = isFormInput
        ? (targetInput as HTMLInputElement | HTMLTextAreaElement).selectionStart
            ?? (snapshotValue as string).length
        : 0;
      const snapshotEnd = isFormInput
        ? (targetInput as HTMLInputElement | HTMLTextAreaElement).selectionEnd
            ?? (snapshotValue as string).length
        : 0;

      const selection = this.captureSelection();
      const images = this.captureImages();

      this.holdTimer = setTimeout(() => {
        this.holdTimer = null;
        this.isHolding = true;
        if (this.tapTimer) {
          clearTimeout(this.tapTimer);
          this.tapTimer = null;
        }
        this.pendingSpaceInput = null;
        this.callbacks.onVoiceStart(selection, images);

        // Set readOnly FIRST so the snapshot restore can't get
        // immediately re-written by an in-flight IME insert.
        //   - <input> / <textarea> → `readOnly = true`
        //   - contentEditable → `contentEditable = 'false'`
        // Caret stays visible; consecutive voice gestures on the same
        // field keep appending. voice-handler flips these back right
        // before insertion.
        const isInputLike =
          targetInput instanceof HTMLInputElement ||
          targetInput instanceof HTMLTextAreaElement;
        if (isInputLike) {
          try { (targetInput as HTMLInputElement | HTMLTextAreaElement).readOnly = true; } catch { /* detached */ }
        } else if (targetInput.isContentEditable) {
          try { targetInput.contentEditable = 'false'; } catch { /* detached */ }
        }

        // Wipe any stray characters the IME leaked during the 250ms
        // detection window (before readOnly was set).
        if (
          snapshotValue !== null &&
          (targetInput instanceof HTMLInputElement || targetInput instanceof HTMLTextAreaElement) &&
          targetInput.value !== snapshotValue
        ) {
          targetInput.value = snapshotValue;
          try { targetInput.setSelectionRange(snapshotStart, snapshotEnd); } catch { /* detached */ }
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // REACTIVE guard. Edge + Microsoft Bopomofo IME can still flush
        // one in-flight space into the input AFTER readOnly is set (the
        // OS path queues the keystroke ahead of our JS handler). Listen
        // for `input` events on the target — anytime the value drifts
        // from the snapshot while voice is active, revert. Disposer is
        // called on keyup.
        if (isInputLike) {
          const inputEl = targetInput as HTMLInputElement | HTMLTextAreaElement;
          const onUnwantedInput = () => {
            if (inputEl.value !== snapshotValue) {
              inputEl.value = snapshotValue as string;
              try { inputEl.setSelectionRange(snapshotStart, snapshotEnd); } catch { /* detached */ }
            }
          };
          inputEl.addEventListener('input', onUnwantedInput, true);
          this.holdRevertDispose = () => {
            inputEl.removeEventListener('input', onUnwantedInput, true);
            this.holdRevertDispose = null;
          };
        }
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
      if (now - this.lastTapAt < this.doubleTapWindowMs) {
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
        }, this.doubleTapWindowMs);
      }
      return;
    }

    // Was holding → voice end. Tear down the reactive input-revert
    // guard (it's no-op once host clears readOnly anyway, but freeing
    // the listener now avoids a leak across sessions).
    this.isHolding = false;
    this.holdRevertDispose?.();
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
    this.holdRevertDispose?.();
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
