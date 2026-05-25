/**
 * Placement slots — the canonical screen positions every transient
 * dddk UI piece routes through.
 *
 * Slot names match `SurfacePlacement` from `skills/types` so callers
 * who already chose a placement (PanelSkill, SurfaceSkill, Proactive)
 * can pass it through unchanged.
 *
 * Apply with `applyPlacement(el, 'subtitle')` — the CSS selectors are
 * `[data-dddk-slot=...]`. The `Placements` class gives ergonomic
 * mount/unmount helpers.
 */

import { injectScopedStyle } from '../utils/dom';

export type PlacementSlot =
  | 'subtitle'   // center-bottom horizontal bar (text + buttons)
  | 'indicator'  // center-bottom small chip (sits above the subtitle bar)
  | 'palette'   // upper-center modal-like input panel
  | 'dock'      // persistent right-side panel
  | 'modal'     // full-screen centered with backdrop
  | 'banner'    // full-width top strip
  | 'fab'       // bottom-right floating action button
  | 'toast';    // top-center transient notification

export const PLACEMENT_ATTR = 'data-dddk-slot';
const STYLE_ID = 'dddk-placement-style';

const PLACEMENT_CSS = `
  /* Z-index ladder, low → high:
     fab(9200) < banner(9300) < dock(9400) < subtitle(9500) <
     indicator(9510) < palette(9600) < modal(9700) < toast(9800) */

  [${PLACEMENT_ATTR}="subtitle"] {
    position: fixed;
    left: 50%;
    bottom: var(--dddk-bar-bottom, 24px);
    transform: translateX(-50%);
    max-width: var(--dddk-bar-max-width, 720px);
    width: calc(100% - 48px);
    z-index: var(--dddk-z-bar, 9500);
    box-sizing: border-box;
  }

  [${PLACEMENT_ATTR}="indicator"] {
    position: fixed;
    left: 50%;
    bottom: var(--dddk-indicator-bottom, 88px);
    transform: translateX(-50%);
    z-index: calc(var(--dddk-z-bar, 9500) + 10);
    box-sizing: border-box;
  }

  [${PLACEMENT_ATTR}="palette"] {
    position: fixed;
    top: var(--dddk-palette-top, 12%);
    left: 50%;
    transform: translateX(-50%);
    width: min(var(--dddk-palette-max-width, 640px), 92vw);
    z-index: var(--dddk-z-palette, 9600);
    box-sizing: border-box;
  }

  [${PLACEMENT_ATTR}="dock"] {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    width: min(var(--dddk-dock-width, 380px), 92vw);
    z-index: var(--dddk-z-dock, 9400);
    box-sizing: border-box;
  }

  [${PLACEMENT_ATTR}="modal"] {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--dddk-modal-backdrop, rgba(0, 0, 0, 0.5));
    z-index: var(--dddk-z-modal, 9700);
  }

  [${PLACEMENT_ATTR}="banner"] {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: var(--dddk-z-banner, 9300);
    box-sizing: border-box;
  }

  [${PLACEMENT_ATTR}="fab"] {
    position: fixed;
    right: var(--dddk-fab-right, 18px);
    bottom: var(--dddk-fab-bottom, 22px);
    z-index: var(--dddk-z-fab, 9200);
  }

  [${PLACEMENT_ATTR}="toast"] {
    position: fixed;
    top: var(--dddk-toast-top, 24px);
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--dddk-z-toast, 9800);
    box-sizing: border-box;
  }
`;

let stylesEnsured = false;
export function ensurePlacementStyles(): void {
  if (stylesEnsured) return;
  stylesEnsured = true;
  injectScopedStyle(STYLE_ID, PLACEMENT_CSS);
}

/**
 * Tag an element with the slot attribute so it inherits the slot's CSS.
 * The element must already be (or will be) in the DOM — placement does
 * not append it.
 */
export function applyPlacement(el: HTMLElement, slot: PlacementSlot): void {
  ensurePlacementStyles();
  el.setAttribute(PLACEMENT_ATTR, slot);
}

/** Strip any slot attribute. */
export function clearPlacement(el: HTMLElement): void {
  el.removeAttribute(PLACEMENT_ATTR);
}

/**
 * Mount handle returned by `Placements.mount()` — unmount with `.unmount()`,
 * swap content with `.update(html)`.
 */
export interface PlacementHandle {
  readonly el: HTMLElement;
  readonly slot: PlacementSlot;
  update(html: string): void;
  unmount(): void;
}

/**
 * Convenience class for hosts that want to drop custom content into a
 * placement slot without writing the boilerplate. Owns one element per
 * mount; multiple mounts into the same slot stack as siblings (the CSS
 * does not enforce single-occupancy — callers decide).
 *
 *   const handle = dddk.placement.mount('subtitle', `<div>Hi</div>`);
 *   // ... later:
 *   handle.unmount();
 */
export class Placements {
  mount(slot: PlacementSlot, content: string | HTMLElement): PlacementHandle {
    ensurePlacementStyles();
    const wrap = document.createElement('div');
    wrap.setAttribute(PLACEMENT_ATTR, slot);
    if (typeof content === 'string') {
      wrap.innerHTML = content;
    } else {
      wrap.appendChild(content);
    }
    document.body.appendChild(wrap);
    return {
      el: wrap,
      slot,
      update: (html: string) => { wrap.innerHTML = html; },
      unmount: () => { wrap.remove(); },
    };
  }
}
