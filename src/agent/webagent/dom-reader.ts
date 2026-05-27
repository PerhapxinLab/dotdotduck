/**
 * DOM Reader — indexed tabbed-tree serialiser.
 *
 * Every addressable element (interactive control, section-level
 * container, heading, image, code block) gets a monotonic numeric
 * index. The agent calls tools with that index directly
 * (`click("[3]")` / `border("[5]")`) — no CSS selectors, no
 * `:nth-of-type(4)`, no string-matching guesswork. The runtime keeps
 * an index→Element map for one turn and resolves indices on the next
 * tool dispatch.
 *
 * What gets indexed:
 *   - INTERACTIVE_TAGS — A, BUTTON, INPUT, SELECT, TEXTAREA, LABEL,
 *     SUMMARY, plus ANY element with an interactive ARIA role
 *     (button / link / tab / menuitem / option / checkbox / radio /
 *     switch / combobox / textbox / slider / spinbutton) or a
 *     keyboard-focusable tabindex with an accessible label.
 *   - HEADING_TAGS — H1..H6.
 *   - SECTION_TAGS — SECTION, ARTICLE, ASIDE, FIELDSET, MAIN, NAV,
 *     HEADER, FOOTER, HGROUP, TABLE, TR, FORM, DETAILS, DL, DIALOG.
 *     These also bump indentation so the tree shape is visible.
 *   - MEDIA_TAGS — IMG (emits alt text or filename hint).
 *   - PRE_TAGS — PRE (preserves newlines, capped).
 *
 * What gets emitted as flat content lines (no index):
 *   - NAMED_CONTENT_TAGS — P, LI, TD, TH, DT, DD, BLOCKQUOTE,
 *     FIGCAPTION, CAPTION, LEGEND, OUTPUT, METER, PROGRESS.
 *
 * What gets dropped entirely:
 *   - SKIP_TAGS — SCRIPT, STYLE, NOSCRIPT, TEMPLATE, IFRAME, SVG,
 *     CANVAS, SOURCE, TRACK, HEAD, META, LINK.
 *   - Elements with `class="dddk-skip"` or `data-dddk-skip` (host
 *     structural opt-out — site chrome, etc.).
 *   - Elements failing `isVisible` (display:none / visibility:hidden
 *     / zero box) — `display: contents` is a SPECIAL CASE: the wrapper
 *     has no box but children render, so we descend without depth bump.
 *
 * Output shape:
 *
 *   URL: https://example.com/commercial
 *   TITLE: Commercial — example
 *
 *   [1]<a href="/">Home</a>
 *   [2]<a href="/commercial">Commercial</a>
 *   [3]<section>
 *     <h1>Commercial cooperation</h1>
 *     <p>AGPL covers most teams …</p>
 *     [4]<section>
 *       01 · COMMERCIAL LICENSE
 *       <h2>Using dotdotduck in closed-source products</h2>
 *       <p>AGPL-3.0 requires …</p>
 *       <td>Personal</td>
 *       <td>Solo dev / <US$100K</td>
 *       <td>Free</td>
 *
 * Indentation is one tab per logical container (`<section>`,
 * `<article>`, `<aside>`, `<fieldset>`). Other wrappers (`<div>`,
 * `<span>`) don't add indentation — they're noise.
 *
 * Filtering opt-outs (and opt-ins) for hosts:
 *   - Element with class `dddk-skip` or attribute `data-dddk-skip`
 *     drops that element AND its subtree.
 *   - The `WebAgentConfig.domFilter` function applies on top of the
 *     class-based skip.
 */

const DEFAULT_MAX_LENGTH = 12000;
const MAX_TEXT_PER_ITEM = 120;
const MAX_LINK_TEXT = 80;
const MAX_CELL_TEXT = 160;

const INTERACTIVE_TAGS = new Set([
  'A',
  'BUTTON',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'LABEL',
  'SUMMARY',
]);

