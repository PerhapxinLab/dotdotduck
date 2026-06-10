/**
 * Tiny DOM helpers shared across dddk modules.
 */

/** Canonical attribute every dddk-owned UI element carries. */
export const UI_ATTR = 'data-dddk-ui';

/**
 * Escape a string for safe injection into an HTML attribute or text node via
 * innerHTML. Covers `&`, `<`, `>`, `"`, and `'` — the full set documented at
 * https://owasp.org/www-community/attacks/xss/.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build a compact `<tag#id.class> inner` signature for an element — the
 * same short-form descriptor used by the chip-bar and the Dwell capture
 * flow when surfacing "what is selected" to the user / LLM. Truncates
 * inner text at `maxInner` (default 1000) so we never paste a paragraph
 * into a chip / context blob.
 *
 * Returns just `<tag#id.class>` when the element has no readable inner
 * text — keeps the signature meaningful even for icon-only buttons.
 */
export function formatElementSignature(
  el: HTMLElement,
  opts: { maxInner?: number } = {},
): string {
  const maxInner = opts.maxInner ?? 1000;
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const classList = el.classList ? Array.from(el.classList).slice(0, 3) : [];
  const cls = classList.length ? '.' + classList.join('.') : '';
  const sig = `<${tag}${id}${cls}>`;
  const inner = ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().slice(0, maxInner);
  return inner ? `${sig} ${inner}` : sig;
}

/**
 * Idempotently inject a `<style>` element with the given id and CSS text. If
 * an element with the same id already exists, this is a no-op (so modules can
 * call it from every constructor without worrying about duplication).
 *
 * Returns `true` if a new element was created, `false` otherwise — useful for
 * tests that want to assert "this only happens once".
 */
export function injectScopedStyle(id: string, css: string): boolean {
  if (typeof document === 'undefined') return false;
  if (document.getElementById(id)) return false;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
  return true;
}
