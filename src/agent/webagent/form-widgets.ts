/**
 * v0.2.0 ROADMAP 2.4 — form widget adapter registry.
 *
 * Real product forms wrap their inputs in UI-library widgets:
 * react-select, antd Select, MUI Autocomplete, headless-ui Listbox,
 * Chakra DatePicker. The actual <input> behind the widget is hidden
 * or proxied through a custom handler, so the SDK's `fill_input` /
 * `select_option` defaults (set .value + dispatch input event) don't
 * actually update the widget's internal state.
 *
 * This registry lets a host plug in matchers + fillers for the
 * widget libraries their product actually uses. The runtime walks
 * registered widgets in priority order BEFORE the default fill path;
 * first match wins.
 *
 *   import { registerFormWidget } from '@perhapxin/dddk';
 *   registerFormWidget({
 *     id: 'react-select',
 *     priority: 100,
 *     match: (el) => el.closest('.react-select__control') != null,
 *     fill: async (el, value, ctx) => {
 *       const control = el.closest('.react-select__control')!;
 *       control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
 *       await ctx.wait(60);
 *       const opt = [...document.querySelectorAll('.react-select__option')]
 *         .find((o) => o.textContent?.trim() === value);
 *       opt?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
 *       return opt != null;
 *     },
 *   });
 *
 * The default fallback (set .value + dispatch input) is unchanged for
 * vanilla <input> / <textarea> / <select> — only non-trivial widgets
 * need adapters.
 */

export interface FormWidgetFillContext {
  /** Polite delay between DOM events. Always use this, not setTimeout,
   *  so the agent's abort signal can interrupt long fills. */
  wait(ms: number): Promise<void>;
  /** Async fill triggered by an agent — for sub-fill on dependent fields. */
  signal: AbortSignal;
}

export interface FormWidgetAdapter {
  /** Stable id — same string overwrites prior registration. */
  id: string;
  /** Higher priority wins when multiple match. Default 0. */
  priority?: number;
  /** Predicate: does this adapter own this input element? */
  match(el: Element): boolean;
  /** Fill the widget. Return true if the value landed. */
  fill(el: Element, value: string, ctx: FormWidgetFillContext): Promise<boolean>;
}

const widgets = new Map<string, FormWidgetAdapter>();

export function registerFormWidget(adapter: FormWidgetAdapter): void {
  widgets.set(adapter.id, adapter);
}

export function unregisterFormWidget(id: string): boolean {
  return widgets.delete(id);
}

export function listFormWidgets(): FormWidgetAdapter[] {
  return Array.from(widgets.values()).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/**
 * Find the first registered adapter that matches `el` (by priority),
 * or null if no custom widget applies — caller falls back to the default
 * `.value + input event` path.
 */
export function findFormWidget(el: Element): FormWidgetAdapter | null {
  for (const adapter of listFormWidgets()) {
    try {
      if (adapter.match(el)) return adapter;
    } catch {
      // Adapter match threw — skip it and keep walking. A broken adapter
      // shouldn't poison the whole fill chain.
    }
  }
  return null;
}