/** ARIA roles that turn any element (including `<div>` / `<span>`) into
 *  an interactive control. Custom widget libraries rely on these — without
 *  role-based detection the agent can't click their components. */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'checkbox',
  'radio',
  'switch',
  'combobox',
  'searchbox',
  'textbox',
  'slider',
  'spinbutton',
]);

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/** Tags whose text content is emitted directly as a labelled line. */
const NAMED_CONTENT_TAGS = new Set([
  'P',
  'LI',
  'TD',
  'TH',
  'DT',
  'DD',
  'BLOCKQUOTE',
  'FIGCAPTION',
  'CAPTION',
  'LEGEND',
  'OUTPUT',
  'METER',
  'PROGRESS',
]);

/** Media tags handled with their own emit shape (alt text / src). */
const MEDIA_TAGS = new Set(['IMG']);

/** Tags whose `textContent` should be emitted verbatim, preserving line
 *  breaks (capped). Used for code / preformatted content. */
const PRE_TAGS = new Set(['PRE']);

/**
 * Logical-group tags — emit a wrapper line + a numeric index so the
 * agent can border the whole group as one subject. These also bump
 * the indentation level for their descendants so structure is visible.
 *
 * `<tr>` is included so each table row is its own addressable subject
 * — without this, pricing / comparison tables collapse to a flat list
 * of `<td>` lines that the agent can't frame row-by-row.
 */
const SECTION_TAGS = new Set([
  'SECTION',
  'ARTICLE',
  'ASIDE',
  'FIELDSET',
  'MAIN',
  'NAV',
  'HEADER',
  'FOOTER',
  'HGROUP',
  'TABLE',
  'TR',
  'FORM',
  'DETAILS',
  'DL',
  'DIALOG',
]);

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'IFRAME',
  'SVG',
  'CANVAS',
  'SOURCE',
  'TRACK',
  'HEAD',
  'META',
  'LINK',
]);

export interface DomReadOptions {
  maxLength?: number;
  includeInvisible?: boolean;
  scope?: HTMLElement;
  /**
   * Host-supplied subtraction filter. Called for every visible element
   * the walker considers; return `false` to drop the element AND its
   * subtree.
   *
   * Composes on top of the built-in class-based skip (elements with
   * `class="dddk-skip"` or `data-dddk-skip` are always dropped — hosts
   * use those for fast structural opt-outs without writing a function).
   */
  filter?: (el: Element) => boolean;
}

export interface IndexedDomResult {
  /** Tab-indented text dump for the LLM. */
  text: string;
  /** Map from emitted index → live DOM element. Tool handlers look up
   *  here when the LLM passes an `[N]` index as the target. */
  indexMap: Map<number, Element>;
  /** Total bytes emitted (post-truncation). */
  bytes: number;
}

/**
 * Build the indexed-tabbed-tree dump + the index→element map for the
 * current document. Called once per agent turn — the map only needs to
 * live until the next tool dispatch, after which a fresh readDOM
 * overwrites it.
 */
export function readDOM(opts: DomReadOptions = {}): IndexedDomResult {
  if (typeof document === 'undefined') {
    return { text: '(no DOM available)', indexMap: new Map(), bytes: 0 };
  }

  const maxLength = opts.maxLength ?? DEFAULT_MAX_LENGTH;
  const scope = opts.scope ?? document.body;

  // Scroll context — tells the agent "what slice of the page is the user
  // looking at right now". The agent uses this to decide between bordering
  // an already-visible element vs. calling scroll_to first.
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
  const docHeight = typeof document !== 'undefined'
    ? Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
    : 0;
  const above = Math.round(scrollY);
  const below = Math.max(0, Math.round(docHeight - scrollY - vh));

  const lines: string[] = [];
  lines.push(`URL: ${location.href}`);
  lines.push(`TITLE: ${truncate(document.title, 100)}`);
  if (vh > 0 && docHeight > 0) {
    lines.push(`VIEWPORT: ${above}px above · ${vh}px visible · ${below}px below`);
  }
  lines.push('');

  const ctx: WalkCtx = {
    nextIndex: 1,
    indexMap: new Map(),
    seenLinkSigs: new Set(),
    seenContentSigs: new Set(),
    viewportTop: 0,
    viewportBottom: vh,
  };
  walk(scope, lines, 0, opts.includeInvisible ?? false, opts.filter, ctx);

  let out = lines.join('\n');
  if (out.length > maxLength) {
    out = out.slice(0, maxLength) + '\n[...truncated]';
  }

  // Debug exposure — devs can inspect window.__dddkDebug to see what
  // the agent saw at any given turn.
  if (typeof window !== 'undefined') {
    const w = window as unknown as {
      __dddkDebug?: { lastDom?: string; lastDomAt?: string; lastDomBytes?: number; lastIndexMap?: Map<number, Element> };
    };
    w.__dddkDebug = w.__dddkDebug ?? {};
    w.__dddkDebug.lastDom = out;
    w.__dddkDebug.lastDomAt = new Date().toISOString();
    w.__dddkDebug.lastDomBytes = out.length;
    w.__dddkDebug.lastIndexMap = ctx.indexMap;
  }

  return { text: out, indexMap: ctx.indexMap, bytes: out.length };
}

