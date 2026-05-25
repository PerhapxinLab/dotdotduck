/**
 * 19 built-in actions — see ../../docs/04-actions-catalog.md
 */

import type { ActionDefinition, ActionResult } from './types';
import * as overlay from './overlay';

const objSchema = (props: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties: props,
  required,
});

function find(selector: string): { ok: true; el: HTMLElement } | { ok: false; result: ActionResult } {
  if (typeof document === 'undefined') {
    return { ok: false, result: { ok: false, reason: 'unknown', message: 'no DOM' } };
  }
  const els = document.querySelectorAll<HTMLElement>(selector);
  if (els.length === 0) return { ok: false, result: { ok: false, reason: 'not_found' } };
  // Pick the first visible one
  for (const el of Array.from(els)) {
    if (el.offsetParent !== null) return { ok: true, el };
  }
  return { ok: false, result: { ok: false, reason: 'not_visible' } };
}

function isInteractive(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

// ─── navigation ─────────────────────────────────────────────────────

const navigate: ActionDefinition<{ path: string }> = {
  name: 'navigate',
  description: 'Navigate to a SPA-friendly path. Host receives a `navigate` event.',
  parameters: objSchema({ path: { type: 'string' } }, ['path']),
  handler: async ({ path }, ctx) => {
    ctx.emit('navigate', { path });
    // Block the agent loop until the host's router has settled so the
    // next action runs against the new page's DOM, not the previous one.
    // We watch for a `popstate` / SvelteKit-style navigation followed by
    // a paint, or fall back to a fixed 700 ms ceiling. The agent's next
    // turn would otherwise read a stale DOM and pick the wrong target.
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        window.removeEventListener('popstate', finish);
        resolve();
      };
      window.addEventListener('popstate', finish, { once: true });
      // Fixed ceiling — works for hosts that swap via history.pushState
      // (no popstate fires for those) and for SvelteKit's afterNavigate.
      setTimeout(finish, 700);
    });
    // One more rAF so any post-route render flushes before we return.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return { ok: true };
  },
};

const back: ActionDefinition<Record<string, never>> = {
  name: 'back',
  description: 'Go back in browser history.',
  parameters: objSchema({}),
  handler: async () => {
    history.back();
    return { ok: true };
  },
};

const reload: ActionDefinition<Record<string, never>> = {
  name: 'reload',
  description: 'Reload the current page.',
  parameters: objSchema({}),
  handler: async () => {
    location.reload();
    return { ok: true };
  },
};

const scrollTo: ActionDefinition<{ selector: string }> = {
  name: 'scroll_to',
  description: 'Smoothly scroll to a DOM element.',
  parameters: objSchema({ selector: { type: 'string' } }, ['selector']),
  handler: async ({ selector }) => {
    const found = find(selector);
    if (!found.ok) return found.result;
    found.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { ok: true };
  },
};

const wait: ActionDefinition<{ ms: number }> = {
  name: 'wait',
  description: 'Wait up to 5 seconds.',
  parameters: objSchema({ ms: { type: 'number', maximum: 5000 } }, ['ms']),
  handler: async ({ ms }, ctx) => {
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const onAbort = () => {
        if (timer !== null) clearTimeout(timer);
        ctx.signal.removeEventListener('abort', onAbort);
        reject(new Error('aborted'));
      };
      timer = setTimeout(() => {
        ctx.signal.removeEventListener('abort', onAbort);
        resolve();
      }, Math.min(ms, 5000));
      ctx.signal.addEventListener('abort', onAbort);
    });
    return { ok: true };
  },
};

const waitFor: ActionDefinition<{ selector: string; timeout?: number }> = {
  name: 'wait_for',
  description: 'Wait until a selector exists in the DOM (default 5s).',
  parameters: objSchema(
    { selector: { type: 'string' }, timeout: { type: 'number', default: 5000 } },
    ['selector']
  ),
  handler: async ({ selector, timeout = 5000 }) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (document.querySelector(selector)) return { ok: true };
      await new Promise((r) => setTimeout(r, 100));
    }
    return { ok: false, reason: 'timeout' };
  },
};

// ─── DOM interaction ────────────────────────────────────────────────

