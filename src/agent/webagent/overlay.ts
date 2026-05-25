/**
 * Visual overlays — highlight / border / spotlight / inject text on the page.
 * All overlay elements are tagged with data-webagent-overlay for easy cleanup.
 *
 * Repositioning: overlays auto-track their target element via a shared
 * MutationObserver + ResizeObserver + scroll listener. When the target's
 * bounding box changes (sticky-header reflow, scroll, virtualised list,
 * animation), the overlay repositions in-place rather than going stale.
 *
 * Auto-clear: overlays are wiped on `popstate` (history navigation) and
 * `beforeunload` (full page reload). dddk's orchestrator also clears them
 * on agent `done` / `error` for belt-and-braces cleanup.
 */

import type { OverlayItem, OverlayType } from './types';
import { injectScopedStyle } from '../../utils/inject-style';
import { genId } from '../../utils/id';

const OVERLAY_ATTR = 'data-webagent-overlay';
const STYLE_ID = 'webagent-overlay-style';
const SELECTOR_DS_KEY = 'overlaySelector';

const STYLE_CSS = `
  [${OVERLAY_ATTR}] { position: absolute; pointer-events: none; z-index: var(--webagent-z-overlay, 9800); }
  [${OVERLAY_ATTR}="highlight"] { background: var(--webagent-highlight, rgba(255, 235, 59, 0.4)); border-radius: var(--webagent-radius-xs, 4px); }
  [${OVERLAY_ATTR}="border"]    { border: 2px solid var(--webagent-overlay-border, #ff9800); border-radius: var(--webagent-radius-sm, 6px); }
  [${OVERLAY_ATTR}="spotlight"] { box-shadow: 0 0 0 9999px var(--webagent-spotlight, rgba(0,0,0,0.55)); border-radius: 8px; }
  [${OVERLAY_ATTR}="label"]     {
    padding: 4px 8px; background: var(--webagent-label-bg, #1a1a1a); color: var(--webagent-text-on-accent, #fff);
    font-size: var(--webagent-font-size-sm, 12px); border-radius: var(--webagent-radius-xs, 4px); pointer-events: none;
    font-family: var(--webagent-font, system-ui, sans-serif);
  }
  [${OVERLAY_ATTR}="inject"]    {
    padding: 6px 10px; background: var(--webagent-inject-bg, rgba(255,235,59,0.6));
    border-left: 3px solid var(--webagent-accent, #ff9800);
    font-family: var(--webagent-font, system-ui, sans-serif); font-size: 13px;
  }
`;

function ensureStyles(): void {
  injectScopedStyle(STYLE_ID, STYLE_CSS);
  ensureRepositioner();
}

// ─── Repositioner — keeps overlays glued to their targets ──────────

let repositionerInstalled = false;
let rafScheduled = false;

function scheduleRereposition(): void {
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(() => {
    rafScheduled = false;
    repositionAll();
  });
}

function repositionAll(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLElement>(`[${OVERLAY_ATTR}]`).forEach((ov) => {
    const selector = ov.dataset[SELECTOR_DS_KEY];
    if (!selector) return;
    const target = document.querySelector(selector);
    if (!target) {
      // Target gone (route nav / DOM swap) — drop the overlay.
      ov.remove();
      return;
    }
    // Labels are positioned relative to the target's top — handled below.
    const type = ov.getAttribute(OVERLAY_ATTR);
    if (type === 'label') {
      const rect = target.getBoundingClientRect();
      ov.style.left = `${rect.left + window.scrollX}px`;
      ov.style.top = `${rect.top + window.scrollY - 28}px`;
    } else if (type === 'inject') {
      // Inject is positioned INLINE (insertBefore) at attach time —
      // nothing to reposition geometrically. Skip.
    } else {
      position(ov, target);
    }
  });
}

function ensureRepositioner(): void {
  if (repositionerInstalled) return;
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  repositionerInstalled = true;

  // Scroll + resize + DOM-mutation triggers. We coalesce via rAF so a
  // burst (scroll → layout → repaint) only repositions once per frame.
  window.addEventListener('scroll', scheduleRereposition, true);
  window.addEventListener('resize', scheduleRereposition);
  const mo = new MutationObserver(scheduleRereposition);
  mo.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });

  // Auto-clear on history nav + full page reload. dddk's orchestrator
  // ALSO clears on agent done/error — these are belt-and-braces in case
  // the host bypasses dddk (uses webagent standalone).
  window.addEventListener('popstate', clearOverlays);
  window.addEventListener('beforeunload', clearOverlays);
}

