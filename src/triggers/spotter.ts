/**
 * Spotter — pointer follow + deictic lock + region lasso.
 * See ../../docs/04-spotter.md for the full design.
 */

import { inferSelector } from '../utils/selector';
import { injectScopedStyle, UI_ATTR } from '../utils/dom';

const RING_DELAY_MS = 200;
const MIN_LASSO_PX = 5;
const STYLE_ID = 'dddk-spotter-style';

export type SpotterState = 'idle' | 'ring' | 'lock' | 'lasso';

export interface SpotterOptions {
  ringDelay?: number;
  enableLasso?: boolean;
  enableRing?: boolean;
  /** Elements with this selector are ignored (e.g. dddk's own UI). */
  ignoreSelector?: string;
  onRingShow?: (info: { selector: string; element: HTMLElement; rect: DOMRect }) => void;
  onRingHide?: () => void;
  onLock?: (info: { selector: string; element: HTMLElement }) => void;
  onLassoComplete?: (info: {
    elements: HTMLElement[];
    bounds: DOMRect;
  }) => void;
}

export class Spotter {
  private state: SpotterState = 'idle';
  private opts: Required<Pick<SpotterOptions, 'ringDelay' | 'enableLasso' | 'enableRing'>> &
    SpotterOptions;

  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHoverElement: HTMLElement | null = null;
  private lastHoverPos = { x: 0, y: 0 };

  private ringEl: HTMLElement | null = null;
  private lassoEl: HTMLElement | null = null;
  private lassoStart: { x: number; y: number } | null = null;
  private lockedElement: HTMLElement | null = null;

  private cleanups: Array<() => void> = [];

  constructor(opts: SpotterOptions = {}) {
    this.opts = {
      ringDelay: RING_DELAY_MS,
      enableLasso: true,
      enableRing: true,
      ...opts,
    };
  }

  start(): void {
    if (typeof document === 'undefined') return;
    ensureStyles();

    const onMove = (e: MouseEvent) => this.handleMove(e);
    document.addEventListener('mousemove', onMove);
    this.cleanups.push(() => document.removeEventListener('mousemove', onMove));
  }

  destroy(): void {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.hideRing();
    this.endLasso(false);
    this.state = 'idle';
  }

  getState(): SpotterState {
    return this.state;
  }

  /**
   * Called by GestureManager when user starts a long-press while
   * something is hovered. If ring is shown → lock. Otherwise → just signal voice mode.
   */
  lockCurrent(): { selector: string; element: HTMLElement } | null {
    if (!this.opts.enableRing) return null;
    if (!this.lastHoverElement) return null;
    if (this.shouldIgnore(this.lastHoverElement)) return null;

    this.state = 'lock';
    this.lockedElement = this.lastHoverElement;
    const selector = inferSelector(this.lockedElement);
    this.opts.onLock?.({ selector, element: this.lockedElement });
    return { selector, element: this.lockedElement };
  }

  /** Start drawing a lasso from current pointer position. */
  beginLasso(startX: number, startY: number): void {
    if (!this.opts.enableLasso) return;
    this.state = 'lasso';
    this.lassoStart = { x: startX, y: startY };
    this.lassoEl = document.createElement('div');
    this.lassoEl.setAttribute(UI_ATTR, 'spotter-lasso');
    this.lassoEl.style.left = `${startX}px`;
    this.lassoEl.style.top = `${startY}px`;
    document.body.appendChild(this.lassoEl);
  }

  updateLasso(x: number, y: number): void {
    if (!this.lassoEl || !this.lassoStart) return;
    const left = Math.min(this.lassoStart.x, x);
    const top = Math.min(this.lassoStart.y, y);
    const w = Math.abs(x - this.lassoStart.x);
    const h = Math.abs(y - this.lassoStart.y);
    this.lassoEl.style.left = `${left}px`;
    this.lassoEl.style.top = `${top}px`;
    this.lassoEl.style.width = `${w}px`;
    this.lassoEl.style.height = `${h}px`;
  }

  endLasso(commit: boolean): { elements: HTMLElement[]; bounds: DOMRect } | null {
    if (!this.lassoEl || !this.lassoStart) return null;

    const result = commit ? this.collectLassoElements() : null;
    this.lassoEl.remove();
    this.lassoEl = null;
    this.lassoStart = null;
    this.state = 'idle';

    if (result) this.opts.onLassoComplete?.(result);
    return result;
  }

