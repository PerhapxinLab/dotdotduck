# webagent — Actions Catalog

> Every tool the agent can call. The LLM invokes them via function calling.

## Design principles

- Each action has an explicit input schema (Zod / JSON Schema).
- Each action is either idempotent or clearly marked as a side-effect.
- Failures return a normalised error — never throw into the agent loop.
- DOM actions `query` first to confirm the target exists; if not, return `{ ok: false, reason: 'not_found' }`.

## Action bundles (opt-in as of v0.2.0)

The default install is `coreActions` (5). Everything else is opt-in via `customActions`:

```ts
import { WebAgent, coreActions, formActions, flowActions, extraActions, builtinActions } from '@perhapxin/dddk';

// Restore v0.1 behaviour (all 15 installed):
new WebAgent({ ..., customActions: builtinActions });

// Or opt-in per bundle:
new WebAgent({ ..., customActions: [...formActions] });
```

| Bundle | Members | Default? |
|---|---|---|
| `coreActions` | `narrate`, `navigate`, `click`, `border`, `scroll_to` | ✅ auto-installed |
| `formActions` | `fill_input`, `select_option`, `clear_input`, `press_key`, `hold_key`, `double_click`, `long_press`, `drag` | opt-in |
| `flowActions` | `wait`, `pause`, `ask_user`, `ask_user_choice` | opt-in |
| `extraActions` | `highlight`, `track_intent`, `escalate_to_human` | opt-in |
| `workflowActions` | `validate_form`, `wait_until` | opt-in |

## Full list

### Navigation / page control

| Action | Params | Behaviour |
|---|---|---|
| `navigate` | `{ path: string }` | SPA-friendly page change. Rejects paths not in the configured `sitemap` (v0.2.0) with the valid path list so the model can retry. Always gated with a Space confirmation (the runtime emits a `confirm` event before running). |
| `scroll_to` | `{ selector }` | Smooth-scrolls to the element. Use before narrating about something below the fold. With `cursorTrail: true` the cursor swaps to a mouse-wheel glyph, travels along the scroll path, and reverts to pointer. |
| `wait` | `{ ms?, selector?, timeout? }` | Two modes — sleep `ms` milliseconds, or poll until a CSS `selector` appears (with `timeout`). Capped at 5 s. |

### DOM interaction

| Action | Params | Behaviour |
|---|---|---|
| `click` | `{ selector }` | Click the element. Use this for submit buttons too — there is no separate `submit_form`. |
| `double_click` | `{ selector }` | Real `dblclick` event (not two `click`s), so handlers bound to `ondblclick` actually run — open / expand / rename modes. |
| `long_press` | `{ selector, ms? }` | mousedown + touchstart → wait → mouseup + touchend. Default 600 ms, caps at 5 s. Context menus, drag handles, mobile long-press. |
| `drag` | `{ from, to, steps? }` | mousedown on `from` → N interpolated mousemove events → mouseup on `to`. Also fires HTML5 `dragstart` / `dragover` / `drop` / `dragend` so React-DnD / SortableJS / native HTML5 DnD all light up. Sortable lists, kanban, slider handles. |
| `fill_input` | `{ selector, value }` | Fill an input or textarea (dispatches `input` + `change`). |
| `select_option` | `{ selector, value }` | Pick a `<select>` option. |
| `clear_input` | `{ selector }` | Clear a field. |
| `press_key` | `{ key, selector?, modifiers? }` | Dispatch a keyboard event (`keydown` + `keyup`) on an element. `key` is the W3C key name (`"Enter"`, `"Escape"`, `"ArrowDown"`, `" "`, single chars). `modifiers`: `('ctrl' \| 'shift' \| 'alt' \| 'meta')[]` for chord dispatch — Ctrl+S / Cmd+K / Shift+Tab. `selector` optional — omitted = `document.activeElement`. |
| `hold_key` | `{ key, ms, selector?, modifiers? }` | Hold a key down for `ms` milliseconds (keydown → wait → keyup). Push-to-talk, hold-Ctrl multi-select, hold-to-zoom. Caps at 5 s. |

### Visual overlays (shown to the user)

| Action | Params | Behaviour |
|---|---|---|
| `border` | `{ selector, color?, label? }` | Draw a border around the element. Calling `border` or `highlight` auto-clears any prior overlay. **In CoT mode the standalone `border` tool is HIDDEN from the model** — framing is set via `narrate.about` instead (see below). |
| `highlight` | `{ selector, color?, label? }` | Translucent fill — for inline text spans / paragraphs. Same auto-clear. Not in `coreActions`; opt in via `extraActions` or `customActions`. |

### Narration + user prompts

| Action | Params | Behaviour |
|---|---|---|
| `narrate` | `{ text, about? }` | First-class action in `coreActions` (v0.2.0). CoT runtime intercepts the envelope shape; plain-protocol callers hit the handler which routes text to the subtitle bar. When `about` is set, auto-borders that element (see below). |
| `pause` | `{ note? }` | Wait for the user to press Space before the next subject. **Hidden from the CoT tool list** — the runtime auto-pauses after every narrate. |
| `ask_user` | `{ question }` | Ask a free-text question. |
| `ask_user_choice` | `{ question, options[], allowFreeText? }` | Multi-choice picker (2–6 options, with optional free-text fallback). |

#### `ask_user` vs `ask_user_choice`

