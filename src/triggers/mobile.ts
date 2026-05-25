/**
 * MobileTrigger — touch invocation for dddk on phones / tablets.
 *
 * Gesture: **rapid up-down swipe** — the user wiggles a finger up and down
 * several times in quick succession (≥3 direction reversals within ~700ms).
 * This is chosen because:
 *   - Normal scroll is one direction at a time → no false positives
 *   - Doesn't collide with any OS-reserved gesture (iOS back, Android nav,
 *     pull-to-refresh, etc.)
 *   - Discoverable by hint or onboarding ("shake your finger up and down")
 *
 * On trigger, two semi-transparent chrome bars slide in:
 *
 *   ┌──────────────────────────────────────────┐
 *   │ 🔍 Palette                            ✕ │  ← top bar
 *   ├──────────────────────────────────────────┤
 *   │                                          │
 *   │   (original page content — still         │
 *   │    scrollable; **tapping any element     │
 *   │    triggers dwell-style**        │
 *   │    instead of the element's own click)   │
 *   │                                          │
 *   ├──────────────────────────────────────────┤
 *   │              ●  (center button)          │  ← bottom bar
 *   └──────────────────────────────────────────┘
 *
 * Top bar:
 *   - Tap "🔍 Palette" → opens command palette
 *   - Tap "✕"          → closes the chrome, page returns to normal
 *
 * Middle (the page):
 *   - Scrolling: works as before
 *   - Tapping an element: intercepted → fires `palette_open` with the
 *     element's selector so Dwell / a host skill can annotate
 *
 * Bottom bar — circular center button (replaces Space):
 *   - Long press (> 200ms)  → fires `voice_start`
 *   - Single tap            → fires `gesture_accept`
 *   - Double tap (within 350ms) → fires `gesture_reject`
 *
 * @example
 * ```ts
 * import { MobileTrigger } from '@perhapxin/dddk';
 *
 * const mt = new MobileTrigger();
 * mt.attachTo(dddk);
 * ```
 */

import type { DotDotDuck } from '../orchestrator';
import { injectScopedStyle } from '../utils/dom';
import { inferSelector } from '../utils/selector';

/**
 * Floating action button (FAB) — the default mobile entry point.
 *
 * Replaces nothing; runs alongside the swipe gesture so users have two ways
 * in. Highly customizable: icon, label, position, shape, color, full CSS
 * override. Hosts can also call `bindTrigger(myButton)` to use their OWN
 * existing header / nav element as the trigger, then set `fab: false` to
 * suppress the default FAB.
 */
export interface MobileFABConfig {
  /** Show the default FAB? Default true on touch devices. */
  enabled?: boolean;
  /**
   * The icon shown inside the FAB. Accepts:
   *   - emoji / text string ('🔍', '✨')
   *   - raw HTML string ('<svg>...</svg>')
   *   - an HTMLElement (will be appended into the button)
   * Default: a 24px sparkle SVG.
   */
  icon?: string | HTMLElement;
  /** Optional visible text under/next to the icon. Default none. */
  text?: string;
  /** ARIA label. Default 'Open command palette'. */
  ariaLabel?: string;
  /** Position. Default 'bottom-right'. */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** Offset from the edges in px. Default { x: 20, y: 24 }. */
  offset?: { x?: number; y?: number };
  /** Diameter in px (square shape uses this as width/height). Default 56. */
  size?: number;
  /** Shape. Default 'circle'. 'square' uses --dddk-radius. 'pill' = rounded rect. */
  shape?: 'circle' | 'square' | 'pill';
  /**
   * Inline CSS override — applied AFTER all defaults. Use this to fully
   * replace background, gradient, border, shadow, etc.
   */
  style?: Partial<CSSStyleDeclaration>;
  /** Extra className(s) to append; lets hosts target with their own CSS. */
  className?: string;
  /**
   * What the FAB does on tap. Default: open palette.
   * Receive the DotDotDuck instance so host can do anything.
   */
  onTap?: (dddk: DotDotDuck) => void;
  /**
   * What the FAB does on long-press (>200ms by default).
   * Default: fires the same voice-start event the center button fires.
   * Set to `null` to disable long-press behavior entirely.
   */
  onLongPress?: ((dddk: DotDotDuck) => void) | null;
}