function makeId(): string {
  return genId('ov');
}

function position(overlay: HTMLElement, target: Element): void {
  const rect = target.getBoundingClientRect();
  overlay.style.left = `${rect.left + window.scrollX}px`;
  overlay.style.top = `${rect.top + window.scrollY}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
}

export function highlight(selector: string, color?: string, label?: string): string {
  ensureStyles();
  const target = document.querySelector(selector);
  if (!target) return '';
  const id = makeId();
  const ov = document.createElement('div');
  ov.setAttribute(OVERLAY_ATTR, 'highlight');
  ov.dataset.overlayId = id;
  ov.dataset[SELECTOR_DS_KEY] = selector;
  if (color) ov.style.background = color;
  if (label) ov.dataset.overlayLabel = label;
  position(ov, target);
  document.body.appendChild(ov);
  if (label) attachLabel(target, label, id, selector);
  return id;
}

export function border(selector: string, color?: string, label?: string): string {
  ensureStyles();
  const target = document.querySelector(selector);
  if (!target) return '';
  const id = makeId();
  const ov = document.createElement('div');
  ov.setAttribute(OVERLAY_ATTR, 'border');
  ov.dataset.overlayId = id;
  ov.dataset[SELECTOR_DS_KEY] = selector;
  if (color) ov.style.borderColor = color;
  if (label) ov.dataset.overlayLabel = label;
  position(ov, target);
  document.body.appendChild(ov);
  if (label) attachLabel(target, label, id, selector);
  return id;
}

export function spotlight(selector: string): string {
  ensureStyles();
  const target = document.querySelector(selector);
  if (!target) return '';
  const id = makeId();
  const ov = document.createElement('div');
  ov.setAttribute(OVERLAY_ATTR, 'spotlight');
  ov.dataset.overlayId = id;
  ov.dataset[SELECTOR_DS_KEY] = selector;
  position(ov, target);
  document.body.appendChild(ov);
  return id;
}

export function inject(
  selector: string,
  text: string,
  position: 'before' | 'after' = 'after'
): string {
  ensureStyles();
  const target = document.querySelector(selector);
  if (!target) return '';
  const id = makeId();
  const node = document.createElement('div');
  node.setAttribute(OVERLAY_ATTR, 'inject');
  node.dataset.overlayId = id;
  node.dataset[SELECTOR_DS_KEY] = selector;
  node.dataset.overlayText = text;
  node.dataset.overlayPosition = position;
  node.textContent = text;
  if (position === 'before') {
    target.parentElement?.insertBefore(node, target);
  } else {
    target.parentElement?.insertBefore(node, target.nextSibling);
  }
  return id;
}

function attachLabel(target: Element, text: string, id: string, selector: string): void {
  const rect = target.getBoundingClientRect();
  const label = document.createElement('div');
  label.setAttribute(OVERLAY_ATTR, 'label');
  label.dataset.overlayId = `${id}_label`;
  label.dataset[SELECTOR_DS_KEY] = selector;
  label.textContent = text;
  label.style.left = `${rect.left + window.scrollX}px`;
  label.style.top = `${rect.top + window.scrollY - 28}px`;
  label.style.position = 'absolute';
  document.body.appendChild(label);
}

export function removeOverlay(id: string): void {
  document
    .querySelectorAll(`[${OVERLAY_ATTR}][data-overlay-id^="${id}"]`)
    .forEach((el) => el.remove());
}

export function clearOverlays(): void {
  document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach((el) => el.remove());
}

export function listOverlays(): OverlayItem[] {
  const items: OverlayItem[] = [];
  document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach((el) => {
    const html = el as HTMLElement;
    const id = html.dataset.overlayId;
    const type = el.getAttribute(OVERLAY_ATTR) as OverlayType | null;
    if (!id || !type) return;
    // Labels are tagged but are sub-items of their parent overlay; surface them
    // only if they carry their own primary selector (they do).
    const selector = html.dataset[SELECTOR_DS_KEY] ?? '';
    const item: OverlayItem = { id, type, selector };
    const label = html.dataset.overlayLabel;
    if (label) item.label = label;
    const text = html.dataset.overlayText;
    if (text) item.text = text;
    const pos = html.dataset.overlayPosition;
    if (pos === 'before' || pos === 'after') item.position = pos;
    items.push(item);
  });
  return items;
}
