/**
 * Inject a single <style> element keyed by id. Idempotent — calling twice
 * with the same id is a no-op. Safe to call from any module-level code.
 */

export function injectScopedStyle(id: string, css: string): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}