export interface MobileTriggerConfig {
  /** Min direction reversals in the swipe window to trigger. Default 3. */
  reversalsToTrigger?: number;
  /** Time window (ms) the reversals must happen within. Default 700. */
  swipeWindowMs?: number;
  /** Min Y delta per reversal (px). Default 30. Filters jitter. */
  minSwipeDelta?: number;
  /** Long-press threshold for voice (ms). Default 200. */
  longPressMs?: number;
  /** Double-tap window (ms). Default 350. */
  doubleTapMs?: number;
  /** Force enable on non-touch devices (for testing). Default false. */
  forceEnable?: boolean;
  /**
   * When chrome is open, tapping page elements routes through Dwell (host
   * wires the listener). Default `false` — chrome shows but taps work
   * normally. Flip via `setDwellOnTap()` at runtime.
   */
  dwellOnTap?: boolean;
  /**
   * Floating action button — default mobile entry point.
   * Pass `false` to disable (host uses `bindTrigger()` with their own UI).
   * Pass an object to customize.
   */
  fab?: MobileFABConfig | false;
}

const UI_ATTR = 'data-dddk-ui';
const STYLE_ID = 'dddk-mobile-trigger-style';

interface SwipeSample {
  y: number;
  t: number;
  dir: 'up' | 'down' | null;
}

export class MobileTrigger {
  private cfg: Omit<Required<MobileTriggerConfig>, 'fab'> & { fab: MobileFABConfig | false };
  private dddk: DotDotDuck | null = null;
  private topBar: HTMLDivElement | null = null;
  private bottomBar: HTMLDivElement | null = null;
  private fabEl: HTMLButtonElement | null = null;
  private visible = false;
  private samples: SwipeSample[] = [];
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTapAt = 0;
  private singleTapTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanups: Array<() => void> = [];

  private dwellOnTap: boolean;

  constructor(config: MobileTriggerConfig = {}) {
    this.cfg = {
      reversalsToTrigger: config.reversalsToTrigger ?? 2,
      swipeWindowMs: config.swipeWindowMs ?? 900,
      minSwipeDelta: config.minSwipeDelta ?? 18,
      longPressMs: config.longPressMs ?? 200,
      doubleTapMs: config.doubleTapMs ?? 350,
      forceEnable: config.forceEnable ?? false,
      dwellOnTap: config.dwellOnTap ?? false,
      fab: config.fab ?? {},
    };
    this.dwellOnTap = this.cfg.dwellOnTap;
  }

  setDwellOnTap(enabled: boolean): void {
    this.dwellOnTap = enabled;
  }

  isDwellOnTap(): boolean {
    return this.dwellOnTap;
  }

