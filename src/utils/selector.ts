/**
 * Best-effort CSS selector inference for a DOM element.
 *
 * Strategy:
 *   1. honor explicit hooks first: `data-dddk-id`, then `data-testid`
 *   2. then `id` if globally unique (escaped via CSS.escape so weird ids are safe)
 *   3. otherwise build a short ancestry path with :nth-child positions,
 *      bounded to 5 levels deep so we don't generate selectors that bind to
 *      structural noise.
 *
 * `asAttribute: true` returns the selector wrapped as ` selector="..."` for
 * inline annotation inside LLM-facing DOM summaries (see agent/dom-reader.ts).
 */

export interface InferSelectorOptions {
  /** Include ` selector="..."` decorator string suitable for inline annotation. Default false. */
  asAttribute?: boolean;
  /** Max depth for the nth-child fallback path. Default 5. */
  maxDepth?: number;
}

export function inferSelector(el: Element, opts: InferSelectorOptions = {}): string {
  const maxDepth = opts.maxDepth ?? 5;
  const wrap = (sel: string) => (opts.asAttribute ? ` selector="${sel}"` : sel);

  if (typeof document === 'undefined') return '';
  if (el instanceof HTMLElement && el.dataset.dddkId) {
    return wrap(`[data-dddk-id="${cssAttrEscape(el.dataset.dddkId)}"]`);
  }
  if (el.id) {
    try {
      const escaped = CSS.escape(el.id);
      if (document.querySelectorAll(`#${escaped}`).length === 1) {
        return wrap(`#${escaped}`);
      }
    } catch {
      /* CSS.escape unavailable (very old browsers) — fall through. */
    }
  }
  if (el instanceof HTMLElement && el.dataset.testid) {
    return wrap(`[data-testid="${cssAttrEscape(el.dataset.testid)}"]`);
  }

  const path: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body && path.length < maxDepth) {
    const idx = Array.from(cur.parentElement?.children ?? []).indexOf(cur) + 1;
    path.unshift(`${cur.tagName.toLowerCase()}:nth-child(${idx})`);
    cur = cur.parentElement;
  }
  return wrap(path.join('>'));
}

function cssAttrEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