interface WalkCtx {
  nextIndex: number;
  indexMap: Map<number, Element>;
  /** href|text — second occurrence of the same link is skipped. */
  seenLinkSigs: Set<string>;
  /** tag|text — second occurrence of the same content line is skipped
   *  (kills duplicates from wrapper divs that emit the same text). */
  seenContentSigs: Set<string>;
  /** Viewport bounds in CSS px (relative to layout viewport). Used to
   *  prefix each emitted line with ↑ / ↓ when the element sits above /
   *  below what the user can currently see. */
  viewportTop: number;
  viewportBottom: number;
}

/**
 * Position of `node` relative to the current viewport:
 *   '↑' — above (user must scroll up to see it)
 *   ''  — at least partially in view
 *   '↓' — below (user must scroll down to see it)
 */
function viewportMarker(node: Element, ctx: WalkCtx): string {
  if (typeof window === 'undefined') return '';
  const rect = (node as HTMLElement).getBoundingClientRect();
  if (rect.bottom <= ctx.viewportTop) return '↑';
  if (rect.top >= ctx.viewportBottom) return '↓';
  return '';
}

function walk(
  node: Element,
  lines: string[],
  depth: number,
  includeInvisible: boolean,
  filter: ((el: Element) => boolean) | undefined,
  ctx: WalkCtx,
): void {
  if (SKIP_TAGS.has(node.tagName)) return;
  // Built-in class-based opt-out. Hosts use this for fast structural
  // skips — no filter function required.
  if (hasSkipMarker(node)) return;
  if (!includeInvisible && !isVisible(node)) return;
  if (filter && !filter(node)) return;

  const indent = depth > 0 ? '\t'.repeat(depth) : '';

  // `display: contents` — the element has no box, but its children
  // render normally. Descend WITHOUT increasing depth.
  if (typeof window !== 'undefined' && window.getComputedStyle(node).display === 'contents') {
    for (const child of Array.from(node.children)) walk(child, lines, depth, includeInvisible, filter, ctx);
    return;
  }

  // Interactive — by tag name OR by ARIA role. Custom widgets are
  // usually `<div role="button">`; without the role check, the agent
  // can't click them.
  if (INTERACTIVE_TAGS.has(node.tagName) || hasInteractiveRole(node)) {
    emitInteractive(node, lines, indent, ctx);
    return;
  }

  // Image — emit alt text (or filename fallback) so the agent can
  // narrate icons / illustrations / logos. Index it so the agent can
  // border specific images (e.g. "the duck logo top-left").
  if (MEDIA_TAGS.has(node.tagName)) {
    emitImage(node as HTMLImageElement, lines, indent, ctx);
    return;
  }

  // Preformatted / code block — emit textContent preserving newlines
  // (capped). Otherwise multi-line code collapses into one giant line
  // through the normal whitespace-squash path.
  if (PRE_TAGS.has(node.tagName)) {
    emitPre(node, lines, indent, ctx);
    return;
  }

  // Heading — emit with index so the agent can border / scroll_to it.
  if (HEADING_TAGS.has(node.tagName)) {
    const text = textOf(node, MAX_TEXT_PER_ITEM);
    if (text) {
      const idx = takeIndex(node, ctx);
      const v = viewportMarker(node, ctx);
      lines.push(`${indent}${v}[${idx}]<${node.tagName.toLowerCase()}>${text}</${node.tagName.toLowerCase()}>`);
    }
    return;
  }

  // Logical group — emit a wrapper line WITH index, then recurse with
  // depth + 1 so children visually nest underneath.
  if (SECTION_TAGS.has(node.tagName)) {
    const label = sectionLabel(node);
    const idx = takeIndex(node, ctx);
    const tag = node.tagName.toLowerCase();
    const v = viewportMarker(node, ctx);
    lines.push(`${indent}${v}[${idx}]<${tag}>${label ? ` ${label}` : ''}`);
    for (const child of Array.from(node.children)) {
      walk(child, lines, depth + 1, includeInvisible, filter, ctx);
    }
    return;
  }

  // Modal — emit marker + descend at same depth (modal contents are
  // important to read but don't deserve indentation).
  if (isModalLike(node)) {
    const idx = takeIndex(node, ctx);
    const v = viewportMarker(node, ctx);
    lines.push(`${indent}${v}[${idx}]<dialog>`);
    for (const child of Array.from(node.children)) {
      walk(child, lines, depth + 1, includeInvisible, filter, ctx);
    }
    return;
  }

  // Named content tag — emit text when leaf-like; otherwise recurse.
  if (NAMED_CONTENT_TAGS.has(node.tagName)) {
    if (!hasBlockDescendants(node)) {
      const cap = node.tagName === 'TD' || node.tagName === 'TH' ? MAX_CELL_TEXT : MAX_TEXT_PER_ITEM;
      const text = textOf(node, cap);
      if (text) {
        const sig = node.tagName + '|' + text;
        if (!ctx.seenContentSigs.has(sig)) {
          ctx.seenContentSigs.add(sig);
          lines.push(`${indent}<${node.tagName.toLowerCase()}>${text}</${node.tagName.toLowerCase()}>`);
        }
      }
      return;
    }
    // Has block descendants — recurse without depth bump.
  }

  // Generic visible element. If it's a leaf with text content, emit
  // as plain text. Otherwise recurse without bumping depth (most
  // intermediate divs / spans / wrappers are noise).
  if (!hasBlockDescendants(node)) {
    const text = textOf(node, MAX_TEXT_PER_ITEM);
    if (text) {
      const sig = node.tagName + '|' + text;
      if (!ctx.seenContentSigs.has(sig)) {
        ctx.seenContentSigs.add(sig);
        lines.push(`${indent}${text}`);
      }
      return;
    }
  }

  for (const child of Array.from(node.children)) {
    walk(child, lines, depth, includeInvisible, filter, ctx);
  }
}

