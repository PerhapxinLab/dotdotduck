/** Split long text into space-advanced pages, format the N/M hint,
 *  render the current page into the bar. */

import type { SubtitleShowOptions } from '../../types';
import { escapeHtml, UI_ATTR } from '../../utils/dom';
import type { Subtitle } from './index';
import { renderInlineMarkdown } from './markdown';
import { renderHints } from './touch';

/** Chunks ≤ maxChars, broken on sentence boundaries
 *  (`. ! ? 。 ！ ？`) or paragraph breaks. Falls back to hard cut at
 *  maxChars when no boundary exists in the window. */
export function splitIntoPages(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars);
    // Paragraph break preferred — best read-aloud rhythm.
    let cut = window.lastIndexOf('\n\n');
    if (cut < maxChars * 0.3) {
      const marks = ['. ', '! ', '? ', '。', '！', '？', '\n'];
      for (const m of marks) {
        const idx = window.lastIndexOf(m);
        if (idx > cut) cut = idx + m.length;
      }
    } else {
      cut += 2;
    }
    if (cut < maxChars * 0.3) cut = maxChars;
    out.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) out.push(remaining);
  return out.length > 0 ? out : [text];
}

/** Returns HTML directly — caller's startsWith check inlines it
 *  without escaping. Both intermediate and last pages carry the exit
 *  hint so double-space-to-exit is always visible mid-tour. */
export function formatPageHint(
  host: Subtitle,
  idx: number,
  total: number,
  isLast: boolean,
): string {
  const zh = host._locale === 'zh-TW';
  const counter = `${idx}/${total}`;
  const action = isLast
    ? (zh ? 'space 下一步 ｜ 兩下 space 直接結束' : 'space → next · double space → exit')
    : (zh ? 'space → 下一段 ｜ 兩下 space 直接結束' : 'space → next page · double space → exit');
  return (
    `<div ${UI_ATTR}="bar-hints" style="display:flex;justify-content:space-between;gap:16px;">`
    + `<span>${counter}</span>`
    + `<span>${escapeHtml(action)}</span>`
    + `</div>`
  );
}

/** Intermediate pages strip onAccept/onReject so wireButtons doesn't
 *  expose actions mid-tour; the final page restores them. */
export function renderCurrentPage(host: Subtitle): void {
  if (!host._el || !host._currentOpts) return;
  const opts = host._currentOpts;
  const isPaged = host._pages !== null;
  const isLastPage = !isPaged || host._pageIdx === host._pages!.length - 1;
  const pageText = isPaged ? host._pages![host._pageIdx]! : opts.text;

  const effectiveOpts: SubtitleShowOptions = isLastPage
    ? opts
    : { ...opts, onAccept: undefined, onReject: undefined, onCopy: undefined };

  const pageHint = isPaged
    ? formatPageHint(host, host._pageIdx + 1, host._pages!.length, isLastPage)
    : '';
  const hints = pageHint
    || (isLastPage ? renderHints(host, effectiveOpts) : '');

  host._el.setAttribute('data-dddk-bar-type', opts.type);
  host._el.innerHTML = host._wrapBarShell(`
    <div ${UI_ATTR}="bar-text">${renderInlineMarkdown(pageText)}</div>
    ${hints.startsWith(`<div ${UI_ATTR}="bar-hints"`) ? hints : (hints ? `<div ${UI_ATTR}="bar-hints">${escapeHtml(hints)}</div>` : '')}
    ${host._renderButtons(effectiveOpts)}
  `);
  host._wireButtons(effectiveOpts);
  host._wireClose();
}