  attachTo(dddk: DotDotDuck): void {
    if (typeof document === 'undefined') return;

    // Important: we ALWAYS attach + listen for breakpoint changes, even
    // when the initial viewport is desktop. Otherwise:
    //   1. Page loads on desktop → attachTo bails out
    //   2. User opens DevTools, switches to mobile emulation → no listener
    //      to react, FAB stays absent forever
    //   3. User reports "the FAB disappeared"
    // We still gate the actual FAB MOUNT on touch/mobile/forceEnable, but
    // the matchMedia listener is unconditional so any later transition
    // into mobile mode lights up the FAB.
    this.dddk = dddk;
    ensureStyles();

    const touch = isTouchDevice();
    const mobile = isMobileViewport();
    const force = !!this.cfg.forceEnable;
    const shouldMountNow = force || touch || mobile;

    if (touch || force) {
      this.bindSwipeDetector();
    }

    if (
      shouldMountNow &&
      this.cfg.fab !== false &&
      (this.cfg.fab.enabled ?? true)
    ) {
      this.mountFab();
    }

    // Always-on breakpoint listener — handles desktop→mobile transitions
    // (DevTools emulation, window resize, orientation change).
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = () => {
      const shouldShow = mq.matches || isTouchDevice() || this.cfg.forceEnable;
      if (shouldShow && !this.fabEl && this.cfg.fab !== false && (this.cfg.fab.enabled ?? true)) {
        this.mountFab();
      } else if (!shouldShow && this.fabEl) {
        this.fabEl.remove();
        this.fabEl = null;
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else (mq as MediaQueryList).addListener?.(onChange);
    this.cleanups.push(() => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else (mq as MediaQueryList).removeListener?.(onChange);
    });
  }

  /**
   * Bind ANY host element as a palette trigger. Use this when you want your
   * existing header button / hamburger menu / nav icon to also open dddk.
   * Returns a cleanup function.
   *
   *   const off = mt.bindTrigger(document.querySelector('#my-fab')!);
   *   // later: off();
   */
  bindTrigger(
    element: HTMLElement,
    opts: {
      onTap?: (dddk: DotDotDuck) => void;
      onLongPress?: ((dddk: DotDotDuck) => void) | null;
    } = {},
  ): () => void {
    if (!this.dddk) {
      // Defer until attached.
      this.cleanups.push(() => {});
      return () => {};
    }
    const dddk = this.dddk;
    const onTap = opts.onTap ?? ((d) => d.palette.toggle());
    const onLongPress = opts.onLongPress === undefined
      ? (d: DotDotDuck) => d.triggerVoiceStart()
      : opts.onLongPress;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let longFired = false;

    const press = () => {
      longFired = false;
      if (onLongPress) {
        timer = setTimeout(() => {
          timer = null;
          longFired = true;
          onLongPress(dddk);
        }, this.cfg.longPressMs);
      }
    };
    const release = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!longFired) onTap(dddk);
      else if (onLongPress) dddk.triggerVoiceEnd();
    };
    const cancel = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    element.addEventListener('touchstart', (e) => { e.preventDefault(); press(); }, { passive: false });
    element.addEventListener('touchend',   (e) => { e.preventDefault(); release(); }, { passive: false });
    element.addEventListener('touchcancel', cancel);
    element.addEventListener('mousedown',  press);
    element.addEventListener('mouseup',    release);
    element.addEventListener('mouseleave', cancel);

