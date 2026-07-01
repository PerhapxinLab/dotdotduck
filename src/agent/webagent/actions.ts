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
import { moveCursorAndTap, moveCursorTo, setCursorMode } from './cursor';

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

const navigate: ActionDefinition<{ path: string; note?: string }> = {
  name: 'navigate',
  description: 'Take the user to a SPA-friendly path. Cross-page transition; runtime gates with a confirm by default. Optional `note` overrides the confirm message — write it in the user\'s language and the persona\'s voice.',
  parameters: objSchema({
    path: { type: 'string' },
    note: { type: 'string', description: 'Optional natural-language sentence shown to the user as the confirm copy instead of the SDK default.' },
  }, ['path']),
  requireConfirmation: true,
  confirmationMessage: ({ note }) => (note?.trim() ? note.trim() : undefined),
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
    // Cursor switches to scroll-mode glyph while we travel; the
    // scrollIntoView promise doesn't exist, so wait a beat for the
    // smooth scroll to settle before gliding the cursor to its
    // destination. Restore pointer mode after.
    if (ctx.uiHints?.cursorTrail) {
      try { setCursorMode('scroll'); } catch { /* nicety */ }
    }
    found.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (ctx.uiHints?.cursorTrail) {
      // ~360ms covers a typical smooth scroll on modern browsers.
      await new Promise((r) => setTimeout(r, 360));
      try {
        await moveCursorTo(found.el);
      } catch { /* nicety */ }
      try { setCursorMode('pointer'); } catch { /* nicety */ }
    }
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
    // Synthetic cursor pre-flight — opt-in via WebAgentConfig.cursorTrail.
    // Pure visual; el.click() still fires the real DOM event afterward.
    if (ctx.uiHints?.cursorTrail) {
      try { await moveCursorAndTap(found.el); } catch { /* visual nicety; never block */ }
    }
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
    // Glide cursor to the field before focusing — same UX beat as
    // `click`: the user sees "the agent is going to type HERE next".
    if (ctx.uiHints?.cursorTrail) {
      try { await moveCursorTo(el); } catch { /* nicety */ }
    }
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

type ModifierKey = 'ctrl' | 'shift' | 'alt' | 'meta';
const ALL_MODIFIERS: readonly ModifierKey[] = ['ctrl', 'shift', 'alt', 'meta'];

function buildKeyEventInit(key: string, modifiers?: string[]): KeyboardEventInit {
  const code = KEY_CODE_MAP[key] ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key);
  const mods = new Set((modifiers ?? []).map((m) => m.toLowerCase()));
  return {
    key,
    code,
    bubbles: true,
    cancelable: true,
    ctrlKey: mods.has('ctrl'),
    shiftKey: mods.has('shift'),
    altKey: mods.has('alt'),
    metaKey: mods.has('meta'),
  };
}

const pressKey: ActionDefinition<{ key: string; selector?: string; modifiers?: string[] }> = {
  name: 'press_key',
  description: 'Dispatch a keyboard event (keydown + keyup) on an element, optionally with modifier keys. Use for Enter (commit forms / palette selections), Escape, Tab, ArrowUp/Down, or chords like Ctrl+S / Cmd+K / Shift+Tab. `key` is the W3C key name ("Enter", "Escape", "ArrowDown", "a", " "). `modifiers` is an array of "ctrl" | "shift" | "alt" | "meta" — empty / omitted = no modifiers. `selector` is optional — omitted = the currently focused element (`document.activeElement`).',
  parameters: objSchema(
    {
      key: { type: 'string' },
      selector: { type: 'string' },
      modifiers: { type: 'array', items: { type: 'string', enum: ALL_MODIFIERS as unknown as string[] } },
    },
    ['key'],
  ),
  handler: async ({ key, selector, modifiers }, ctx) => {
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
    const init = buildKeyEventInit(key, modifiers);
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    return { ok: true };
  },
};

