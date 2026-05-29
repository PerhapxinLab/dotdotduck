/**
 * Built-in actions — the narrator's hands. Visual overlays are first-class
 * here (border / highlight / spotlight) because the agent's job is to point
 * at things and then talk about them.
 *
 * The `show_subtitle` action was removed deliberately — between tool calls
 * the model emits free-form text which streams into the subtitle bar. There
 * is no `done` tool either; the loop ends when the model emits a turn with
 * no tool call (finish_reason=stop).
 */

import type { ActionDefinition, ActionResult } from './types';
import * as overlay from './overlay';

const objSchema = (props: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties: props,
  required,
});

function resolve(ctx: { resolveTarget: (t: string | number) => Element | null }, target: string | number):
  { ok: true; el: HTMLElement } | { ok: false; result: ActionResult } {
  if (typeof document === 'undefined') {
    return { ok: false, result: { ok: false, reason: 'unknown', message: 'no DOM' } };
  }
  const el = ctx.resolveTarget(target);
  if (!el) return { ok: false, result: { ok: false, reason: 'not_found' } };
  const html = el as HTMLElement;
  // For visibility we still use offsetParent — the index map was built
  // from visible elements, but elements can become hidden between read
  // and dispatch (e.g. async re-render).
  if (html.offsetParent === null && html.tagName !== 'BODY') {
    return { ok: false, result: { ok: false, reason: 'not_visible' } };
  }
  return { ok: true, el: html };
}

function isInteractive(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

// ─── navigation ─────────────────────────────────────────────────────

const navigate: ActionDefinition<{ path: string }> = {
  name: 'navigate',
  description: 'Take the user to a SPA-friendly path (e.g. "/pricing"). Cross-page transition; the runtime asks the user to confirm before moving.',
  parameters: objSchema({ path: { type: 'string' } }, ['path']),
  // Cross-page transitions are the only routine built-in that gates by
  // default. Other moves (scroll / border / highlight / click) are
  // visual continuity within the same page and don't need a Space gate.
  // Locale-aware confirmation copy lives in `narrateAction` in
  // webagent.ts so this stays domain- and language-neutral.
  requireConfirmation: true,
  handler: async ({ path }) => {
    if (typeof window === 'undefined') return { ok: false, reason: 'unknown', message: 'no window' };
    return { ok: true, data: path };
  },
};

const pause: ActionDefinition<{ note?: string }> = {
  name: 'pause',
  description: 'Wait for the user to press Space before continuing. Use only for explicit-consent moments (about to submit, place an order, send a message).',
  parameters: objSchema({
    note: { type: 'string', description: 'Optional short hint shown in the subtitle bar.' },
  }),
  handler: async () => {
    // Intercepted in execute-action.ts; this stub only registers the schema.
    return { ok: true };
  },
};

const scrollTo: ActionDefinition<{ selector: string }> = {
  name: 'scroll_to',
  description: 'Smoothly scroll an element into view. `selector` accepts a stable hash ID from the DOM dump or a CSS selector.',
  parameters: objSchema({ selector: { type: 'string' } }, ['selector']),
  handler: async ({ selector }, ctx) => {
    const found = resolve(ctx, selector);
    if (!found.ok) return found.result;
    found.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { ok: true };
  },
};

const wait: ActionDefinition<{ ms?: number; selector?: string; timeout?: number }> = {
  name: 'wait',
  description: 'Wait for time or for a CSS selector to appear, capped at 5s. Pass `ms` to sleep, or `selector` (+ optional `timeout`) to poll.',
  parameters: objSchema(
    {
      ms: { type: 'number', maximum: 5000 },
      selector: { type: 'string' },
      timeout: { type: 'number', maximum: 5000, default: 5000 },
    }
  ),
  handler: async ({ ms, selector, timeout = 5000 }, ctx) => {
    if (selector) {
      const start = Date.now();
      const cap = Math.min(timeout, 5000);
      while (Date.now() - start < cap) {
        if (ctx.signal.aborted) return { ok: false, reason: 'cancelled' };
        if (typeof document !== 'undefined' && document.querySelector(selector)) return { ok: true };
        await new Promise((r) => setTimeout(r, 100));
      }
      return { ok: false, reason: 'timeout' };
    }
    const duration = Math.min(ms ?? 0, 5000);
    await new Promise<void>((resolveTimer, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const onAbort = (): void => {
        if (timer !== null) clearTimeout(timer);
        ctx.signal.removeEventListener('abort', onAbort);
        reject(new Error('aborted'));
      };
      timer = setTimeout(() => {
        ctx.signal.removeEventListener('abort', onAbort);
        resolveTimer();
      }, duration);
      ctx.signal.addEventListener('abort', onAbort);
    });
    return { ok: true };
  },
};

// ─── DOM interaction ────────────────────────────────────────────────

const click: ActionDefinition<{ selector: string }> = {
  name: 'click',
  description: 'Click an element — fires its onClick handler, follows links, opens menus, picks options, submits buttons. `selector` MUST be a stable `[id]` hash taken VERBATIM from the current DOM dump (e.g. `[a1b2]` or `a1b2`). NEVER invent CSS selectors like `#thing` / `.row` based on guessed names — the page does not necessarily use those IDs. If the element you want is not in the current DOM dump, scroll / wait / re-read instead of guessing.',
  parameters: objSchema({ selector: { type: 'string' } }, ['selector']),
  handler: async ({ selector }, ctx) => {
    const found = resolve(ctx, selector);
    if (!found.ok) return found.result;
    if (!isInteractive(found.el)) return { ok: false, reason: 'not_interactive' };
    found.el.click();
    // Settle so framework handlers re-render before the next agent turn
    // reads DOM.
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        window.removeEventListener('popstate', finish);
        resolve();
      };
      window.addEventListener('popstate', finish, { once: true });
      setTimeout(finish, 250);
    });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return { ok: true };
  },
};

function setNativeInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
}

const fillInput: ActionDefinition<{ selector: string; value: string }> = {
  name: 'fill_input',
  description: 'Fill a text input or textarea with a value. Works with framework-controlled inputs (dispatches input + change events).',
  parameters: objSchema(
    { selector: { type: 'string' }, value: { type: 'string' } },
    ['selector', 'value']
  ),
  handler: async ({ selector, value }, ctx) => {
    const found = resolve(ctx, selector);
    if (!found.ok) return found.result;
    const el = found.el as HTMLInputElement | HTMLTextAreaElement;
    if (!isInteractive(el)) return { ok: false, reason: 'not_interactive' };
    el.focus();
    setNativeInputValue(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  },
};

const selectOption: ActionDefinition<{ selector: string; value: string }> = {
  name: 'select_option',
  description: 'Select an <option> by value.',
  parameters: objSchema(
    { selector: { type: 'string' }, value: { type: 'string' } },
    ['selector', 'value']
  ),
  handler: async ({ selector, value }, ctx) => {
    const found = resolve(ctx, selector);
    if (!found.ok) return found.result;
    const el = found.el as HTMLSelectElement;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  },
};

/**
 * Maps a few common key names to their `event.code` value so frameworks
 * checking `code` (not just `key`) still match. Sparse on purpose — most
 * single-character keys map 1:1 and don't need an entry.
 */
const KEY_CODE_MAP: Record<string, string> = {
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ' ': 'Space',
  Space: 'Space',
};

const pressKey: ActionDefinition<{ key: string; selector?: string }> = {
  name: 'press_key',
  description: 'Dispatch a keyboard event (keydown + keyup) on an element. Use for Enter (commit forms / palette selections), Escape, Tab, ArrowUp/Down, etc. `key` is the W3C key name ("Enter", "Escape", "ArrowDown", "a", " "). `selector` is optional — omitted = the currently focused element (`document.activeElement`).',
  parameters: objSchema(
    { key: { type: 'string' }, selector: { type: 'string' } },
    ['key'],
  ),
  handler: async ({ key, selector }, ctx) => {
    if (typeof document === 'undefined') return { ok: false, reason: 'unknown', message: 'no DOM' };
    let target: HTMLElement | null;
    if (selector) {
      const found = resolve(ctx, selector);
      if (!found.ok) return found.result;
      target = found.el;
    } else {
      target = (document.activeElement as HTMLElement | null) ?? document.body;
    }
    if (!target) return { ok: false, reason: 'not_found' };
    const code = KEY_CODE_MAP[key] ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key);
    const init: KeyboardEventInit = { key, code, bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    return { ok: true };
  },
};

const clearInput: ActionDefinition<{ selector: string }> = {
  name: 'clear_input',
  description: 'Clear an input or textarea value.',
  parameters: objSchema({ selector: { type: 'string' } }, ['selector']),
  handler: async ({ selector }, ctx) => {
    const found = resolve(ctx, selector);
    if (!found.ok) return found.result;
    const el = found.el as HTMLInputElement | HTMLTextAreaElement;
    setNativeInputValue(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  },
};

// ─── visual overlay actions — first-class for the narrator ─────────

const borderAction: ActionDefinition<
  { selector: string; color?: string; label?: string },
  string
> = {
  name: 'border',
  description: 'Draw a border around an element to point at it. Previous border / highlight is auto-cleared.',
  parameters: objSchema(
    {
      selector: { type: 'string' },
      color: { type: 'string' },
      label: { type: 'string' },
    },
    ['selector']
  ),
  handler: async ({ selector, color, label }, ctx) => {
    const el = ctx.resolveTarget(selector);
    if (!el) return { ok: false, reason: 'not_found' };
    overlay.clearOverlays();
    const id = overlay.border(el, color, label);
    return id ? { ok: true, data: id } : { ok: false, reason: 'not_found' };
  },
};

const highlightAction: ActionDefinition<
  { selector: string; color?: string; label?: string },
  string
> = {
  name: 'highlight',
  description: 'Translucent paint overlay on an element or text span. Previous border / highlight is auto-cleared.',
  parameters: objSchema(
    {
      selector: { type: 'string' },
      color: { type: 'string' },
      label: { type: 'string' },
    },
    ['selector']
  ),
  handler: async ({ selector, color, label }, ctx) => {
    const el = ctx.resolveTarget(selector);
    if (!el) return { ok: false, reason: 'not_found' };
    overlay.clearOverlays();
    const id = overlay.highlight(el, color, label);
    return id ? { ok: true, data: id } : { ok: false, reason: 'not_found' };
  },
};

// ─── ask the user (kept — for genuine pauses needing input) ────────

const askUser: ActionDefinition<{ question: string }, string> = {
  name: 'ask_user',
  description: 'Pause and ask the user a free-text question. Use only when you need information not derivable from the page or conversation.',
  parameters: objSchema({ question: { type: 'string' } }, ['question']),
  handler: async () => {
    // Intercepted in execute-action.ts.
    return { ok: true };
  },
};

const askUserChoice: ActionDefinition<
  { question: string; options: string[]; allowFreeText?: boolean },
  string
> = {
  name: 'ask_user_choice',
  description: 'Pause and ask the user to pick one of 2-6 options. Prefer this over ask_user when the answer space is finite. Returns the chosen value.',
  parameters: objSchema(
    {
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
      allowFreeText: { type: 'boolean' },
    },
    ['question', 'options'],
  ),
  handler: async () => {
    // Intercepted in execute-action.ts.
    return { ok: true };
  },
};

// ─── present_surface — rich UI handoff (opt-in) ────────────────────
// Not in the builtin set; the runtime adds it ONLY when the host opts
// in via `WebAgentConfig.allowPresent`. Lives here so the schema is
// next to the other actions for consistency.

export const presentSurface: ActionDefinition<{
  surface: unknown;
  placement?: 'subtitle' | 'modal' | 'dock' | 'inline';
}> = {
  name: 'present_surface',
  description: 'Render a visual picker (OptionGroup of 2-6 options, each with value / title / optional description / optional image) and wait for the user to pick or cancel. Returns `{ value, cancelled }`. Use when the choice has visual weight (product cards, plan tiers); use ask_user_choice for plain 2-6 text options.',
  parameters: objSchema(
    {
      surface: {
        type: 'object',
        additionalProperties: true,
        description: 'PieceSurface tree. Shape: { root: { kind: "OptionGroup", bind: string, layout: "row" | "column", options: Array<{ value: string, title: string, description?: string, image?: { src: string, alt?: string } }> } }.',
      },
      placement: { type: 'string', enum: ['subtitle', 'modal', 'dock', 'inline'], description: 'Where the picker renders. Default `subtitle`.' },
    },
    ['surface'],
  ),
  handler: async () => {
    // Intercepted in execute-action.ts; this stub only registers the schema.
    return { ok: true };
  },
};

// ─── exports ────────────────────────────────────────────────────────

export const builtinActions: ActionDefinition[] = [
  navigate,
  scrollTo,
  wait,
  click,
  fillInput,
  selectOption,
  clearInput,
  pressKey,
  // `borderAction` is the canonical "point at an element" tool. The old
  // `highlightAction` (translucent paint overlay, intended for text spans)
  // was removed from the builtin set in v0.1.0+ because two visually-similar
  // marker tools confused the model — it would pick one inconsistently and
  // the visual style flipped between turns. Hosts that genuinely need the
  // paint-overlay style can re-register it via `customActions`; for most
  // sites, border-only is the right default.
  borderAction,
  pause,
  askUser,
  askUserChoice,
] as ActionDefinition[];

// Exported so hosts that want both visual styles can opt in:
//   new WebAgent({ ..., customActions: [highlightAction] })
export { highlightAction };