const click: ActionDefinition<{ selector: string }> = {
  name: 'click',
  description: 'Click an element.',
  parameters: objSchema({ selector: { type: 'string' } }, ['selector']),
  handler: async ({ selector }) => {
    const found = find(selector);
    if (!found.ok) return found.result;
    if (!isInteractive(found.el)) return { ok: false, reason: 'not_interactive' };
    found.el.click();
    // Settle after click — React / Vue / Svelte commonly re-render in
    // response to a click; if the click also triggers an anchor follow
    // or a programmatic navigate, popstate fires. Wait briefly so the
    // next agent action reads the post-click DOM, not the pre-click.
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

/**
 * React (and most other framework-controlled inputs) tracks the underlying
 * value via the native prototype setter. Assigning `el.value = x` directly
 * bypasses the setter on the prototype, so React's onChange never fires for
 * controlled inputs. Call the prototype setter explicitly, then dispatch the
 * input/change events.
 */
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
  description: 'Fill a text input / textarea with a value.',
  parameters: objSchema(
    { selector: { type: 'string' }, value: { type: 'string' } },
    ['selector', 'value']
  ),
  handler: async ({ selector, value }) => {
    const found = find(selector);
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
  handler: async ({ selector, value }) => {
    const found = find(selector);
    if (!found.ok) return found.result;
    const el = found.el as HTMLSelectElement;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  },
};

const submitForm: ActionDefinition<{ selector: string }> = {
  name: 'submit_form',
  description: 'Submit a form.',
  parameters: objSchema({ selector: { type: 'string' } }, ['selector']),
  handler: async ({ selector }) => {
    const found = find(selector);
    if (!found.ok) return found.result;
    const form = found.el.closest('form');
    if (!form) return { ok: false, reason: 'not_found', message: 'no enclosing form' };
    // form.submit() bypasses the `submit` event handler (and HTML form
    // validation). requestSubmit() goes through the normal path so React /
    // Vue / framework onSubmit hooks fire. Fall back to submit() in old
    // browsers that don't have requestSubmit.
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      form.submit();
    }
    // Submit commonly triggers navigation OR async state update; settle
    // before yielding so the next agent action sees the result page.
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        window.removeEventListener('popstate', finish);
        resolve();
      };
      window.addEventListener('popstate', finish, { once: true });
      setTimeout(finish, 600);
    });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return { ok: true };
  },
};

