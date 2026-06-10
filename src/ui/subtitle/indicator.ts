/** Listening / processing / done status pip. Subtitle takes priority:
 *  if the bar is up, `showIndicator` queues into `_pendingIndicator`
 *  and `hide()` materialises it when the bar goes away. */

import { escapeHtml, UI_ATTR } from '../../utils/dom';
import { applyPlacement } from '../placement';
import type { Subtitle } from './index';
import { ensureStyles } from './styles';

export function showIndicator(
  host: Subtitle,
  state: 'listening' | 'processing' | 'done',
  label?: string,
): void {
  // Subtitle takes priority — stacking a "thinking…" pip on top of an
  // actionable bar was confusing (indicator drawn over reply text).
  // Queue and let `hide()` surface it later.
  if (host._el) {
    host._pendingIndicator = { state, label };
    return;
  }
  ensureStyles();
  if (!host._indicator) {
    host._indicator = document.createElement('div');
    host._indicator.setAttribute(UI_ATTR, 'indicator');
    applyPlacement(host._indicator, 'indicator');
    document.body.appendChild(host._indicator);
  }
  host._indicator.setAttribute('data-state', state);
  // Done state swaps the bouncing dots for a static check — no motion
  // implies "finished, not waiting on anything".
  const visual = state === 'done'
    ? `<div ${UI_ATTR}="indicator-check">✓</div>`
    : `<div ${UI_ATTR}="indicator-dots"><span></span><span></span><span></span></div>`;
  host._indicator.innerHTML = `
    ${visual}
    ${label ? `<div ${UI_ATTR}="indicator-label">${escapeHtml(label)}</div>` : ''}
  `;
}

export function hideIndicator(host: Subtitle): void {
  host._indicator?.remove();
  host._indicator = null;
  // Explicit hide means "STOP showing it", not "tuck it away" — drop
  // the pending buffer so the next subtitle hide doesn't re-summon a
  // stale indicator.
  host._pendingIndicator = null;
}

export function resolveRunningLabel(host: Subtitle): string | undefined {
  if (host._runningLabel) return host._runningLabel;
  // Locale-aware default; bundled `en` / `zh-TW`; anything else falls
  // back to English so the indicator never breaks on unknown locales.
  if (host._locale === 'zh-TW') return 'Agent 執行中…';
  return 'Agent running…';
}