/** Assign + record a new index for `node`. Tool handlers later look
 *  this up to resolve `[N]` references to real elements. */
function takeIndex(node: Element, ctx: WalkCtx): number {
  const idx = ctx.nextIndex++;
  ctx.indexMap.set(idx, node);
  return idx;
}

/** Last-resort accessible name for icon-only buttons / image-only links:
 *  aria-label → title → inner <img>'s alt → empty. */
function accessibleLabel(node: Element): string {
  const ariaLabel = node.getAttribute('aria-label');
  if (ariaLabel?.trim()) return truncate(ariaLabel.trim(), MAX_TEXT_PER_ITEM);
  const title = node.getAttribute('title');
  if (title?.trim()) return truncate(title.trim(), MAX_TEXT_PER_ITEM);
  const img = node.querySelector('img[alt]');
  if (img) {
    const alt = (img.getAttribute('alt') ?? '').trim();
    if (alt) return truncate(alt, MAX_TEXT_PER_ITEM);
  }
  return '';
}

function hasInteractiveRole(node: Element): boolean {
  const role = node.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;
  // tabindex>=0 on a non-native element strongly implies "this is
  // keyboard-focusable, treat it as interactive". Skip for native tags
  // that are already handled by INTERACTIVE_TAGS.
  if (!INTERACTIVE_TAGS.has(node.tagName)) {
    const ti = node.getAttribute('tabindex');
    if (ti !== null && parseInt(ti, 10) >= 0) {
      // Only count tabindex when there's a non-trivial accessible label —
      // otherwise we'd index every scrollable container.
      const label = (node as HTMLElement).getAttribute('aria-label')
        ?? (node.textContent ?? '').trim();
      if (label) return true;
    }
  }
  return false;
}

