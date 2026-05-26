/**
 * Dwell — semantic annotation on long-press.
 *
 * Trigger: the user presses (mouse-down on desktop, touch-start on touch
 * devices) on any element and **holds without moving** for `dwellMs`.
 * If the pointer leaves the original target element before the timer fires,
 * the gesture cancels and normal interaction (text selection, click, drag)
 * proceeds — same UX shape as the iOS context-menu long-press.
 *
 * When the timer fires:
 *   1. Element's reachable DOM (tag, attributes, inner text — bounded by
 *      `maxContextChars`) is sent to the `inline` LLM role.
 *   2. Returned `{label, actions}` JSON renders as a small popover next
 *      to the cursor.
 *   3. Esc dismisses the popover at any time.
 *
 * Security boundary: only the visible DOM of the long-pressed element
 * is sent — same shape as user copying & asking AI about a paragraph.
 *
 * Disabled by default? No — but `setEnabled(false)` turns it off without
 * detaching listeners, so hosts can offer a runtime toggle.
 *
 * @example
 * ```ts
 * const mp = new Dwell({ llm, dwellMs: 500 });
 * mp.attachTo(dddk);
 *
 * // host UI somewhere:
 * <button onClick={() => mp.setEnabled(!mp.isEnabled())}>
 *   Dwell: {mp.isEnabled() ? 'on' : 'off'}
 * </button>
 * ```
 */

import type { Subtitle } from '../../ui/subtitle';
import type { DotDotDuck } from '../../orchestrator';
import { resolveLLM, type LLMSource } from '../../agent/llm/router';
import { inferSelector } from '../../utils/selector';
import { safeJsonParse } from '../../utils/llm-parse';
import { ensureDwellStyles, POPOVER_ATTR } from './styles';

export interface DwellConfig {
  /** LLMProvider or LLMRouter — `inline` role used. Optional when
   *  `annotateOnSelect: false` (the LLM popover isn't needed). */
  llm?: LLMSource;
  /** Hold time before selection fires. Default 700ms. */
  dwellMs?: number;
  /**
   * After the long-press fires, also call the LLM and surface a popover with
   * a label + suggested actions. Default `false` — Dwell becomes a pure
   * "pin an element" gesture: the frame appears, the element is remembered
   * for whatever happens next (`Ctrl+K` palette context, voice question
   * against the element, etc.), and the LLM is not invoked.
   *
   * Set `true` if you want the legacy "long-press → AI annotation" UX.
   */
  annotateOnSelect?: boolean;
  /** Called every time Dwell pins an element. Receives the element and a
   *  best-effort CSS selector. Hosts use this to seed palette context. */
  onSelect?: (el: HTMLElement, selector?: string) => void;
  /** Called when the marked element is cleared (Esc, click outside, etc.). */
  onClear?: () => void;
  /** Max DOM characters sent to LLM. Default 800. */
  maxContextChars?: number;
  /** System prompt override. */
  systemPrompt?: string;
  /** Start enabled? Default true. */
  enabled?: boolean;
  /**
   * Extra CSS selector for elements that should NOT trigger Dwell.
   * Appended to a sensible default (`[data-no-dwell], input, textarea,
   * select, [contenteditable], [draggable="true"]`). Set `ignoreDefaults: true`
   * to opt out of the defaults.
   */
  ignoreSelector?: string;
  /** Skip the default ignoreSelector list. Default false. */
  ignoreDefaults?: boolean;
  /**
   * Require a modifier key to be held during the long-press. Useful on sites
   * that already use plain long-press for their own buttons — set this to
   * disambiguate. Default `null` (no modifier required).
   */
  triggerModifier?: 'alt' | 'shift' | 'meta' | 'ctrl' | null;
  /**
   * Run the long-press detector on touch devices? Default `false`. Mobile
   * users typically interact via the MobileTrigger chrome instead; native
   * long-press is also already used by the OS for text selection + context
   * menus. Set `true` if you have a touch-only kiosk product where the OS
   * long-press is fine to override.
   */
  enableOnTouch?: boolean;
}

