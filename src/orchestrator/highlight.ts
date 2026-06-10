/**
 * Highlight overlay — frame any DOM element with the same outline Dwell
 * uses on long-press selection.
 *
 * Self-contained module: owns `highlightedEl` + `highlightDismissTimer`
 * state. The orchestrator forwards `highlightElement` / `clearHighlight`
 * to a single instance held on the class.
 *
 * Frame style shares the `[data-dddk-dwell-target]` attribute defined
 * in `dwell/styles.ts` so only one element is framed at a time and
 * theming flows through `--dddk-dwell-frame-*` CSS vars.
 */

import { ensureDwellStyles } from '../triggers/dwell/styles';

export class HighlightOverlay {
  private highlightedEl: HTMLElement | null = null;
  private highlightDismissTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Frame an element with the same outline Dwell uses on long-press.
   * Replaces any existing highlight (only one frame at a time).
   *
   * @returns true if the element was found and framed
   */
  highlightElement(
    target: string | HTMLElement,
    opts?: { autoDismiss?: number; scroll?: boolean },
  ): boolean {
    if (typeof document === 'undefined') return false;
    this.clearHighlight();
    ensureDwellStyles();
    // String input is treated as a CSS selector. The querySelector call
    // throws SyntaxError on invalid syntax (e.g. a bare numeric agent
    // index like "13") — swallow it instead of letting the pump die.
    // Callers that have a numeric index from the indexed DOM dump should
    // resolve via `WebAgent.resolveSelector(...)` first.
    let el: HTMLElement | null;
    if (typeof target === 'string') {
      try {
        el = document.querySelector<HTMLElement>(target);
      } catch {
        return false;
      }
    } else {
      el = target;
    }
    if (!el) return false;
    // Clear any pre-existing frame (Dwell pin, prior highlight) — we own
    // the attribute now.
    document
      .querySelectorAll('[data-dddk-dwell-target]')
      .forEach((n) => n.removeAttribute('data-dddk-dwell-target'));
    el.setAttribute('data-dddk-dwell-target', '');
    this.highlightedEl = el;
    if (opts?.scroll !== false) {
      // Position the element's TOP near the upper third of the viewport
      // (~18% from the top) rather than centering it. Centering pushes
      // long sections halfway off-screen and crops the title; pinning to
      // the very top hides any context above (heading / breadcrumb / nav).
      // 18% leaves room for site chrome + a bit of breathing space.
      try {
        const rect = el.getBoundingClientRect();
        const targetTop = Math.round(window.innerHeight * 0.18);
        const desiredScrollY = window.scrollY + rect.top - targetTop;
        window.scrollTo({ top: Math.max(0, desiredScrollY), behavior: 'smooth' });
      } catch { /* noop */ }
    }
    if (opts?.autoDismiss && opts.autoDismiss > 0) {
      this.highlightDismissTimer = setTimeout(() => this.clearHighlight(), opts.autoDismiss);
    }
    return true;
  }

  /** Remove any active highlight frame. */
  clearHighlight(): void {
    if (this.highlightDismissTimer) {
      clearTimeout(this.highlightDismissTimer);
      this.highlightDismissTimer = null;
    }
    if (this.highlightedEl) {
      this.highlightedEl.removeAttribute('data-dddk-dwell-target');
      this.highlightedEl = null;
    }
  }
}