function emitImage(node: HTMLImageElement, lines: string[], indent: string, ctx: WalkCtx): void {
  const alt = (node.getAttribute('alt') ?? '').trim();
  const src = node.getAttribute('src') ?? '';
  // Decorative image with no alt and no useful src — drop.
  if (!alt && !src) return;
  const v = viewportMarker(node, ctx);
  const idx = takeIndex(node, ctx);
  if (alt) {
    lines.push(`${indent}${v}[${idx}]<img alt="${escapeAttr(truncate(alt, MAX_TEXT_PER_ITEM))}" />`);
  } else {
    // Strip URL down to a filename hint — full URLs are dump-bloating noise.
    const file = src.split('?')[0]!.split('#')[0]!.split('/').pop() ?? '';
    lines.push(`${indent}${v}[${idx}]<img src="${escapeAttr(truncate(file, 60))}" />`);
  }
}

function emitPre(node: Element, lines: string[], indent: string, ctx: WalkCtx): void {
  // Preserve newlines but cap so a 500-line code dump doesn't blow the
  // whole budget on one element.
  const raw = (node.textContent ?? '').replace(/\r\n/g, '\n');
  const PRE_MAX = 600;
  const text = raw.length > PRE_MAX ? raw.slice(0, PRE_MAX) + '\n…[pre truncated]' : raw;
  if (!text.trim()) return;
  const v = viewportMarker(node, ctx);
  const idx = takeIndex(node, ctx);
  // Re-indent each line so the block sits under the section that owns it.
  const indented = text.split('\n').map((l, i) => i === 0 ? l : indent + '  ' + l).join('\n');
  lines.push(`${indent}${v}[${idx}]<pre>${indented}</pre>`);
}

function emitInteractive(node: Element, lines: string[], indent: string, ctx: WalkCtx): void {
  const v = viewportMarker(node, ctx);
  switch (node.tagName) {
    case 'A': {
      const href = node.getAttribute('href') ?? '';
      const text = textOf(node, MAX_LINK_TEXT) || accessibleLabel(node);
      if (!text && !href) return;
      const sig = `${href}|${text}`;
      if (ctx.seenLinkSigs.has(sig)) return;
      ctx.seenLinkSigs.add(sig);
      const idx = takeIndex(node, ctx);
      lines.push(`${indent}${v}[${idx}]<a href="${escapeAttr(href)}">${text}</a>`);
      return;
    }
    case 'BUTTON': {
      const text = textOf(node, MAX_TEXT_PER_ITEM) || accessibleLabel(node);
      const disabled = (node as HTMLButtonElement).disabled ? ' disabled' : '';
      const idx = takeIndex(node, ctx);
      lines.push(`${indent}${v}[${idx}]<button${disabled}>${text || '(no label)'}</button>`);
      return;
    }
    case 'INPUT': {
      const input = node as HTMLInputElement;
      const type = input.type || 'text';
      if (type === 'hidden') return;
      const isSensitive = type === 'password' || type === 'tel';
      const attrs: string[] = [`type="${type}"`];
      if (input.placeholder) attrs.push(`placeholder="${escapeAttr(truncate(input.placeholder, 60))}"`);
      const liveValue = isSensitive
        ? (input.value ? '[redacted]' : '')
        : (input.value ? truncate(input.value, 200) : '');
      if (liveValue) attrs.push(`value="${escapeAttr(liveValue)}"`);
      const idx = takeIndex(node, ctx);
      lines.push(`${indent}${v}[${idx}]<input ${attrs.join(' ')} />`);
      return;
    }
    case 'SELECT': {
      const select = node as HTMLSelectElement;
      const opts = Array.from(select.options).map((o) => o.text).slice(0, 8).join(' | ');
      const idx = takeIndex(node, ctx);
      lines.push(`${indent}${v}[${idx}]<select>options: ${truncate(opts, 100)}</select>`);
      return;
    }
    case 'TEXTAREA': {
      const ta = node as HTMLTextAreaElement;
      const attrs: string[] = [];
      if (ta.placeholder) attrs.push(`placeholder="${escapeAttr(truncate(ta.placeholder, 60))}"`);
      const liveValue = ta.value ? truncate(ta.value, 400) : '';
      if (liveValue) attrs.push(`value="${escapeAttr(liveValue)}"`);
      const idx = takeIndex(node, ctx);
      lines.push(`${indent}${v}[${idx}]<textarea${attrs.length ? ' ' + attrs.join(' ') : ''} />`);
      return;
    }
    case 'LABEL':
    case 'SUMMARY': {
      const text = textOf(node, MAX_TEXT_PER_ITEM);
      if (!text) return;
      const idx = takeIndex(node, ctx);
      lines.push(`${indent}${v}[${idx}]<${node.tagName.toLowerCase()}>${text}</${node.tagName.toLowerCase()}>`);
      return;
    }
    default: {
      // Role-based interactive (e.g. <div role="button">). Use the role
      // name as the rendered tag so the agent sees what kind of widget
      // it is, and fall back to "control" when no role is set.
      const role = node.getAttribute('role')?.toLowerCase();
      const label = node.getAttribute('aria-label')
        ?? textOf(node, MAX_TEXT_PER_ITEM);
      if (!label) return;
      const idx = takeIndex(node, ctx);
      lines.push(`${indent}${v}[${idx}]<${role ?? 'control'}>${truncate(label, MAX_TEXT_PER_ITEM)}</${role ?? 'control'}>`);
      return;
    }
  }
}

