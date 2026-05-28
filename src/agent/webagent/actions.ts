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
  description: 'Take the user to a SPA-friendly path. This is a cross-page transition — the runtime always pauses for user consent before moving them. Emit one short narrate sentence that names where you are taking them as the action IMMEDIATELY BEFORE the navigate call in this turn\'s actions[]; the runtime auto-pauses after the narrate so the user can read it, presses Space, then the confirm modal for navigate fires. Without that paired narrate the user sees a confirm modal with no context.',
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
  description: 'Stop and wait for the user to press Space before continuing — ONLY for irreversible / destructive moments where you want explicit consent before proceeding (about to submit a form, place an order, send a message, delete something). Normal narrative cadence is handled by the runtime: it auto-pauses after each `narrate` so you do NOT need to call `pause` between sentences. Calling `pause` mid-tour is wrong.',
  parameters: objSchema({
    note: { type: 'string', description: 'Optional short hint shown in the bar in the user\'s language (e.g. "Submit this order?"). Omit to use the SDK\'s locale-aware default.' },
  }),
  handler: async () => {
    // Intercepted in execute-action.ts; this stub only registers the schema.
    return { ok: true };
  },
};

const scrollTo: ActionDefinition<{ selector: string }> = {
  name: 'scroll_to',
  description: 'Smoothly scroll an element into view. Use before narrating about that element so the user can see what you mean. `selector` accepts either a stable hash ID from the DOM dump (e.g. "ea3f" or "[ea3f]") OR a CSS selector.',
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
  description: 'Wait for time or for an element to appear, capped at 5 seconds. Two modes:\n- `ms`: sleep for that many milliseconds (use for animations / page settle).\n- `selector` + optional `timeout`: poll the DOM until a CSS selector matches an element, or `timeout` ms elapse. Selector mode uses CSS only — stable IDs refer to elements that already exist in the current dump.',
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
  description: 'Click an element — this is what ACTIVATES it: triggers the element\'s onClick handler, follows links, opens menus, picks list / option items, submits buttons. If the user\'s intent is for something on the page to ACT (a menu to open, an option to be selected, a form to submit, a row to be picked), `click` is the action that does it. Drawing a border on the element does NOT click it — border is a passive visual marker only.',
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
  description: 'Draw a border around an element to point it out — "I want to show you THIS". Use right before narrating about that element. Any previous border / highlight is cleared automatically — you do NOT need a separate "clear" tool. `selector` accepts either a stable hash ID from the DOM dump (e.g. "ea3f" or "[ea3f]") OR a CSS selector.',
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
  description: 'Translucent highlighter paint over an element or text span — "look at this passage / chip". More visually dense than border; use for paragraphs / inline text rather than rectangular cards. Any previous border / highlight is cleared automatically. `selector` accepts either a stable hash ID from the DOM dump OR a CSS selector.',
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
  description:
    'Pause and ask the user a free-text question. ONLY use when you genuinely need information you can\'t derive from the page or conversation. Do NOT use to acknowledge state or fish for "press space to continue" — just narrate the answer directly.',
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
  description:
    'Pause and ask the user to pick one of 2-4 short options. Renders a clickable / digit-key picker. Prefer this over `ask_user` when the answer space is finite. Returns the chosen value.',
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
  description: `Render a structured PieceSurface (an image+text card, an option-picker, a 3-up recommendation grid) and wait for the user to pick or cancel. Returns \`{ value: <chosen option's value> | null, cancelled: boolean }\`.

USE WHEN: the answer is "show the user a small UI and let them choose", not "narrate the options as prose". Specifically: 2-6 visual recommendations (products, destinations, files), confirm-summary screens, multi-option pickers where each option has its own image / metadata.

DO NOT USE FOR: yes/no questions (use ask_user_choice instead), free-text input (use ask_user), or destructive confirms (those use the runtime's automatic confirm gate).

Surface shape — a single PieceSurface tree. Recommended composition for "pick one of N":

{
  surface: {
    root: {
      kind: 'OptionGroup',
      bind: 'pick',
      layout: 'row',          // or 'column'
      options: [
        { value: 'p1', title: 'Product A', description: '...', image: { src: 'https://...', alt: '...' } },
        { value: 'p2', title: 'Product B', description: '...', image: { src: '...' } },
        { value: 'p3', title: 'Product C', description: '...', image: { src: '...' } }
      ]
    }
  },
  placement: 'subtitle'   // or 'modal' for blocking, 'dock' for persistent
}

The runtime resolves with the option's \`value\` once the user clicks or hits Enter on a focused tile. Use the returned value in your next-turn reasoning.`,
  parameters: objSchema(
    {
      surface: { type: 'object', additionalProperties: true, description: 'PieceSurface tree — { root: PieceNode, data?: object }.' },
      placement: { type: 'string', enum: ['subtitle', 'modal', 'dock', 'inline'], description: 'Where the surface renders. Default `subtitle`.' },
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