// POPOVER_ATTR / POPOVER_STYLE_ID moved to ./dwell/styles.ts
const DEFAULT_SYSTEM = `You are a Dwell assistant. The user long-pressed an HTML element.
Return a tight JSON description:

{
  "label": "<3-7 word semantic label, eg. 'Refund button for order ORD-1002'>",
  "actions": ["<action 1>", "<action 2>", "<action 3>"]
}

Actions are short imperatives the user might want to do with this element
(eg. "Refund", "Copy order ID", "Open customer profile"). Max 3 actions.
Reply with JSON only, no prose, no markdown fences.`;

interface DwellResult {
  label: string;
  actions: string[];
}

const DEFAULT_IGNORE = [
  '[data-no-dwell]',
  'input',
  'textarea',
  'select',
  '[contenteditable]',
  '[contenteditable="true"]',
  '[draggable="true"]',
].join(', ');

export class Dwell {
  private cfg: Required<Omit<DwellConfig, 'systemPrompt' | 'ignoreSelector' | 'triggerModifier' | 'llm' | 'onSelect' | 'onClear'>> & {
    llm?: LLMSource;
    systemPrompt?: string;
    ignoreSelector?: string;
    triggerModifier?: 'alt' | 'shift' | 'meta' | 'ctrl' | null;
    annotateOnSelect: boolean;
    onSelect?: (el: HTMLElement, selector?: string) => void;
    onClear?: () => void;
  };
  private effectiveIgnore: string;
  private hasLLM: boolean = false;
  private subtitle: Subtitle | null = null;

  private enabled: boolean;
  private dwellTimer: ReturnType<typeof setTimeout> | null = null;
  private pressStartX = 0;
  private pressStartY = 0;
  private pressStartSelLen = 0;
  private pressedTarget: HTMLElement | null = null;
  private inFlight: AbortController | null = null;
  private popover: HTMLDivElement | null = null;
  private cleanups: Array<() => void> = [];

  constructor(config: DwellConfig) {
    this.cfg = {
      llm: config.llm,
      dwellMs: config.dwellMs ?? 500,
      maxContextChars: config.maxContextChars ?? 800,
      enabled: config.enabled ?? true,
      ignoreDefaults: config.ignoreDefaults ?? false,
      enableOnTouch: config.enableOnTouch ?? false,
      systemPrompt: config.systemPrompt,
      ignoreSelector: config.ignoreSelector,
      triggerModifier: config.triggerModifier ?? null,
      annotateOnSelect: config.annotateOnSelect ?? false,
      onSelect: config.onSelect,
      onClear: config.onClear,
    };
    this.enabled = this.cfg.enabled;
    const parts: string[] = [];
    if (!this.cfg.ignoreDefaults) parts.push(DEFAULT_IGNORE);
    if (this.cfg.ignoreSelector) parts.push(this.cfg.ignoreSelector);
    this.effectiveIgnore = parts.join(', ');
    this.hasLLM = !!config.llm;
  }

