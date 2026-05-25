/**
 * Tiny DOM helpers shared across dddk modules.
 *
 * Kept private to dddk — webagent has its own escaping (it goes through React
 * + the agent's structured output, not raw innerHTML).
 */

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
