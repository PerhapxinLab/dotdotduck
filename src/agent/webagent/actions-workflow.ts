/**
 * workflow actions.
 *
 * The agent needs hooks for the common patterns that show up when it
 * operates real product UIs:
 *
 *   - 2.5  `validate_form`        — after fill_input, read back the
 *                                   browser's constraint validation or
 *                                   the page's own `aria-invalid` /
 *                                   `.error` markers to know if the
 *                                   submission will be accepted.
 *   - 2.7  `wait_until`           — poll a CSS selector (or its visible
 *                                   state) up to a timeout. Used for
 *                                   modal close / async result render /
 *                                   spinner disappearance.
 *   - 2.8  `detect_login_wall`    — after navigation, check whether the
 *                                   destination looks like a sign-in
 *                                   wall (URL pattern, form fields,
 *                                   visible OAuth buttons). Emits the
 *                                   `auth_required` failure reason so
 *                                   the agent surfaces a sign-in request
 *                                   instead of clicking on Google's
 *                                   button on the user's behalf.
 *
 * These are deliberately small — composable primitives the LLM picks
 * one-at-a-time, not a multi-step transaction macro. The "multi-step
 * skill pattern" (2.6) lives at the Skill SDK layer, not as a single
 * tool call.
 */

import type { ActionDefinition } from './types';

// Tiny shared JSON-schema builder — same pattern as actions.ts.
function objSchema<S extends Record<string, unknown>>(
  properties: S,
  required: Array<keyof S> = [],
): { type: 'object'; properties: S; required?: string[]; additionalProperties: false } {
  return {
    type: 'object',
    properties,
    ...(required.length ? { required: required as string[] } : {}),
    additionalProperties: false,
  };
}

// ─── 2.5 · validate_form ────────────────────────────────────────────

interface ValidateFormParams {
  selector: string;
}

interface FieldValidation {
  selector: string;
  name: string | null;
  valid: boolean;
  message: string | null;
}

interface ValidateFormResult {
  valid: boolean;
  fields: FieldValidation[];
}

export const validateForm: ActionDefinition<ValidateFormParams> = {
  name: 'validate_form',
  description:
    'Read back the validation state of every input inside a form. Returns each field\'s validity, error message, and `aria-invalid` if the page sets it. Run this after fill_input to confirm the form will accept submission before clicking submit.',
  parameters: objSchema(
    {
      selector: {
        type: 'string',
        description: 'CSS selector for the <form> (or any container holding the inputs).',
      },
    },
    ['selector'],
  ),
  handler: async ({ selector }) => {
    if (typeof document === 'undefined') {
      return { ok: false, reason: 'unknown', message: 'no DOM available' };
    }
    const root = document.querySelector(selector);
    if (!root) return { ok: false, reason: 'not_found', message: `selector not found: ${selector}` };

    const fields: FieldValidation[] = [];
    const inputs = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input, textarea, select',
    );
    for (const el of Array.from(inputs)) {
      // Skip non-data inputs.
      if (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'button' || el.type === 'hidden')) {
        continue;
      }
      const ariaInvalid = el.getAttribute('aria-invalid');
      // ValidityState only exists on form-associated inputs.
      const validity = (el as HTMLInputElement).validity;
      const browserValid = validity ? validity.valid : true;
      const ariaValid = ariaInvalid == null ? true : ariaInvalid === 'false';
      const valid = browserValid && ariaValid;

      // Hunt for an error message: prefer aria-describedby, fall back to
      // a sibling .error / .invalid-feedback, then validationMessage.
      let message: string | null = null;
      const describedBy = el.getAttribute('aria-describedby');
      if (describedBy) {
        const desc = document.getElementById(describedBy);
        if (desc) message = desc.textContent?.trim() || null;
      }
      if (!message) {
        const sibling = el.parentElement?.querySelector('.error, .invalid-feedback, [data-error]');
        if (sibling) message = sibling.textContent?.trim() || null;
      }
      if (!message && validity && !validity.valid) message = (el as HTMLInputElement).validationMessage;

      fields.push({
        selector: buildSelector(el),
        name: el.getAttribute('name') ?? el.getAttribute('id') ?? null,
        valid,
        message,
      });
    }
    const allValid = fields.every((f) => f.valid);
    const result: ValidateFormResult = { valid: allValid, fields };
    return { ok: true, data: result };
  },
};

function buildSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
  return el.tagName.toLowerCase();
}

// ─── 2.7 · wait_until ───────────────────────────────────────────────

interface WaitUntilParams {
  selector: string;
  /** `present` (default) / `visible` / `absent` */
  state?: 'present' | 'visible' | 'absent';
  /** Poll cap in ms. Hard ceiling 30s — long-running waits should be
   *  modelled as multi-turn (yield + come back) not single-action poll. */
  timeout?: number;
}

export const waitUntil: ActionDefinition<WaitUntilParams> = {
  name: 'wait_until',
  description:
    'Poll for a CSS selector to reach a state. `state` is one of `present` (default — exists in DOM), `visible` (offsetParent != null), or `absent` (gone from DOM). Use this when the page does async work — modal close, spinner disappear, async result render. Capped at 30s; for longer waits, finish the turn and let the user re-trigger.',
  parameters: objSchema(
    {
      selector: { type: 'string' },
      state: { type: 'string', enum: ['present', 'visible', 'absent'], default: 'present' },
      timeout: { type: 'number', maximum: 30_000, default: 10_000 },
    },
    ['selector'],
  ),
  handler: async ({ selector, state = 'present', timeout = 10_000 }, ctx) => {
    if (typeof document === 'undefined') {
      return { ok: false, reason: 'unknown', message: 'no DOM available' };
    }
    const cap = Math.min(timeout, 30_000);
    const start = Date.now();
    const check = (): boolean => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (state === 'absent') return el == null;
      if (!el) return false;
      if (state === 'visible') return el.offsetParent != null;
      return true; // present
    };
    while (Date.now() - start < cap) {
      if (ctx.signal.aborted) return { ok: false, reason: 'cancelled' };
      if (check()) return { ok: true, data: { waitedMs: Date.now() - start } };
      await new Promise((r) => setTimeout(r, 200));
    }
    return { ok: false, reason: 'timeout', message: `selector "${selector}" did not become ${state} in ${cap}ms` };
  },
};

// `detect_login_wall` (2.8) was prototyped then removed — login flows
// are not something the agent should second-guess heuristically. If a
// host wants this behaviour they can register a custom action; the
// generic builtin caused more confusion than it saved.

/**
 * Opt-in workflow actions. NOT pushed into the default `builtinActions`
 * list — host registers explicitly so the agent's prompt catalog stays
 * focused on actions the host actually uses.
 *
 *   import { workflowActions } from '@perhapxin/dddk/agent';
 *   new WebAgent({ ..., customActions: workflowActions });
 *
 * Or cherry-pick:
 *
 *   import { validateForm, waitUntil } from '@perhapxin/dddk/agent';
 *   new WebAgent({ ..., customActions: [validateForm] });
 */
export const workflowActions: ActionDefinition[] = [
  validateForm as ActionDefinition,
  waitUntil as ActionDefinition,
];
