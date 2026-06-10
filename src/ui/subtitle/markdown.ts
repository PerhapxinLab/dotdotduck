/** Subtitle markdown — `**bold**` / `*italic*` / `` `code` `` /
 *  `- list` / `1. list` / bare URL autolink / `\n` line breaks.
 *  Headings / blockquotes / tables / images pass through as text.
 *  No marked.js dep — subtitle module stays under 30KB. */

import { escapeHtml } from '../../utils/dom';

// Escape FIRST, then run pattern subs on the escaped string —
// otherwise `<script>` could sneak in via a markdown pattern.
export function renderInlineMarkdown(raw: string): string {
  let html = escapeHtml(raw);

  // Lists run before inline subs because markers anchor at line start.
  html = html.replace(
    /(?:^|\n)((?:[-*]\s.+\n?)+)/g,
    (_match, group: string) => {
      const items = group
        .trim()
        .split('\n')
        .map((line) => line.replace(/^[-*]\s+/, ''))
        .map((item) => `<li>${item.trim()}</li>`)
        .join('');
      return `\n<ul>${items}</ul>`;
    },
  );
  html = html.replace(
    /(?:^|\n)((?:\d+\.\s.+\n?)+)/g,
    (_match, group: string) => {
      const items = group
        .trim()
        .split('\n')
        .map((line) => line.replace(/^\d+\.\s+/, ''))
        .map((item) => `<li>${item.trim()}</li>`)
        .join('');
      return `\n<ol>${items}</ol>`;
    },
  );

  // Inline code first — its content shouldn't be re-processed for bold/italic.
  // Stash via placeholder, restore after the bold/italic/link passes.
  const codeSpans: string[] = [];
  html = html.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codeSpans.push(code);
    return `\x00CODE${codeSpans.length - 1}\x00`;
  });

  // **bold** / __bold__ before *italic* / _italic_ so doubled markers
  // don't get half-matched.
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '<em>$1</em>');
  html = html.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '<em>$1</em>');

  // Bare URL autolink. Strict tail to avoid eating trailing punctuation.
  html = html.replace(
    /(https?:\/\/[^\s<]+[^\s<.,!?])/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  html = html.replace(/\x00CODE(\d+)\x00/g, (_m, idx: string) => {
    return `<code>${codeSpans[Number(idx)] ?? ''}</code>`;
  });

  // Line breaks last — after lists, so list \n's are already consumed.
  html = html.replace(/\n/g, '<br>');

  return html;
}
