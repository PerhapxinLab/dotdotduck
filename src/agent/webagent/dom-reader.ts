/**
 * DOM Reader — simplifies the visible page into compact text for the LLM.
 *
 * Goals:
 *  - Keep EVERY visible `<a href>` so the agent can navigate dynamically
 *    (sitemap is a hint, but not every host provides one and some links
 *    are runtime-generated).
 *  - Keep every interactive element the agent can act on.
 *  - Drop noise that bloats tokens without helping decisions:
 *      * hidden inputs / off-screen elements
 *      * duplicate links (same href + same text appearing more than once,
 *        common in nav + footer that repeat the same routes)
 *      * a heading whose text matches the link immediately above it
 *        (common nav pattern where the link IS the heading)
 *      * empty / whitespace-only nodes
 *
 * See ../../docs/01-architecture.md (DOM Reader section) for the full design.
 */

import { inferSelector } from '../../utils/selector';

const MAX_LENGTH = 3500;
const MAX_TEXT_PER_ITEM = 50;
const MAX_LINK_TEXT = 40;

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

  const ctx: WalkCtx = {
    seenLinks: new Set(),
    seenButtons: new Set(),
    lastLineWasLink: false,
    lastLinkText: '',
  };
  walk(scope, lines, opts.includeInvisible ?? false, ctx);

  let out = lines.join('\n');
  if (out.length > maxLength) {
    out = out.slice(0, maxLength) + '\n[...truncated]';
  }
  return out;
}

interface WalkCtx {
  /** href + text signature; second occurrence is skipped. */
  seenLinks: Set<string>;
  /** selector + text signature; second occurrence is skipped. */
  seenButtons: Set<string>;
  /** Was the most recently pushed line a link? Used to suppress a
   *  heading immediately after that repeats the link's text. */
  lastLineWasLink: boolean;
  lastLinkText: string;
}

function walk(
  node: Element,
  lines: string[],
  includeInvisible: boolean,
  ctx: WalkCtx,
): void {
  if (SKIP_TAGS.has(node.tagName)) return;
  if (!includeInvisible && !isVisible(node)) return;

  if (HEADING_TAGS.has(node.tagName)) {
    const text = textOf(node, MAX_TEXT_PER_ITEM);
    // Suppress a heading that just repeats the link text right above it
    // (common nav pattern: `<a><h2>Pricing</h2></a>` produces both a
    // [link] and a [h2] with identical text).
    if (text && !(ctx.lastLineWasLink && ctx.lastLinkText === text)) {
      lines.push(`[${node.tagName.toLowerCase()}${selectorOf(node)}] ${text}`);
      ctx.lastLineWasLink = false;
    }
  } else if (INTERACTIVE_TAGS.has(node.tagName)) {
    const formatted = formatInteractive(node, ctx);
    if (formatted) lines.push(formatted);
  } else if (isModalLike(node)) {
    lines.push(`[modal${selectorOf(node)}]`);
    ctx.lastLineWasLink = false;
  }

  for (const child of Array.from(node.children)) {
    walk(child, lines, includeInvisible, ctx);
  }
}

/**
 * Returns the formatted line, or '' to skip (deduped / hidden input).
 * Mutates `ctx` to track link / heading sequencing.
 */
function formatInteractive(el: Element, ctx: WalkCtx): string {
  const tag = el.tagName.toLowerCase();
  const sel = selectorOf(el);

  switch (el.tagName) {
    case 'A': {
      const href = el.getAttribute('href') ?? '';
      const text = textOf(el, MAX_LINK_TEXT);
      // Skip empty-text anchors (icon-only — rare but the LLM can't read
      // them anyway, and they bloat the dump).
      if (!text && !href) return '';
      const sig = `${href}|${text}`;
      if (ctx.seenLinks.has(sig)) return '';
      ctx.seenLinks.add(sig);
      ctx.lastLineWasLink = true;
      ctx.lastLinkText = text;
      return `[link@${href}${sel}] ${text}`;
    }
    case 'BUTTON': {
      const text = textOf(el, MAX_TEXT_PER_ITEM);
      const sig = `${sel}|${text}`;
      if (ctx.seenButtons.has(sig)) return '';
      ctx.seenButtons.add(sig);
      const disabled = (el as HTMLButtonElement).disabled ? ' disabled' : '';
      ctx.lastLineWasLink = false;
      return `[button${sel}${disabled}] ${text}`;
    }
    case 'INPUT': {
      const input = el as HTMLInputElement;
      const type = input.type || 'text';
      // Hidden inputs are state for the host, not actionable for the agent.
      if (type === 'hidden') return '';
      const placeholder = input.placeholder ? ` placeholder="${truncate(input.placeholder, 30)}"` : '';
      const value = input.value ? ` value="${truncate(input.value, 30)}"` : '';
      ctx.lastLineWasLink = false;
      return `[input${sel} type=${type}${placeholder}${value}]`;
    }
    case 'SELECT': {
      const select = el as HTMLSelectElement;
      const opts = Array.from(select.options).map((o) => o.text).slice(0, 8).join(' | ');
      ctx.lastLineWasLink = false;
      return `[select${sel}] options: ${truncate(opts, 100)}`;
    }
    case 'TEXTAREA': {
      const ta = el as HTMLTextAreaElement;
      const placeholder = ta.placeholder ? ` placeholder="${truncate(ta.placeholder, 30)}"` : '';
      ctx.lastLineWasLink = false;
      return `[textarea${sel}${placeholder}]`;
    }
    default: {
      const text = textOf(el, MAX_TEXT_PER_ITEM);
      if (!text) return '';
      ctx.lastLineWasLink = false;
      return `[${tag}${sel}] ${text}`;
    }
  }
}

function selectorOf(el: Element): string {
  return inferSelector(el, { asAttribute: true });
}

function textOf(el: Element, max: number): string {
  return truncate((el.textContent ?? '').trim().replace(/\s+/g, ' '), max);
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
