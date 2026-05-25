/**
 * DOM Reader — simplifies the visible page into ~2000 tokens of text for the LLM.
 * 詳細規劃見 ../../docs/01-architecture.md (DOM Reader section)
 */

import { inferSelector } from '../../utils/selector';

// Hard cap on the DOM summary fed to the LLM each turn. 6000 chars was
// adding ~1.5-2k input tokens that the model had to process before
// emitting the first byte — measurable TTFT regression. 3500 covers
// 95%+ of "what the user can see on screen" without bloating the prompt.
// Hosts that want more (large dashboards / canvases) can pass `maxLength`
// to `readDOM(opts)` directly.
const MAX_LENGTH = 3500;
const MAX_TEXT_PER_ITEM = 50;

const INTERACTIVE_TAGS = new Set([
  'A',
  'BUTTON',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'LABEL',
  'SUMMARY',
]);

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'SVG']);

export interface DomReadOptions {
  maxLength?: number;
  includeInvisible?: boolean;
  scope?: HTMLElement;
}

export function readDOM(opts: DomReadOptions = {}): string {
  if (typeof document === 'undefined') return '(no DOM available)';

  const maxLength = opts.maxLength ?? MAX_LENGTH;
  const scope = opts.scope ?? document.body;

  const lines: string[] = [];
  lines.push(`[title] ${truncate(document.title, 100)}`);
  lines.push(`[url] ${location.href}`);
  lines.push('');

  walk(scope, lines, opts.includeInvisible ?? false);

  let out = lines.join('\n');
  if (out.length > maxLength) {
    out = out.slice(0, maxLength) + '\n[...truncated]';
  }
  return out;
}

function walk(node: Element, lines: string[], includeInvisible: boolean): void {
  if (SKIP_TAGS.has(node.tagName)) return;

  if (!includeInvisible && !isVisible(node)) return;

  if (HEADING_TAGS.has(node.tagName)) {
    const text = textOf(node);
    if (text) lines.push(`[${node.tagName.toLowerCase()}${selectorOf(node)}] ${text}`);
  } else if (INTERACTIVE_TAGS.has(node.tagName)) {
    lines.push(formatInteractive(node));
  } else if (isModalLike(node)) {
    lines.push(`[modal${selectorOf(node)}]`);
  }

  for (const child of Array.from(node.children)) {
    walk(child, lines, includeInvisible);
  }
}

function formatInteractive(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const sel = selectorOf(el);

  switch (el.tagName) {
    case 'A': {
      const href = el.getAttribute('href') ?? '';
      return `[link@${href}${sel}] ${textOf(el)}`;
    }
    case 'BUTTON': {
      const disabled = (el as HTMLButtonElement).disabled ? ' disabled' : '';
      return `[button${sel}${disabled}] ${textOf(el)}`;
    }
    case 'INPUT': {
      const input = el as HTMLInputElement;
      const type = input.type || 'text';
      const placeholder = input.placeholder ? ` placeholder="${truncate(input.placeholder, 30)}"` : '';
      const value = input.value ? ` value="${truncate(input.value, 30)}"` : '';
      return `[input${sel} type=${type}${placeholder}${value}]`;
    }
    case 'SELECT': {
      const select = el as HTMLSelectElement;
      const opts = Array.from(select.options).map((o) => o.text).slice(0, 8).join(' | ');
      return `[select${sel}] options: ${truncate(opts, 100)}`;
    }
    case 'TEXTAREA': {
      const ta = el as HTMLTextAreaElement;
      const placeholder = ta.placeholder ? ` placeholder="${truncate(ta.placeholder, 30)}"` : '';
      return `[textarea${sel}${placeholder}]`;
    }
    default:
      return `[${tag}${sel}] ${textOf(el)}`;
  }
}

function selectorOf(el: Element): string {
  return inferSelector(el, { asAttribute: true });
}

function textOf(el: Element): string {
  return truncate((el.textContent ?? '').trim().replace(/\s+/g, ' '), MAX_TEXT_PER_ITEM);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function isVisible(el: Element): boolean {
  const html = el as HTMLElement;
  if (html.offsetParent === null && html.tagName !== 'BODY') {
    return false;
  }
  const rect = html.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isModalLike(el: Element): boolean {
  const role = el.getAttribute('role');
  if (role === 'dialog' || role === 'alertdialog') return true;
  const aria = el.getAttribute('aria-modal');
  return aria === 'true';
}