const clearInput: ActionDefinition<{ selector: string }> = {
  name: 'clear_input',
  description: 'Clear input / textarea value.',
  parameters: objSchema({ selector: { type: 'string' } }, ['selector']),
  handler: async ({ selector }) => {
    const found = find(selector);
    if (!found.ok) return found.result;
    const el = found.el as HTMLInputElement | HTMLTextAreaElement;
    setNativeInputValue(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  },
};

const setText: ActionDefinition<{ selector: string; text: string }> = {
  name: 'set_text',
  description: 'Set the text content of a contentEditable element.',
  parameters: objSchema(
    { selector: { type: 'string' }, text: { type: 'string' } },
    ['selector', 'text']
  ),
  handler: async ({ selector, text }) => {
    const found = find(selector);
    if (!found.ok) return found.result;
    if (!found.el.isContentEditable)
      return { ok: false, reason: 'not_interactive', message: 'not contenteditable' };
    found.el.textContent = text;
    found.el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return { ok: true };
  },
};

// ─── visual overlay actions ─────────────────────────────────────────

const highlightAction: ActionDefinition<
  { selector: string; color?: string; label?: string },
  string
> = {
  name: 'highlight',
  description: 'Highlight an element with optional color and label.',
  parameters: objSchema(
    {
      selector: { type: 'string' },
      color: { type: 'string' },
      label: { type: 'string' },
    },
    ['selector']
  ),
  handler: async ({ selector, color, label }) => {
    const id = overlay.highlight(selector, color, label);
    return id ? { ok: true, data: id } : { ok: false, reason: 'not_found' };
  },
};

const borderAction: ActionDefinition<
  { selector: string; color?: string; label?: string },
  string
> = {
  name: 'border',
  description: 'Draw a border around an element.',
  parameters: objSchema(
    {
      selector: { type: 'string' },
      color: { type: 'string' },
      label: { type: 'string' },
    },
    ['selector']
  ),
  handler: async ({ selector, color, label }) => {
    const id = overlay.border(selector, color, label);
    return id ? { ok: true, data: id } : { ok: false, reason: 'not_found' };
  },
};

const spotlightAction: ActionDefinition<{ selector: string }, string> = {
  name: 'spotlight',
  description: 'Dim the page and spotlight a single element.',
  parameters: objSchema({ selector: { type: 'string' } }, ['selector']),
  handler: async ({ selector }) => {
    const id = overlay.spotlight(selector);
    return id ? { ok: true, data: id } : { ok: false, reason: 'not_found' };
  },
};

const injectAction: ActionDefinition<
  { selector: string; text: string; position?: 'before' | 'after' },
  string
> = {
  name: 'inject',
  description: 'Inject a small annotation node before/after an element.',
  parameters: objSchema(
    {
      selector: { type: 'string' },
      text: { type: 'string' },
      position: { type: 'string', enum: ['before', 'after'] },
    },
    ['selector', 'text']
  ),
  handler: async ({ selector, text, position }) => {
    const id = overlay.inject(selector, text, position);
    return id ? { ok: true, data: id } : { ok: false, reason: 'not_found' };
  },
};

const clearOverlaysAction: ActionDefinition<Record<string, never>> = {
  name: 'clear_overlays',
  description: 'Remove all visual overlays.',
  parameters: objSchema({}),
  handler: async () => {
    overlay.clearOverlays();
    return { ok: true };
  },
};

// ─── communication with user ────────────────────────────────────────

const showSubtitle: ActionDefinition<{ text: string }> = {
  name: 'show_subtitle',
  description: 'Show a subtitle bar message to the user.',
  parameters: objSchema({ text: { type: 'string' } }, ['text']),
  handler: async ({ text }, ctx) => {
    ctx.emit('subtitle', text);
    return { ok: true };
  },
};

const askUser: ActionDefinition<{ question: string }, string> = {
  name: 'ask_user',
  description:
    'Pause the agent and ask the user a free-text question. Use only when the answer is short and unstructured. If the answer is one of a small set of choices, prefer ask_user_choice — it gives the user a clickable / number-key picker instead of asking them to type free text.',
  parameters: objSchema({ question: { type: 'string' } }, ['question']),
  handler: async () => {
    // Handled in WebAgent.executeAction — this stub only exists to register
    // the tool schema for the LLM. If this code path runs, the agent invoked
    // the action handler directly without going through WebAgent.
    console.warn(
      '[webagent] ask_user handler invoked directly — should be intercepted by WebAgent.executeAction',
    );
    return { ok: true };
  },
};

const askUserChoice: ActionDefinition<
  { question: string; options: string[]; allowFreeText?: boolean },
  string
> = {
  name: 'ask_user_choice',
  description:
    'Pause the agent and ask the user to pick one of 2-4 short options. Renders as a clickable / number-key picker (1, 2, 3, …). When allowFreeText is true (default), the user can also type a free-text answer instead of picking a listed option — use this when the listed options may not cover the full intent space. Returns the chosen value as a string.',
  parameters: objSchema(
    {
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
      allowFreeText: { type: 'boolean' },
    },
    ['question', 'options'],
  ),
  handler: async () => {
    console.warn(
      '[webagent] ask_user_choice handler invoked directly — should be intercepted by WebAgent.executeAction',
    );
    return { ok: true };
  },
};

// ─── exports ────────────────────────────────────────────────────────

/**
 * `highlightAction`, `spotlightAction`, `injectAction`, and
 * `clearOverlaysAction` are intentionally NOT exported in `builtinActions`.
 * The host controls overlay rendering (border is the canonical "draw
 * attention to an element" primitive); overlay auto-clear happens in the
 * dddk orchestrator on agent `done` / `error`. Structured surface
 * rendering lives in dddk's Pieces system, not as an agent tool.
 */
export const builtinActions: ActionDefinition[] = [
  navigate,
  back,
  reload,
  scrollTo,
  wait,
  waitFor,
  click,
  fillInput,
  selectOption,
  submitForm,
  clearInput,
  setText,
  borderAction,
  showSubtitle,
  askUser,
  askUserChoice,
] as ActionDefinition[];