  unlock(): void {
    this.lockedElement = null;
    this.state = 'idle';
    this.hideRing();
  }

  // ─── private ────────────────────────────────────────────────────

  private handleMove(e: MouseEvent): void {
    if (this.state === 'lasso') {
      this.updateLasso(e.pageX, e.pageY);
      return;
    }

    this.lastHoverPos = { x: e.pageX, y: e.pageY };

    const target = e.target as HTMLElement | null;
    if (!target || target === this.lastHoverElement) return;

    // Hovering changed → cancel timer, hide ring, restart.
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    if (this.state === 'ring') this.hideRing();

    if (!this.opts.enableRing) return;
    if (this.shouldIgnore(target)) return;

    this.lastHoverElement = target;
    this.hoverTimer = setTimeout(() => {
      if (this.lastHoverElement !== target) return;
      this.showRing(target);
    }, this.opts.ringDelay);
  }

  private showRing(el: HTMLElement): void {
    this.state = 'ring';
    const rect = el.getBoundingClientRect();
    if (!this.ringEl) {
      this.ringEl = document.createElement('div');
      this.ringEl.setAttribute(UI_ATTR, 'spotter-ring');
      document.body.appendChild(this.ringEl);
    }
    this.ringEl.style.left = `${rect.left + window.scrollX}px`;
    this.ringEl.style.top = `${rect.top + window.scrollY}px`;
    this.ringEl.style.width = `${rect.width}px`;
    this.ringEl.style.height = `${rect.height}px`;
    this.ringEl.style.display = 'block';

    const selector = inferSelector(el);
    this.opts.onRingShow?.({ selector, element: el, rect });
  }

  private hideRing(): void {
    if (this.ringEl) {
      this.ringEl.style.display = 'none';
    }
    if (this.state === 'ring') this.state = 'idle';
    this.opts.onRingHide?.();
  }

  private collectLassoElements(): { elements: HTMLElement[]; bounds: DOMRect } | null {
    if (!this.lassoEl || !this.lassoStart) return null;

    const rect = this.lassoEl.getBoundingClientRect();
    if (rect.width < MIN_LASSO_PX || rect.height < MIN_LASSO_PX) return null;

    const elements: HTMLElement[] = [];
    // Lasso runs once on mouseup, so an O(n) full-DOM walk is acceptable.
    document.body.querySelectorAll<HTMLElement>('*').forEach((el) => {
      if (this.shouldIgnore(el)) return;
      const r = el.getBoundingClientRect();
      if (
        r.left >= rect.left &&
        r.right <= rect.right &&
        r.top >= rect.top &&
        r.bottom <= rect.bottom &&
        r.width > 0 &&
        r.height > 0
      ) {
        elements.push(el);
      }
    });

    return { elements, bounds: rect };
  }

  private shouldIgnore(el: HTMLElement): boolean {
    if (el.closest(`[${UI_ATTR}]`)) return true;
    if (this.opts.ignoreSelector && el.closest(this.opts.ignoreSelector)) return true;
    return false;
  }
}

// ─── helpers ────────────────────────────────────────────────────────

function ensureStyles(): void {
  injectScopedStyle(STYLE_ID, `
    [${UI_ATTR}="spotter-ring"] {
      position: absolute; pointer-events: none;
      z-index: var(--dddk-z-pointer, 9800);
      border: 2px solid var(--dddk-accent, #ec4899);
      border-radius: var(--dddk-radius, 12px);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--dddk-accent, #ec4899) 20%, transparent);
      transition: all 80ms ease-out;
      animation: dddk-ring-pulse 2s ease-in-out infinite;
      display: none;
    }
    [${UI_ATTR}="spotter-lasso"] {
      position: absolute; pointer-events: none;
      z-index: var(--dddk-z-pointer, 9800);
      border: 2px dashed var(--dddk-accent, #ec4899);
      background: color-mix(in srgb, var(--dddk-accent, #ec4899) 15%, transparent);
      border-radius: 4px;
    }
    @keyframes dddk-ring-pulse {
      0%, 100% { opacity: 0.8; }
      50%      { opacity: 1.0; }
    }
  `);
}