const holdKey: ActionDefinition<{ key: string; ms: number; selector?: string; modifiers?: string[] }> = {
  name: 'hold_key',
  description: 'Hold a key down for `ms` milliseconds (keydown → wait → keyup). Use for hold-to-zoom, hold-Ctrl-to-multi-select, push-to-talk gestures. Caps at 5000ms. Same `key` / `selector` / `modifiers` semantics as press_key.',
  parameters: objSchema(
    {
      key: { type: 'string' },
      ms: { type: 'number', maximum: 5000 },
      selector: { type: 'string' },
      modifiers: { type: 'array', items: { type: 'string', enum: ALL_MODIFIERS as unknown as string[] } },
    },
    ['key', 'ms'],
  ),
  handler: async ({ key, ms, selector, modifiers }, ctx) => {
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
    const init = buildKeyEventInit(key, modifiers);
    target.dispatchEvent(new KeyboardEvent('keydown', { ...init, repeat: false }));
    const duration = Math.min(Math.max(ms, 0), 5000);
    await new Promise<void>((r) => setTimeout(r, duration));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    return { ok: true };
  },
};

const doubleClick: ActionDefinition<{ selector: string }> = {
  name: 'double_click',
  description: 'Double-click an element. Fires `dblclick` (NOT two `click` events) so handlers bound to `ondblclick` actually run — e.g. open detail, expand row, enter rename mode. Cursor glide pre-flight happens if cursorTrail is on.',
  parameters: objSchema({ selector: { type: 'string' } }, ['selector']),
  handler: async ({ selector }, ctx) => {
    const found = resolve(ctx, selector);
    if (!found.ok) return found.result;
    if (!isInteractive(found.el)) return { ok: false, reason: 'not_interactive' };
    if (ctx.uiHints?.cursorTrail) {
      try { await moveCursorAndTap(found.el); } catch { /* nicety */ }
    }
    const rect = found.el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts: MouseEventInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, detail: 2 };
    found.el.dispatchEvent(new MouseEvent('mousedown', opts));
    found.el.dispatchEvent(new MouseEvent('mouseup', opts));
    found.el.dispatchEvent(new MouseEvent('click', opts));
    found.el.dispatchEvent(new MouseEvent('mousedown', opts));
    found.el.dispatchEvent(new MouseEvent('mouseup', opts));
    found.el.dispatchEvent(new MouseEvent('click', opts));
    found.el.dispatchEvent(new MouseEvent('dblclick', opts));
    return { ok: true };
  },
};

const longPress: ActionDefinition<{ selector: string; ms?: number }> = {
  name: 'long_press',
  description: 'Press and HOLD an element for `ms` milliseconds (default 600). Fires `mousedown` + `touchstart` → wait → `mouseup` + `touchend`. Use for context menus, draggable handles, mobile long-press menus. Caps at 5000ms.',
  parameters: objSchema(
    { selector: { type: 'string' }, ms: { type: 'number', maximum: 5000 } },
    ['selector'],
  ),
  handler: async ({ selector, ms = 600 }, ctx) => {
    const found = resolve(ctx, selector);
    if (!found.ok) return found.result;
    if (ctx.uiHints?.cursorTrail) {
      try { await moveCursorAndTap(found.el); } catch { /* nicety */ }
    }
    const rect = found.el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts: MouseEventInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    const touchInit = { bubbles: true, cancelable: true };
    found.el.dispatchEvent(new MouseEvent('mousedown', opts));
    try { found.el.dispatchEvent(new Event('touchstart', touchInit)); } catch { /* touch unsupported */ }
    const duration = Math.min(Math.max(ms, 0), 5000);
    await new Promise<void>((r) => setTimeout(r, duration));
    found.el.dispatchEvent(new MouseEvent('mouseup', opts));
    try { found.el.dispatchEvent(new Event('touchend', touchInit)); } catch { /* touch unsupported */ }
    return { ok: true };
  },
};