  attachTo(dddk: DotDotDuck): void {
    if (typeof document === 'undefined') return;
    this.subtitle = dddk.subtitle;
    ensureDwellStyles();
    this.bindLongPress();
    this.bindDismiss();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.cancel();
      this.hidePopover();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  destroy(): void {
    this.cancel();
    this.hidePopover();
    this.popover?.remove();
    this.popover = null;
    for (const c of this.cleanups) c();
    this.cleanups = [];
  }

  // ─── press lifecycle ────────────────────────────────────────────

  private bindLongPress(): void {
    const onDown = (x: number, y: number, target: EventTarget | null, modifiers: ModifierState) => {
      if (!this.enabled) return;
      if (!(target instanceof HTMLElement)) return;
      if (this.effectiveIgnore && target.closest(this.effectiveIgnore)) return;
      // Don't fire on our own UI (progress ring, popover).
      if (target.closest(`[${POPOVER_ATTR}]`)) return;
      // Modifier gate — when configured, the matching key must be held during press.
      if (this.cfg.triggerModifier && !modifiers[this.cfg.triggerModifier]) return;

      this.pressStartX = x;
      this.pressStartY = y;
      this.pressedTarget = target;
      // Baseline selection length at press start. If the selection GROWS
      // during the dwell window the user is mid-drag-to-select, not
      // long-pressing — bail out so Dwell doesn't fight the browser's
      // text-selection gesture.
      this.pressStartSelLen = typeof window !== 'undefined'
        ? (window.getSelection?.()?.toString().length ?? 0)
        : 0;
      this.dwellTimer = setTimeout(() => {
        this.dwellTimer = null;
        if (!this.pressedTarget) return;
        const selLenNow = typeof window !== 'undefined'
          ? (window.getSelection?.()?.toString().length ?? 0)
          : 0;
        // User started selecting text mid-press — defer to the browser.
        if (selLenNow > this.pressStartSelLen) {
          this.pressedTarget = null;
          return;
        }
        this.markTarget(this.pressedTarget);
        if (this.cfg.onSelect) {
          this.cfg.onSelect(this.pressedTarget, inferSelector(this.pressedTarget) || undefined);
        }
        if (this.cfg.annotateOnSelect && this.hasLLM) {
          this.annotate(this.pressedTarget);
        }
      }, this.cfg.dwellMs);
    };

    /**
     * Cancellation rule: only if the cursor LEAVES the originally-pressed
     * element (and isn't on a descendant). Free movement WITHIN the pressed
     * element keeps the timer alive — natural for text reading, big buttons,
     * card hovers etc. HTML5 drag and right-click still cancel separately.
     */
    const onMove = (_x: number, _y: number, target: EventTarget | null) => {
      if (!this.dwellTimer) return;
      if (!this.pressedTarget) return;
      if (!(target instanceof HTMLElement)) return;
      if (target === this.pressedTarget) return;
      if (this.pressedTarget.contains(target)) return;
      // Cursor moved off the pressed element → cancel.
      this.cancel();
    };

    const onUp = () => {
      // Released before timer fires → normal click, no annotation.
      this.cancel();
    };

    // Mouse
    const mouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // only primary button
      onDown(e.clientX, e.clientY, e.target, modifiersFromEvent(e));
    };
    const mouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY, e.target);
    const mouseUp = () => onUp();

    // Right-click → cancel everything (press in flight + popover)
    const contextMenu = (e: MouseEvent) => {
      const inFlight = this.dwellTimer !== null;
      const popoverOpen = this.popover && this.popover.style.display !== 'none';
      if (inFlight || popoverOpen) {
        e.preventDefault();
        this.cancel();
        this.hidePopover();
      }
    };

    // HTML5 native drag-and-drop hijacks the cursor — cancel any in-flight press.
    const dragStart = () => this.cancel();

    document.addEventListener('mousedown',   mouseDown,  true);
    document.addEventListener('mousemove',   mouseMove,  true);
    document.addEventListener('mouseup',     mouseUp,    true);
    document.addEventListener('contextmenu', contextMenu);
    document.addEventListener('dragstart',   dragStart,  true);

    // Touch — opt-in via enableOnTouch (default false). Mobile users normally
    // interact through MobileTrigger's chrome instead.
    let cleanTouch: (() => void) | null = null;
    if (this.cfg.enableOnTouch) {
      const touchStart = (e: TouchEvent) => {
        const t = e.touches[0];
        if (!t) return;
        onDown(t.clientX, t.clientY, e.target, modifiersFromEvent(e));
      };
      const touchMove = (e: TouchEvent) => {
        const t = e.touches[0];
        if (t) {
          const el = document.elementFromPoint(t.clientX, t.clientY);
          onMove(t.clientX, t.clientY, el);
        }
      };
      const touchEnd = () => onUp();
      const touchCancel = () => this.cancel();

      document.addEventListener('touchstart',  touchStart,  { passive: true, capture: true });
      document.addEventListener('touchmove',   touchMove,   { passive: true, capture: true });
      document.addEventListener('touchend',    touchEnd,    { passive: true, capture: true });
      document.addEventListener('touchcancel', touchCancel, { passive: true, capture: true });
      cleanTouch = () => {
        document.removeEventListener('touchstart',  touchStart,  true);
        document.removeEventListener('touchmove',   touchMove,   true);
        document.removeEventListener('touchend',    touchEnd,    true);
        document.removeEventListener('touchcancel', touchCancel, true);
      };
    }

