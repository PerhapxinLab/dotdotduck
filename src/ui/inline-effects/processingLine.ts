// mountProcessingLine — a "AI is working" indicator anchored under a host-supplied
// rect (typically the line/selection being edited). Returns a handle with an
// `update(rect, label?)` to track scroll / resize and `dispose()` to tear down.
//
// Pure DOM, no framework dependency — perhapxin-enterprise (Svelte), Notion
// clones (React), plain HTML pages can all consume it.

import { ensureInlineEffectsStyles } from './styles';
import { UI_ATTR } from '../../utils/dom';

export interface ProcessingLineHandle {
  /** Re-anchor (call on scroll / resize). */
  update(rect: { left: number; top: number; bottom: number; width?: number }, label?: string): void;
  /** Remove the indicator. Idempotent. */
  dispose(): void;
}

export interface ProcessingLineOpts {
  /** "Processing", "AI 正在編輯⋯" etc. Default: 'Processing'. */
  label?: string;
  /** Element to mount into. Default: `document.body`. */
  host?: HTMLElement;
  /** Extra px below the anchor's bottom edge. Default 6. */
  gap?: number;
}

/**
 * Anchor a thin Processing indicator just below the rect — typically the
 * bounding box of the line / selection an AI action is operating on.
 *
 * The host is responsible for calling `.update()` on scroll / resize and
 * `.dispose()` once the AI returns. The indicator is non-interactive
 * (pointer-events: none) so it never steals clicks.
 */
export function mountProcessingLine(
  rect: { left: number; top: number; bottom: number; width?: number },
  opts: ProcessingLineOpts = {},
): ProcessingLineHandle {
  ensureInlineEffectsStyles();
  const host = opts.host ?? document.body;
  const gap = opts.gap ?? 6;

  const el = document.createElement('div');
  el.setAttribute(UI_ATTR, 'processing-line');

  const spinner = document.createElement('span');
  spinner.className = 'pl-spinner';
  const label = document.createElement('span');
  label.className = 'pl-label';
  label.textContent = opts.label ?? 'Processing';
  el.appendChild(spinner);
  el.appendChild(label);

  host.appendChild(el);

  const place = (r: typeof rect) => {
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    el.style.left = `${r.left + scrollX}px`;
    el.style.top = `${r.bottom + scrollY + gap}px`;
  };
  place(rect);

  let disposed = false;
  return {
    update(nextRect, nextLabel) {
      if (disposed) return;
      if (nextLabel !== undefined) label.textContent = nextLabel;
      place(nextRect);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      el.remove();
    },
  };
}