    const off = () => {
      element.removeEventListener('touchstart', press);
      element.removeEventListener('touchend', release);
      element.removeEventListener('touchcancel', cancel);
      element.removeEventListener('mousedown', press);
      element.removeEventListener('mouseup', release);
      element.removeEventListener('mouseleave', cancel);
    };
    this.cleanups.push(off);
    return off;
  }

  show(): void {
    if (!this.dddk) return;
    if (!this.topBar) this.mountChrome();
    this.visible = true;
    this.topBar?.setAttribute('data-visible', '');
    this.bottomBar?.setAttribute('data-visible', '');
  }

  hide(): void {
    this.visible = false;
    this.topBar?.removeAttribute('data-visible');
    this.bottomBar?.removeAttribute('data-visible');
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  destroy(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.topBar?.remove();
    this.bottomBar?.remove();
    this.fabEl?.remove();
    this.topBar = this.bottomBar = null;
    this.fabEl = null;
  }

  // ─── FAB (floating action button) ───────────────────────────────

  private mountFab(): void {
    if (!this.dddk || this.fabEl) return;
    const fabCfg: MobileFABConfig = this.cfg.fab === false ? {} : this.cfg.fab;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(UI_ATTR, 'mobile-fab');
    btn.setAttribute('aria-label', fabCfg.ariaLabel ?? 'Open command palette');
    if (fabCfg.className) btn.className = fabCfg.className;

    // Position
    const pos = fabCfg.position ?? 'bottom-right';
    const ox = fabCfg.offset?.x ?? 20;
    const oy = fabCfg.offset?.y ?? 24;
    if (pos.includes('top'))    btn.style.top = `calc(env(safe-area-inset-top, 0px) + ${oy}px)`;
    if (pos.includes('bottom')) btn.style.bottom = `calc(env(safe-area-inset-bottom, 0px) + ${oy}px)`;
    if (pos.includes('left'))   btn.style.left = `${ox}px`;
    if (pos.includes('right'))  btn.style.right = `${ox}px`;

    // Size + shape
    const size = fabCfg.size ?? 56;
    if (fabCfg.shape === 'pill') {
      btn.style.minWidth = `${size}px`;
      btn.style.height = `${size}px`;
      btn.style.borderRadius = `${size / 2}px`;
      btn.style.padding = '0 20px';
    } else {
      btn.style.width = `${size}px`;
      btn.style.height = `${size}px`;
      btn.style.borderRadius = fabCfg.shape === 'square' ? 'var(--dddk-radius, 12px)' : '50%';
    }

    // Icon content
    const inner = document.createElement('span');
    inner.style.display = 'inline-flex';
    inner.style.alignItems = 'center';
    inner.style.gap = '6px';
    inner.style.pointerEvents = 'none';
    if (fabCfg.icon instanceof HTMLElement) {
      inner.appendChild(fabCfg.icon);
    } else if (typeof fabCfg.icon === 'string') {
      // Allow either raw SVG/HTML or short text/emoji.
      if (fabCfg.icon.trim().startsWith('<')) inner.innerHTML = fabCfg.icon;
      else inner.textContent = fabCfg.icon;
    } else {
      inner.innerHTML = DEFAULT_FAB_SVG;
    }
    if (fabCfg.text) {
      const t = document.createElement('span');
      t.textContent = fabCfg.text;
      t.style.fontSize = '13px';
      t.style.fontWeight = '600';
      inner.appendChild(t);
    }
    btn.appendChild(inner);

    // Host-supplied style overrides (LAST so they always win).
    if (fabCfg.style) Object.assign(btn.style, fabCfg.style);

    // Behavior — use the existing bindTrigger machinery.
    document.body.appendChild(btn);
    this.fabEl = btn;
    this.bindTrigger(btn, { onTap: fabCfg.onTap, onLongPress: fabCfg.onLongPress });
  }

  /** Hide / show the default FAB at runtime. */
  setFabVisible(visible: boolean): void {
    if (this.fabEl) this.fabEl.style.display = visible ? '' : 'none';
  }

  /** Return the default FAB element (so hosts can decorate it further). */
  getFabElement(): HTMLButtonElement | null {
    return this.fabEl;
  }

  // ─── chrome construction ───────────────────────────────────────

  private mountChrome(): void {
    const top = document.createElement('div');
    top.setAttribute(UI_ATTR, 'mobile-top');
    top.innerHTML = `
      <button type="button" class="mt-palette" aria-label="Open command palette">
        <span aria-hidden>🔍</span>
        <span class="mt-text">Palette</span>
      </button>
      <button type="button" class="mt-close" aria-label="Close mobile chrome">✕</button>
    `;
    top.querySelector<HTMLButtonElement>('.mt-palette')!.onclick = () => {
      this.dddk?.palette.toggle();
    };
    top.querySelector<HTMLButtonElement>('.mt-close')!.onclick = () => this.hide();
    document.body.appendChild(top);
    this.topBar = top;

    const bottom = document.createElement('div');
    bottom.setAttribute(UI_ATTR, 'mobile-bottom');
    bottom.innerHTML = `<button type="button" class="mt-center" aria-label="Voice / accept / reject"></button>`;
    const center = bottom.querySelector<HTMLButtonElement>('.mt-center')!;
    this.bindCenterButton(center);
    document.body.appendChild(bottom);
    this.bottomBar = bottom;

    // Click-through interception: when chrome visible AND user opted in,
    // taps on page elements fire palette_open with the tapped element's
    // selector. Default OFF — most users want the page to stay normal.
    // Toggled via `setDwellOnTap(true)` at runtime.
    const onPageClick = (e: MouseEvent | TouchEvent) => {
      if (!this.visible) return;
      if (!this.dwellOnTap) return; // page taps work normally
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Skip our own chrome.
      if (target.closest(`[${UI_ATTR}="mobile-top"]`) || target.closest(`[${UI_ATTR}="mobile-bottom"]`)) return;
      e.preventDefault();
      e.stopPropagation();
      const selector = inferSelector(target) || null;
      this.dddk?.palette.toggle(selector ?? target.textContent ?? '');
    };
    document.addEventListener('click', onPageClick, true);
    this.cleanups.push(() => document.removeEventListener('click', onPageClick, true));
  }

  /**
   * Center button mimics desktop Space gesture:
   *   - single tap         → accept
   *   - double tap (< 350) → reject
   *   - long press (200ms) → voice_start
   */
  private bindCenterButton(btn: HTMLButtonElement): void {
    const dddk = this.dddk;
    if (!dddk) return;

    const press = () => {
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        document.dispatchEvent(new CustomEvent('dddk:mobile-voice-start'));
      }, this.cfg.longPressMs);
    };

    const release = () => {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
        // Wasn't long-press → it's a tap. Distinguish single vs double.
        const now = Date.now();
        if (now - this.lastTapAt < this.cfg.doubleTapMs) {
          // Double tap
          if (this.singleTapTimer) {
            clearTimeout(this.singleTapTimer);
            this.singleTapTimer = null;
          }
          this.lastTapAt = 0;
          document.dispatchEvent(new CustomEvent('dddk:mobile-reject'));
        } else {
          // Maybe single — wait the double window
          this.lastTapAt = now;
          this.singleTapTimer = setTimeout(() => {
            this.singleTapTimer = null;
            document.dispatchEvent(new CustomEvent('dddk:mobile-accept'));
          }, this.cfg.doubleTapMs);
        }
      } else {
        // Long-press already fired voice_start. Voice end signal.
        document.dispatchEvent(new CustomEvent('dddk:mobile-voice-end'));
      }
    };

    btn.addEventListener('touchstart', (e) => { e.preventDefault(); press(); }, { passive: false });
    btn.addEventListener('touchend',   (e) => { e.preventDefault(); release(); }, { passive: false });
    btn.addEventListener('mousedown',  press);
    btn.addEventListener('mouseup',    release);
    btn.addEventListener('mouseleave', () => {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
    });
  }

  // ─── swipe detector — rapid up/down reversals ───────────────────

  private bindSwipeDetector(): void {
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      this.samples = [{ y: t.clientY, t: Date.now(), dir: null }];
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      const now = Date.now();
      const last = this.samples[this.samples.length - 1];
      if (!last) return;
      const dy = t.clientY - last.y;
      if (Math.abs(dy) < this.cfg.minSwipeDelta) return;
      const dir: 'up' | 'down' = dy < 0 ? 'up' : 'down';
      this.samples.push({ y: t.clientY, t: now, dir });
      this.trimSamples(now);
      if (this.countReversals() >= this.cfg.reversalsToTrigger) {
        this.samples = [];
        this.toggle();
      }
    };

    const onTouchEnd = () => {
      this.samples = [];
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove',  onTouchMove,  { passive: true });
    document.addEventListener('touchend',   onTouchEnd,   { passive: true });

    this.cleanups.push(() => document.removeEventListener('touchstart', onTouchStart));
    this.cleanups.push(() => document.removeEventListener('touchmove',  onTouchMove));
    this.cleanups.push(() => document.removeEventListener('touchend',   onTouchEnd));
  }

  private trimSamples(now: number): void {
    const cutoff = now - this.cfg.swipeWindowMs;
    this.samples = this.samples.filter((s) => s.t >= cutoff);
  }

  /** Count direction reversals (up→down or down→up) in current sample buffer. */
  private countReversals(): number {
    let reversals = 0;
    let prev: 'up' | 'down' | null = null;
    for (const s of this.samples) {
      if (s.dir && prev && s.dir !== prev) reversals += 1;
      if (s.dir) prev = s.dir;
    }
    return reversals;
  }
}