    this.cleanups.push(() => {
      document.removeEventListener('mousedown',   mouseDown,   true);
      document.removeEventListener('mousemove',   mouseMove,   true);
      document.removeEventListener('mouseup',     mouseUp,     true);
      document.removeEventListener('contextmenu', contextMenu);
      document.removeEventListener('dragstart',   dragStart,   true);
      if (cleanTouch) cleanTouch();
    });
  }

  // ─── target frame ───────────────────────────────────────────────

  private currentMarked: HTMLElement | null = null;

  /**
   * Add the selection-frame attribute to a target so host CSS can style it.
   * Once marked, the frame stays until the user explicitly dismisses it —
   * Esc, click anywhere outside the marked element / popover, or the
   * popover's own close button. Mouse movement alone does NOT clear it,
   * because the frame represents *selection state*, not a hover preview.
   */
  private markTarget(el: HTMLElement): void {
    this.unmarkTarget();
    el.setAttribute('data-dddk-dwell-target', '');
    this.currentMarked = el;
  }

  private unmarkTarget(): void {
    if (this.currentMarked) {
      this.currentMarked.removeAttribute('data-dddk-dwell-target');
      this.currentMarked = null;
      this.cfg.onClear?.();
    }
  }

  /** Public: the currently-marked element, or `null` if nothing is selected.
   *  Hosts call this on palette-open / voice-start to fetch the pinned
   *  element as agent / LLM context. */
  markedElement(): HTMLElement | null {
    return this.currentMarked;
  }

  private bindDismiss(): void {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.hidePopover();
        this.unmarkTarget();
      }
    };
    // Mutual exclusivity with text selection. The moment the user
    // creates a non-empty range, Dwell yields — both showing a frame
    // AND a highlighted text range at the same time is the bug the user
    // hit. The palette / agent context derive a SINGLE pin at open time;
    // clearing here keeps the visual in sync with that decision.
    const onSelChange = () => {
      if (!this.currentMarked) return;
      const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString();
      if (!text || text.trim().length === 0) return;
      // User has an active text selection → kill the dwell frame + pin.
      this.hidePopover();
      this.unmarkTarget();
    };
    // mousedown outside both the marked element and the popover → dismiss.
    // Covers the "popover hasn't rendered yet but frame is showing" gap.
    //
    // IMPORTANT: this listener runs in the BUBBLE phase, AFTER bindLongPress's
    // capture-phase mousedown has already started a fresh press timer. We must
    // NOT call `this.cancel()` here unconditionally — that would clobber every
    // new press timer and the long-press would never fire. Only dismiss when
    // there is actually something visible to dismiss (mark or popover).
    const onPageMouseDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const popoverOpen = this.popover !== null && this.popover.style.display !== 'none';
      const hasMark = this.currentMarked !== null;
      if (!popoverOpen && !hasMark) return; // nothing to dismiss — let the press proceed
      if (this.popover && this.popover.contains(t)) return;
      if (this.currentMarked && this.currentMarked.contains(t)) return;
      // Click landed outside the marked element / popover — dismiss only the
      // visible state. Do NOT call cancel(): the freshly-started press timer
      // from bindLongPress is the user's NEW long-press, which should run.
      this.hidePopover();
      this.unmarkTarget();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPageMouseDown);
    document.addEventListener('selectionchange', onSelChange);
    this.cleanups.push(() => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPageMouseDown);
      document.removeEventListener('selectionchange', onSelChange);
    });
  }

  /**
   * Cancel an *in-flight* press. Only clears state that belongs to the
   * pre-fire phase — does NOT remove the frame, because the frame represents
   * "this element is currently selected" and must persist for the user even
   * after they lift the mouse button. The frame is cleared by `hidePopover()`
   * (Esc / outside click / dismiss button) or by `setEnabled(false)`.
   */
  private cancel(): void {
    if (this.dwellTimer) {
      clearTimeout(this.dwellTimer);
      this.dwellTimer = null;
    }
    this.pressedTarget = null;
    this.inFlight?.abort();
    this.inFlight = null;
  }

  // ─── annotate + popover ─────────────────────────────────────────

  private async annotate(el: HTMLElement): Promise<void> {
    if (typeof document === 'undefined') return;
    if (!this.hasLLM || !this.cfg.llm) return; // no LLM → cannot annotate (annotateOnSelect off path)
    const text = extractContext(el, this.cfg.maxContextChars);
    if (!text) return;

    this.inFlight = new AbortController();
    const target = el;
    try {
      const llm = resolveLLM(this.cfg.llm, 'inline');
      const response = await llm.complete({
        messages: [
          { role: 'system', content: this.cfg.systemPrompt ?? DEFAULT_SYSTEM },
          { role: 'user', content: `Selected text:\n"""\n${text}\n"""\n\nInstruction: annotate this element` },
        ],
        signal: this.inFlight.signal,
        thinking: 'off',
        temperature: 0.2,
      });
      const raw = response.content;
      if (!this.enabled) return;
      const parsed = parseResult(raw);
      // Even when parsing fails (LLM returned bad JSON), keep the frame —
      // the user's "selection" gesture succeeded; the popover just can't
      // populate. They dismiss it themselves via Esc / click elsewhere.
      if (!parsed) return;
      this.showPopover(target, parsed);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.warn('[dwell] annotation failed:', err);
      }
      // Frame stays — see comment above.
    } finally {
      this.inFlight = null;
    }
  }

  private showPopover(el: HTMLElement, result: DwellResult): void {
    if (!this.popover) {
      this.popover = document.createElement('div');
      this.popover.setAttribute(POPOVER_ATTR, 'dwell');
      document.body.appendChild(this.popover);
    }
    this.popover.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'dwell-head';
    const label = document.createElement('div');
    label.className = 'dwell-label';
    label.textContent = result.label;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'dwell-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '✕';
    close.onclick = () => this.hidePopover();
    head.appendChild(label);
    head.appendChild(close);
    this.popover.appendChild(head);

    if (result.actions.length > 0) {
      const actions = document.createElement('div');
      actions.className = 'dwell-actions';
      for (const action of result.actions.slice(0, 3)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = action;
        btn.onclick = () => {
          this.subtitle?.show({ text: `→ ${action}`, type: 'info', autoHide: 1500 });
          this.hidePopover();
        };
        actions.appendChild(btn);
      }
      this.popover.appendChild(actions);
    }

    const hint = document.createElement('div');
    hint.className = 'dwell-hint';
    hint.textContent = 'Esc to dismiss';
    this.popover.appendChild(hint);

    const rect = el.getBoundingClientRect();
    this.popover.style.left = `${rect.left + window.scrollX}px`;
    this.popover.style.top = `${rect.bottom + window.scrollY + 6}px`;
    this.popover.style.display = 'block';
  }

  private hidePopover(): void {
    this.unmarkTarget();
    if (this.popover) this.popover.style.display = 'none';
  }
}