/** Pick a short summary for a section's wrapper line — first heading
 *  text, or first paragraph text, or the trimmed full text. */
function sectionLabel(node: Element): string {
  const heading = node.querySelector('h1, h2, h3, h4, h5, h6');
  if (heading && heading.textContent) {
    const t = heading.textContent.trim().replace(/\s+/g, ' ');
    if (t) return truncate(t, 80);
  }
  const p = node.querySelector('p, .section-label, [class*="label"]');
  if (p && p.textContent) {
    const t = p.textContent.trim().replace(/\s+/g, ' ');
    if (t) return truncate(t, 80);
  }
  const text = (node.textContent ?? '').trim().replace(/\s+/g, ' ');
  return truncate(text, 80);
}

/** True when this node contains a block-level descendant that would
 *  emit its own line. */
function hasBlockDescendants(node: Element): boolean {
  for (const desc of Array.from(node.querySelectorAll('*'))) {
    if (SKIP_TAGS.has(desc.tagName)) continue;
    if (HEADING_TAGS.has(desc.tagName)) return true;
    if (NAMED_CONTENT_TAGS.has(desc.tagName)) return true;
    if (INTERACTIVE_TAGS.has(desc.tagName)) return true;
    if (SECTION_TAGS.has(desc.tagName)) return true;
    if (MEDIA_TAGS.has(desc.tagName)) return true;
    if (PRE_TAGS.has(desc.tagName)) return true;
    if (hasInteractiveRole(desc)) return true;
  }
  return false;
}

function textOf(el: Element, max: number): string {
  return truncate((el.textContent ?? '').trim().replace(/\s+/g, ' '), max);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

/** Class- or attribute-based opt-out. */
function hasSkipMarker(el: Element): boolean {
  if (el.hasAttribute('data-dddk-skip')) return true;
  const cls = (el as HTMLElement).className;
  if (typeof cls === 'string' && /\bdddk-skip\b/.test(cls)) return true;
  return false;
}

/**
 * "Is this element visible to the user".
 *
 * Rules (in order):
 *   1. display: none                   → hidden
 *   2. visibility: hidden              → hidden
 *   3. display: contents               → VISIBLE (descend)
 *   4. has bounding box (width|height) → visible
 *   5. otherwise                       → hidden
 *
 * `display: contents` is the framework-wrapper case — walker MUST
 * descend or the whole site disappears.
 */
function isVisible(el: Element): boolean {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return true;
  const style = window.getComputedStyle(el as HTMLElement);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.display === 'contents') return true;
  const rect = (el as HTMLElement).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isModalLike(el: Element): boolean {
  const role = el.getAttribute('role');
  if (role === 'dialog' || role === 'alertdialog') return true;
  return el.getAttribute('aria-modal') === 'true';
}

