/**
 * Screenshot capture mode — host-rendered crosshair overlay + drag rect.
 * The palette's camera button delegates here when `camera.mode === 'screenshot'`.
 *
 * No `getDisplayMedia` — we hand the host a viewport rect and they turn it
 * into a Blob (typically via html2canvas / modern-screenshot in their bundle).
 */

import { sdkString } from '../../utils/sdk-i18n';
import type { CameraOptions, PaletteAttachment } from './types';
import { UI_ATTR } from './styles';

/**
 * Host adapter — the screenshot module only needs three handles on the
 * palette instance: the backdrop root (to dim while the overlay is up),
 * the chrome locale (to label the hint), and the queue-attachment method.
 */
export interface ScreenshotHost {
  /** The palette's root backdrop element — null when the palette is closed. */
  getRoot(): HTMLDivElement | null;
  /** Current chrome locale, forwarded to the hint i18n string. */
  getLocale(): string | undefined;
  /** Adds the captured blob to the palette context (renders a chip). */
  addAttachment(att: Omit<PaletteAttachment, 'id'>): PaletteAttachment;
}

/**
 * Screenshot UX (re-implemented — no `getDisplayMedia`):
 *  1. Hide the palette panel (kept in DOM so re-opening is fast)
 *  2. Show a fullscreen crosshair overlay
 *  3. User drags a rectangle on the visible page
 *  4. Pass the rect to the host's `captureRect()` — host returns a Blob
 *  5. Attach the Blob, re-show the palette
 *
 * Esc / right-click / outside-mousedown cancels at any point.
 */
export function openScreenshot(host: ScreenshotHost, cfg: CameraOptions): void {
  if (!cfg.captureRect) {
    console.warn('[palette] screenshot mode requires a `captureRect` callback (e.g. via html2canvas).');
    return;
  }
  if (typeof document === 'undefined') return;
  const root = host.getRoot();
  if (!root) return;

  // Stash the panel so we can hide-then-restore without losing state.
  const panel = root.querySelector<HTMLElement>(`[${UI_ATTR}="palette"]`);
  if (panel) panel.style.visibility = 'hidden';
  root.style.background = 'transparent';
  root.style.backdropFilter = 'none';

  const overlay = document.createElement('div');
  overlay.setAttribute(UI_ATTR, 'palette-screenshot-overlay');
  const hintText = sdkString(host.getLocale(), 'palette.screenshot.hint');
  overlay.innerHTML = `
    <div data-dddk-ui="palette-screenshot-rect"></div>
    <div data-dddk-ui="palette-screenshot-hint">${hintText}</div>
  `;
  document.body.appendChild(overlay);
  const rectEl = overlay.querySelector<HTMLElement>('[data-dddk-ui="palette-screenshot-rect"]')!;

  let startX = 0, startY = 0;
  let dragging = false;
  let finalRect: { x: number; y: number; width: number; height: number } | null = null;

  const cleanup = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    if (panel) panel.style.visibility = '';
    const r = host.getRoot();
    if (r) {
      r.style.background = '';
      r.style.backdropFilter = '';
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    }
  };
  document.addEventListener('keydown', onKey, true);

  overlay.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    rectEl.style.display = 'block';
    rectEl.style.left = `${startX}px`;
    rectEl.style.top = `${startY}px`;
    rectEl.style.width = '0px';
    rectEl.style.height = '0px';
  });
  overlay.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    rectEl.style.left = `${x}px`;
    rectEl.style.top = `${y}px`;
    rectEl.style.width = `${w}px`;
    rectEl.style.height = `${h}px`;
  });
  overlay.addEventListener('mouseup', async (e) => {
    if (!dragging) return;
    dragging = false;
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    if (w < 8 || h < 8) {
      cleanup();
      return;
    }
    finalRect = { x, y, width: w, height: h };
    cleanup();
    try {
      const blob = await cfg.captureRect!(finalRect);
      if (!blob) return;
      host.addAttachment({
        kind: 'image',
        blob,
        thumbnailUrl: URL.createObjectURL(blob),
        source: 'screenshot',
        sourceUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        // No filename — UI doesn't show one; downstream agent gets the
        // source URL instead, which is more useful than `screenshot-12345`.
      });
      cfg.onCapture(blob, 'screenshot');
    } catch (err) {
      console.warn('[palette] screenshot captureRect failed:', err);
    }
  });
  // Right-click cancels.
  overlay.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cleanup();
  });
}