// ─── helpers ────────────────────────────────────────────────────────

interface ModifierState {
  alt: boolean;
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
}

function modifiersFromEvent(e: MouseEvent | TouchEvent): ModifierState {
  return {
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
    ctrl: e.ctrlKey,
  };
}

/**
 * Best-effort CSS selector for an element — id → unique class → tag.
 * Good enough to round-trip back to the same node for palette context
 * snapshots; not a full XPath.
 */
function extractContext(el: HTMLElement, maxChars: number): string {
  const tag = el.tagName.toLowerCase();
  const attrs: string[] = [];
  for (const a of ['id', 'class', 'aria-label', 'title', 'href', 'name', 'role']) {
    const v = el.getAttribute(a);
    if (v) attrs.push(`${a}="${v}"`);
  }
  const innerText = (el.innerText ?? el.textContent ?? '').trim().slice(0, maxChars);
  const opener = `<${tag}${attrs.length > 0 ? ' ' + attrs.join(' ') : ''}>`;
  return `${opener}\n${innerText}\n</${tag}>`;
}

function parseResult(raw: string): DwellResult | null {
  const obj = safeJsonParse<Partial<DwellResult>>(raw);
  if (!obj || typeof obj.label !== 'string' || !Array.isArray(obj.actions)) return null;
  return {
    label: obj.label,
    actions: obj.actions.filter((a): a is string => typeof a === 'string'),
  };
}