// ─── helpers ────────────────────────────────────────────────────────

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
}

/**
 * Narrow viewport detection — mobile / tablet portrait. Independent of touch
 * capability so DevTools "responsive mode" on a desktop browser triggers it.
 */
function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px)').matches;
}

const DEFAULT_FAB_SVG = `
<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>
  <path d="M5 3v4M19 17v4M3 5h4M17 19h4"/>
</svg>
`.trim();

function ensureStyles(): void {
  injectScopedStyle(STYLE_ID, `
    /* Top semi-transparent bar */
    [${UI_ATTR}="mobile-top"] {
      position: fixed; top: 0; left: 0; right: 0;
      display: flex; align-items: center; justify-content: space-between;
      padding: env(safe-area-inset-top, 8px) 16px 8px 16px;
      background: var(--dddk-mobile-bar, rgba(255,255,255,0.78));
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--dddk-border, rgba(0,0,0,0.08));
      z-index: var(--dddk-z-bar, 9700);
      transform: translateY(-110%);
      transition: transform 0.25s cubic-bezier(0.2,0.8,0.2,1);
    }
    [${UI_ATTR}="mobile-top"][data-visible] { transform: translateY(0); }

    [${UI_ATTR}="mobile-top"] button {
      background: transparent; border: 0; cursor: pointer;
      font: inherit; color: var(--dddk-text, #18181b);
      padding: 8px 12px; border-radius: 8px;
      display: inline-flex; align-items: center; gap: 6px;
    }
    [${UI_ATTR}="mobile-top"] button:active {
      background: var(--dddk-accent-soft, rgba(139,115,85,0.12));
    }
    [${UI_ATTR}="mobile-top"] .mt-text { font-size: 13px; font-weight: 600; }
    [${UI_ATTR}="mobile-top"] .mt-close { font-size: 18px; line-height: 1; padding: 8px 14px; }

    /* Bottom semi-transparent bar with circular center button */
    [${UI_ATTR}="mobile-bottom"] {
      position: fixed; left: 0; right: 0; bottom: 0;
      display: flex; align-items: center; justify-content: center;
      padding: 12px 16px calc(env(safe-area-inset-bottom, 0px) + 12px) 16px;
      background: var(--dddk-mobile-bar, rgba(255,255,255,0.78));
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-top: 1px solid var(--dddk-border, rgba(0,0,0,0.08));
      z-index: var(--dddk-z-bar, 9700);
      transform: translateY(110%);
      transition: transform 0.25s cubic-bezier(0.2,0.8,0.2,1);
    }
    [${UI_ATTR}="mobile-bottom"][data-visible] { transform: translateY(0); }

    [${UI_ATTR}="mobile-bottom"] .mt-center {
      width: 64px; height: 64px; border-radius: 50%;
      background: var(--dddk-accent, #ec4899);
      border: 0; cursor: pointer;
      box-shadow: 0 6px 20px rgba(0,0,0,0.18);
      transition: transform 0.1s, box-shadow 0.15s;
    }
    [${UI_ATTR}="mobile-bottom"] .mt-center:active {
      transform: scale(0.92);
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }

    /* Floating Action Button (FAB) — default mobile entry point.
       Hosts can fully override via MobileFABConfig.style or by passing
       className and writing their own CSS. */
    [${UI_ATTR}="mobile-fab"] {
      position: fixed;
      z-index: var(--dddk-z-bar, 9700);
      background: var(--dddk-accent, #ec4899);
      color: var(--dddk-text-on-accent, #fff);
      border: 0;
      cursor: pointer;
      box-shadow: var(--dddk-shadow-md, 0 6px 20px rgba(0,0,0,0.18));
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font: inherit;
      transition: transform 0.1s ease-out, box-shadow 0.15s ease-out;
      -webkit-tap-highlight-color: transparent;
    }
    [${UI_ATTR}="mobile-fab"]:active {
      transform: scale(0.94);
      box-shadow: var(--dddk-shadow-sm, 0 2px 8px rgba(0,0,0,0.2));
    }
    [${UI_ATTR}="mobile-fab"]:focus-visible {
      outline: 2px solid var(--dddk-accent, #ec4899);
      outline-offset: 3px;
    }
    /* Hide FAB on real desktop only (wide viewport + mouse pointer).
       Touch devices in landscape still see it since they fail the hover:hover
       check. */
    @media (min-width: 769px) and (hover: hover) and (pointer: fine) {
      [${UI_ATTR}="mobile-fab"] {
        display: none;
      }
    }
  `);
}
