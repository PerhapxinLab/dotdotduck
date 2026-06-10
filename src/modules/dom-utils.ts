/**
 * DOM utilities — in-page selection / element / scroll / clipboard helpers.
 * Because dddk runs inside the page the API returns live references
 * rather than serialised snapshots.
 */

import { inferSelector as sharedInferSelector } from '../utils/selector';

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'SVG', 'CANVAS',
]);

export interface SelectionInfo {
  text: string;
  html: string;
  rect: DOMRect | null;
  startContainer?: Node;
  endContainer?: Node;
  images: string[];
}

export interface ActiveElementInfo {
  tagName: string;
  selector: string;
  value?: string;
  selectionStart?: number;
  selectionEnd?: number;
  isContentEditable: boolean;
}

/** Get the current text/HTML selection along with its rect and inline images. */
export function getSelection(): SelectionInfo {
  if (typeof window === 'undefined') {
    return { text: '', html: '', rect: null, images: [] };
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return { text: '', html: '', rect: null, images: [] };
  }
  const range = sel.getRangeAt(0);
  const text = sel.toString().trim();
  const html = serializeRange(range);
  const rect = range.getBoundingClientRect();
  const images: string[] = [];
  range.cloneContents().querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (src) images.push(src);
  });
  return {
    text,
    html,
    rect,
    startContainer: range.startContainer,
    endContainer: range.endContainer,
    images,
  };
}

function serializeRange(range: Range): string {
  const div = document.createElement('div');
  div.appendChild(range.cloneContents());
  return div.innerHTML;
}

/** Get the currently focused element with helpful metadata. */
export function getActiveElement(): ActiveElementInfo | null {
  if (typeof document === 'undefined') return null;
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return null;
  const info: ActiveElementInfo = {
    tagName: el.tagName,
    selector: inferSelector(el),
    isContentEditable: el.isContentEditable,
  };
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    info.value = input.value;
    info.selectionStart = input.selectionStart ?? undefined;
    info.selectionEnd = input.selectionEnd ?? undefined;
  }
  return info;
}

export type PageContentFormat = 'text' | 'html' | 'markdown';

/** Get the page content. `markdown` mode runs a Readability-style pass. */
export function getPageContent(options: {
  format?: PageContentFormat;
  selector?: string;
} = {}): string {
  if (typeof document === 'undefined') return '';
  const format = options.format ?? 'text';
  const root = options.selector
    ? (document.querySelector(options.selector) as HTMLElement | null) ?? document.body
    : document.body;
  if (!root) return '';

  if (format === 'html') return root.innerHTML;
  if (format === 'text') return textOnly(root);
  return toMarkdown(root);
}

function textOnly(root: HTMLElement): string {
  const lines: string[] = [];
  walk(root, (el) => {
    if (SKIP_TAGS.has(el.tagName)) return false;
    const direct = directText(el);
    if (direct) lines.push(direct);
    return true;
  });
  return lines.join('\n').trim();
}

function toMarkdown(root: HTMLElement): string {
  const out: string[] = [];
  walk(root, (el) => {
    if (SKIP_TAGS.has(el.tagName)) return false;
    // For elements where we already absorbed children's text into the
    // markdown rendering (a / strong / b / em / i), stop descent so the
    // children don't get printed again.
    const absorbChildren =
      el.tagName === 'A' ||
      el.tagName === 'STRONG' || el.tagName === 'B' ||
      el.tagName === 'EM' || el.tagName === 'I';

    if (absorbChildren) {
      const full = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      if (!full) return false;
      if (el.tagName === 'A') {
        const a = el as HTMLAnchorElement;
        out.push(`[${full}](${a.href})`);
      } else if (el.tagName === 'STRONG' || el.tagName === 'B') {
        out.push(`**${full}**`);
      } else {
        out.push(`*${full}*`);
      }
      return false; // skip descending — text is already captured
    }

    const direct = directText(el);
    if (!direct) return true;
    switch (el.tagName) {
      case 'H1': out.push(`# ${direct}`); break;
      case 'H2': out.push(`## ${direct}`); break;
      case 'H3': out.push(`### ${direct}`); break;
      case 'H4': out.push(`#### ${direct}`); break;
      case 'H5': out.push(`##### ${direct}`); break;
      case 'H6': out.push(`###### ${direct}`); break;
      case 'LI': out.push(`- ${direct}`); break;
      case 'BLOCKQUOTE': out.push(`> ${direct}`); break;
      case 'CODE':
      case 'PRE': out.push('```\n' + direct + '\n```'); break;
      default: out.push(direct);
    }
    return true;
  });
  return out.join('\n\n').trim();
}

function walk(root: HTMLElement, visit: (el: HTMLElement) => boolean): void {
  const stack: HTMLElement[] = [root];
  while (stack.length) {
    const el = stack.pop()!;
    const recur = visit(el);
    if (recur) {
      const children = Array.from(el.children) as HTMLElement[];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
    }
  }
}

function directText(el: HTMLElement): string {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
  }
  return text.trim().replace(/\s+/g, ' ');
}

/** Current SPA route info (best-effort — uses location). */
export function getRoute(): { url: string; pathname: string; search: string; hash: string } {
  if (typeof location === 'undefined') {
    return { url: '', pathname: '', search: '', hash: '' };
  }
  return {
    url: location.href,
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
  };
}

/** Live observer for selector changes. Returns unsubscribe. */
export function observe(
  selector: string,
  callback: (element: HTMLElement | null) => void
): () => void {
  if (typeof MutationObserver === 'undefined') return () => {};
  let last: HTMLElement | null = document.querySelector(selector);
  callback(last);
  const observer = new MutationObserver(() => {
    const cur = document.querySelector<HTMLElement>(selector);
    if (cur !== last) {
      last = cur;
      callback(cur);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  return () => observer.disconnect();
}

// ─── helpers ────────────────────────────────────────────────────────

function inferSelector(el: HTMLElement): string {
  return sharedInferSelector(el);
}

// Aggregate export — `DOM.getSelection()` etc.
export const DOM = {
  getSelection,
  getActiveElement,
  getPageContent,
  getRoute,
  observe,
};