If the answer space is 2–4 short options, **prefer** `ask_user_choice` — the host renders it as a clickable / number-keyed picker (we recommend [`Subtitle.showChoice`](../../modules/subtitle.md#multi-choice-picker-showchoice)) so the user doesn't have to type. Only fall back to `ask_user` when the answer genuinely needs free text (e.g. "describe the issue", "paste an email").

`allowFreeText` defaults to `true`: the picker's last row is a free-text input, letting the user type an answer that isn't in the list. On submit the typed string is delivered as-is — the agent receives that string with no special sentinel; the host distinguishes free-text vs a listed pick at the event layer via `index === -1`, then calls `agent.respond(value)`.

Both actions behave the same way: after invocation the agent enters `waiting` and the loop blocks there until the host calls `respond(value)`.

### Selector format — stable `[id]` hashes from the DOM dump

Every `selector` parameter above accepts either a stable `[id]` hash from the indexed DOM dump (`"a1b2"`, `"[a1b2]"`, even `"↓[a1b2]"`) OR a CSS selector string. The DOM reader emits each addressable element with a per-element hash — the LLM passes that hash back as the `selector` arg and the runtime resolves it via the per-turn index map. CSS selectors still work as a fallback, but hashes are the primary path and avoid all selector-guessing.

**Never invent CSS selectors** like `#command-X` based on guessed names. The page does not necessarily use those IDs. Always copy a hash verbatim from the current turn's DOM dump.

### Termination (CoT mode)

CoT mode envelopes have explicit signals for ending the loop:

- `{ task_finish: true }` — put as the LAST item in `actions[]` when the user's original task is fully satisfied. Runtime ends the loop right after the prior actions in this turn dispatch. DO NOT use in the same turn as `ask_user_choice`, `navigate`, `click`, `fill_input`, or any tool whose result you have not yet observed — runtime drops mis-placed `task_finish` and logs a warning.
- Empty / omitted `actions` — legacy end-of-loop path; runtime hides the subtitle when no actions are present.

Classic (non-CoT) mode ends naturally when the model emits a turn with text only and no tool call (`finish_reason=stop`).

### Narrate envelope — `narrate.about` auto-borders

In CoT mode the `agent_turn` envelope's `actions[]` accepts narrate items shaped `{ narrate: string, about?: string }`. When `about` is set to an element's `[id]` hash, the runtime AUTO-CALLS `border` on that element BEFORE streaming the narrate text. No separate `border` action needed — the framing is structurally tied to the narration. This is the reason `border` is hidden from the CoT tool list above.

## Action result shape

```ts
type ActionResult =
  | { ok: true; data?: any }
  | { ok: false; reason: ActionFailureReason; message?: string };

type ActionFailureReason =
  | 'not_found'       // selector matched nothing
  | 'not_visible'     // element exists but isn't visible
  | 'not_interactive' // element is disabled / readonly
  | 'timeout'         // wait_for timed out
  | 'navigation'      // interrupted by an in-flight navigation
  | 'unknown';
```

The agent loop appends the result to `session.steps`, so the next LLM turn sees the failure reason and can self-correct.

## Selector rules

LLM-returned selectors must be **CSS selectors**, with limits:
- Only `tag` / `id` / `class` / `[data-*]` attributes / `:nth-child()` are allowed.
- **No** `:has()`, `:not()`, or other selectors prone to NodeList blow-ups.
- No `*` (universal selector).
- When multiple elements match, the first visible one is used by default, and `result.data` carries `{ matched: N, used: 0 }` as a hint.

For complex targeting use the `data-webagent-id` attribute — the DOM Reader auto-attaches fallback ids.

## Custom action example

```ts
import { z } from 'zod';

agent.config.customActions = [
  {
    name: 'open_chat_panel',
    description: 'Open the chat panel on the right side',
    parameters: z.object({
      initialMessage: z.string().optional(),
    }),
    handler: async ({ initialMessage }, ctx) => {
      myUI.openChatPanel(initialMessage);
      return { ok: true };
    },
  },
];
```

## Trimming further with `excludeTools`

`customActions` decides what's INSTALLED. If you want to trim individual entries out of a bundle you mostly want, use `excludeTools`:

```ts
new WebAgent({
  customActions: [...formActions],
  excludeTools: ['select_option', 'clear_input'],  // formActions minus these two
});
```

`disableBuiltinActions` from v0.1 is a deprecated alias for `excludeTools`. Rename in place — same shape, same behaviour, no console warning tax after you switch.

```ts
new DotDotDuck({
  // …
  webAgent: {
    disableBuiltinActions: [
      'pause',            // runtime auto-pauses; only needed for destructive moments
      'wait',             // no async UI to wait for
      'select_option',    // no <select> elements
      'clear_input',      // fill_input('') covers the rare case
      'ask_user',         // one-shot Q&A: agent shouldn't ask follow-ups
      'ask_user_choice',  // same as above
    ],
  },
});
```

The visual `highlight` action is **not** in the default set — re-add it via `customActions` if you want the translucent-fill style alongside `border`. `present_surface` is similarly opt-in via `allowPresent: true`. `disableBuiltinActions` applies to both, so you can disable them even after opting in.

## Action vs direct API

Actions are what the LLM can invoke. When the host needs to trigger a behaviour directly (without the LLM), call `agent.executeAction(name, params)` — it runs the handler without appending to `session.steps`.

## Actions we deliberately don't ship (so you don't ask)

- `eval_js` — too dangerous; not exposed.
- `fetch` — wrap with a custom action instead; don't let the LLM issue arbitrary requests.
- `localStorage_set/get` — wrap with a custom action.

Note: there is no `screenshot` ACTION (the LLM can't request a capture), but the agent CAN see the page visually — enable `WebAgentConfig.screenshot` and a viewport / full-page image is attached to every turn alongside the DOM dump. See the [screenshot guide](../screenshot).