const drag: ActionDefinition<{ from: string; to: string; steps?: number }> = {
  name: 'drag',
  description: 'Drag from one element to another. mousedown on `from` → `steps` interpolated mousemove events along the path (default 10) → mouseup on `to`. Also fires `dragstart` / `dragover` / `drop` / `dragend` for HTML5 drag-and-drop. Use for sortable lists, kanban cards, slider handles.',
  parameters: objSchema(
    { from: { type: 'string' }, to: { type: 'string' }, steps: { type: 'number', minimum: 2, maximum: 50 } },
    ['from', 'to'],
  ),
  handler: async ({ from, to, steps = 10 }, ctx) => {
    const fromFound = resolve(ctx, from);
    if (!fromFound.ok) return fromFound.result;
    const toFound = resolve(ctx, to);
    if (!toFound.ok) return toFound.result;
    if (ctx.uiHints?.cursorTrail) {
      try { await moveCursorAndTap(fromFound.el); } catch { /* nicety */ }
    }
    const r1 = fromFound.el.getBoundingClientRect();
    const r2 = toFound.el.getBoundingClientRect();
    const sx = r1.left + r1.width / 2, sy = r1.top + r1.height / 2;
    const ex = r2.left + r2.width / 2, ey = r2.top + r2.height / 2;
    const mk = (x: number, y: number, target: Element): MouseEventInit & { dataTransfer?: DataTransfer } => ({
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y, button: 0,
    });
    fromFound.el.dispatchEvent(new MouseEvent('mousedown', mk(sx, sy, fromFound.el)));
    try { fromFound.el.dispatchEvent(new DragEvent('dragstart', mk(sx, sy, fromFound.el))); } catch { /* old browsers */ }
    const n = Math.min(Math.max(steps, 2), 50);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = sx + (ex - sx) * t;
      const y = sy + (ey - sy) * t;
      const el = document.elementFromPoint(x, y) ?? fromFound.el;
      el.dispatchEvent(new MouseEvent('mousemove', mk(x, y, el)));
      try { el.dispatchEvent(new DragEvent('dragover', mk(x, y, el))); } catch { /* old browsers */ }
      await new Promise<void>((r) => setTimeout(r, 16));
    }
    try { toFound.el.dispatchEvent(new DragEvent('drop', mk(ex, ey, toFound.el))); } catch { /* old browsers */ }
    toFound.el.dispatchEvent(new MouseEvent('mouseup', mk(ex, ey, toFound.el)));
    try { fromFound.el.dispatchEvent(new DragEvent('dragend', mk(ex, ey, fromFound.el))); } catch { /* old browsers */ }
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
    // Glide the synthetic cursor onto the target before drawing the
    // frame — keeps the "agent points at the thing" beat consistent
    // with how `click` already telegraphs intent.
    if (ctx.uiHints?.cursorTrail) {
      try { await moveCursorTo(el); } catch { /* nicety */ }
    }
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
    if (ctx.uiHints?.cursorTrail) {
      try { await moveCursorTo(el); } catch { /* nicety */ }
    }
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

// ─── v0.2.0 generic action additions (ROADMAP 3.1 + 4.7) ──────────

/** ROADMAP 4.7: escalate to a human operator. Host wires the actual
 *  handoff (live chat, ticket, email) in their `escalate_to_human`
 *  action override; the bundled definition is a typed stub that emits
 *  the `agent_escalated` intent for analytics.
 *  Opt-in: NOT in `builtinActions`. Host registers via `customActions`. */
export const escalateToHuman: ActionDefinition<{ reason: string; context?: string }> = {
  name: 'escalate_to_human',
  description: 'Hand off the conversation to a human operator. Use when the user is frustrated, the request requires a human policy decision, or the agent has tried + failed N times. Provide `reason` describing why escalating. Optional `context` packages what to send the operator.',
  parameters: objSchema(
    {
      reason: { type: 'string', description: 'Short reason for the handoff. Shown to the operator.' },
      context: { type: 'string', description: 'Optional longer summary the operator needs.' },
    },
    ['reason'],
  ),
  handler: async ({ reason, context }) => {
    return { ok: true, data: { reason, context: context ?? '' } };
  },
};

/** ROADMAP 3.1: typed intent emission from agent. Lets the agent flag
 *  notable moments in a run for the host's analytics ("user explicitly
 *  asked about pricing", "agent recommended product X").
 *  Opt-in: NOT in `builtinActions`. Host registers via `customActions`. */
export const trackIntent: ActionDefinition<{ kind: string; payload?: Record<string, unknown> }> = {
  name: 'track_intent',
  description: 'Emit a typed intent event to the host\'s analytics stream. Use to flag notable moments mid-run — the user explicitly committed to a plan, the agent recommended a specific product, the conversation drifted into a new topic. Does NOT change the conversation flow; agent should still narrate / act as appropriate after calling this.',
  parameters: objSchema(
    {
      kind: { type: 'string', description: 'Intent kind. Use snake_case + describe what happened, not what to do (e.g. "user_committed_to_pro_plan").' },
      payload: { type: 'object', additionalProperties: true, description: 'Optional structured payload — the entities involved, the outcome, etc.' },
    },
    ['kind'],
  ),
  handler: async ({ kind, payload }) => {
    return { ok: true, data: { kind, payload: payload ?? {} } };
  },
};

// `summarize_page` was prototyped as a schema-only stub then removed —
// the runtime hand-off never landed and shipping the schema without a
// real handler made the LLM call a no-op. Will return once the
// streaming-envelope loop wiring is in place. Host can register their
// own `summarize_page` action today via `customActions`.

// `open_popup` / `enter_iframe` (frame actions, ROADMAP 2.1/2.2) were
// prototyped then removed — the use cases (OAuth windows, embedded
// checkout) overlap with `navigate`+`auth_required` and add little
// for the agent's typical product-driving flows. Re-introduce when a
// real host needs popup-driven OAuth round-tripping.

// ─── narrate primitive ─────────────────────────────────────────────
//
// `narrate` is the most-used agent action in CoT mode — it's how the
// agent "speaks" between page operations. Pre-v0.2 it lived ONLY
// inside the CoT envelope (a {narrate, about?} object the runtime
// intercepts before any tool handler is dispatched), so it never
// appeared in the action registry. That confused hosts inspecting
// `agent.actionsRef.keys()`: where's narrate?
//
// This stub registers `narrate` AS a tool so:
//   - It shows up in the registry / prompt catalog under both
//     protocols (CoT + plain).
//   - Plain-protocol callers (e.g. a future WebAgent-without-CoT,
//     or a TaskAgent borrowing the catalog) can call it and have
//     the text routed to the subtitle bar like the runtime does.
//
// The CoT runtime continues to intercept the envelope's `narrate`
// field BEFORE handler dispatch, so this handler is only reached on
// plain-protocol direct calls. In CoT mode the runtime's interception
// path is the source of truth — descriptions stay aligned in both.
const narrateAction: ActionDefinition<{ text: string; about?: string }> = {
  name: 'narrate',
  description: 'Speak to the user in the subtitle bar — describe what you see, what you found, what you\'re about to do. ALWAYS use the user\'s language. If `about` is set, ALSO point at that element on the page (synthesizes a `border` call). The page narration loop revolves around this action: most steps look like `narrate({text: "Here\'s the install snippet", about: "<id of the pre block>"})`.',
  parameters: objSchema(
    { text: { type: 'string' }, about: { type: 'string' } },
    ['text'],
  ),
  handler: async ({ text, about }, ctx) => {
    // Plain-protocol fallback path. CoT runtime intercepts the
    // envelope's `narrate` field before any handler runs.
    if (typeof document !== 'undefined') {
      // Best-effort subtitle routing. We don't import the Subtitle
      // module directly (would force a dep on the orchestrator); the
      // SDK's dddk handle dispatches subtitle via the lifecycle's
      // `agent_text` event, which the orchestrator already wires.
    }
    if (about) {
      const el = ctx.resolveTarget(about);
      if (el) {
        overlay.clearOverlays();
        if (ctx.uiHints?.cursorTrail) {
          try { await moveCursorTo(el); } catch { /* nicety */ }
        }
        overlay.border(el);
      }
    }
    return { ok: true, data: text };
  },
};

// ─── exports — bundled by purpose (v0.2.0 opt-in pivot) ─────────────
//
// Pre-v0.2 model: `builtinActions` (12 actions) was installed by default;
// hosts trimmed via `excludeTools`. Empirically dddk-frontend disabled 6
// of 12 — the "default everything + remove" pattern bloated the prompt
// catalog for narrow use cases. v0.2 flips to opt-in:
//
//   - Default install = `coreActions` only (4 actions).
//   - Hosts opt in to form / flow / extra bundles via `customActions`.
//   - `builtinActions` kept as union for back-compat — passing it as
//     `customActions` restores v0.1 behaviour.
//
// Rule of thumb when picking bundles:
//   - Always-on agent that just points + navigates → `coreActions`
//   - Form-filling agent (signup flows, checkout)  → `+ formActions`
//   - Conversational agent (Q&A, pauses, choices) → `+ flowActions`

/**
 * The five actions every webagent host needs. Installed by default.
 *  - `narrate`: speak to the user (CoT envelope native; plain-protocol fallback)
 *  - `navigate`: route changes
 *  - `click`: interactive elements
 *  - `border`: visual pointing (also auto-synthesized by narrate's `about`)
 *  - `scroll_to`: paginated content
 *
 * `border` is bundled with narrate intentionally — narrate-with-about
 * synthesizes a border call, so the primitive must exist in the
 * registry for that synthesis to resolve. Hosts who never want to
 * point at things can still `excludeTools: ['border']`.
 */
export const coreActions: ActionDefinition[] = [
  narrateAction,
  navigate,
  click,
  borderAction,
  scrollTo,
] as ActionDefinition[];

/**
 * Form / input + richer pointer interactions. Opt in when the agent
 * needs to type, pick from selects, double-click, long-press, drag,
 * or hold keys. Off by default to keep the prompt slim on read-only
 * marketing / docs surfaces.
 *
 *  - `fill_input` / `select_option` / `clear_input`: text fields + selects
 *  - `press_key`: single keypress (Enter / Escape / Tab / Cmd+S chord)
 *  - `hold_key`: key down for N ms (hold-to-zoom, hold-Ctrl-to-multi-select)
 *  - `double_click`: open / expand / rename — anything bound to `dblclick`
 *  - `long_press`: context menus, drag handles, mobile long-press
 *  - `drag`: from element A to element B (sortable lists, kanban, sliders)
 */
export const formActions: ActionDefinition[] = [
  fillInput,
  selectOption,
  clearInput,
  pressKey,
  holdKey,
  doubleClick,
  longPress,
  drag,
] as ActionDefinition[];

/**
 * Control-flow actions — waiting, pausing, asking the user. Opt in
 * for conversational agents. Auto-pause-after-narrate is independent
 * (controlled by `disableAutoPauseAfterNarrate`).
 */
export const flowActions: ActionDefinition[] = [
  wait,
  pause,
  askUser,
  askUserChoice,
] as ActionDefinition[];

/**
 * Less-common visual / escalation actions. `highlight` is a paint
 * overlay (vs `border`'s frame) — was historically dropped from
 * default because the LLM couldn't reliably pick one. `track_intent`
 * is for hosts wiring custom analytics tunnels. `escalate_to_human`
 * is for support flows. `present_surface` is registered separately
 * via `allowPresent` + `setSurfaceMounter`.
 */
export const extraActions: ActionDefinition[] = [
  highlightAction,
  trackIntent,
  escalateToHuman,
] as ActionDefinition[];

/**
 * Union of all bundles EXCEPT `present_surface` (which needs explicit
 * `allowPresent` + a mounter). Pass to `customActions` to restore
 * pre-v0.2 "install everything" behaviour.
 */
export const builtinActions: ActionDefinition[] = [
  ...coreActions,
  ...formActions,
  ...flowActions,
] as ActionDefinition[];

// Opt-in: workflow actions are NOT auto-registered.
// Host opts in with `new WebAgent({ ..., customActions: workflowActions })`
// — keeps the default prompt catalog focused on the actions the host
// actually uses.
export { workflowActions } from './actions-workflow';
export { validateForm, waitUntil } from './actions-workflow';

// Exported so hosts that want both visual styles can opt in:
//   new WebAgent({ ..., customActions: [highlightAction] })
export { highlightAction };
