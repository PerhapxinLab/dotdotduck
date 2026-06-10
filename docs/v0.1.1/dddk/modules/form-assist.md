# FormAssist — inline "AI fill" button on every form

> Detects `<form>` elements on the page, adds a small floating "AI fill" button at the top-right of each, and fires a host callback with the form's inspected fields when tapped. Host wires that callback to `dddk.startAgent(...)` with a task that uses webagent's `fill_input` action.

Opt-in. Disabled by default; instantiate `FormAssistModule` and call `start()`.

## When to use

- Internal admin pages with many similar forms (CRM customer records, invoice line items, support-ticket triage)
- User-generated-content flows where the user has already pasted source material elsewhere and just needs it sorted into fields
- Onboarding wizards where every field is derivable from one big "tell us about yourself" textarea earlier in the flow

Don't use when:

- The form has only 1-2 fields — a custom palette command is faster to discover
- The form has security implications (login, payment) — the agent shouldn't autofill those, and the default skip list does not include them, so you must pass `skipSelector` explicitly

## Import

```ts
import { FormAssistModule, inspectForm } from '@perhapxin/dddk';
import type { FormAssistConfig, FormAssistInfo } from '@perhapxin/dddk';
```

## Minimum setup

```ts
import { FormAssistModule } from '@perhapxin/dddk';

const formAssist = new FormAssistModule({
  onAssist: (info) => {
    // info.fields: [{ name, label, type, required }, ...]
    const fieldList = info.fields
      .map((f) => `- ${f.label || f.name} (${f.type}${f.required ? ', required' : ''})`)
      .join('\n');
    dddk.startAgent(
      `Fill the form at selector "${info.selector}". Fields:\n${fieldList}\n\nUse the conversation context to decide what to fill.`,
    );
  },
});

formAssist.start(dddk.subtitle);
```

The "✨ 幫填" button appears at `top: 8px; right: 8px` inside each `<form>` (the form is bumped to `position: relative` if it's currently `static`).

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `formSelector` | `'form'` | CSS selector for forms to attach the button to. |
| `skipSelector` | — | Skip forms matching this selector. Use for login / payment / opt-out. |
| `autoShow` | `true` | Watch the DOM and auto-attach to newly-added forms. |
| `onAssist` | — | `(info: FormAssistInfo) => void` (required). Fires on button click. |

## `FormAssistInfo` shape

```ts
interface FormAssistInfo {
  form: HTMLFormElement;
  selector: string;
  fields: Array<{
    name: string;     // input.name || input.id || label || '(unnamed)'
    label: string;    // <label for=…>, wrapping <label>, aria-label, or placeholder
    type: string;     // input.type or tag name
    required: boolean;
  }>;
}
```

Hidden inputs and submit / button inputs are filtered out automatically.

You can call `inspectForm(form)` directly on any `HTMLFormElement` to get the same shape, without going through the module:

```ts
import { inspectForm } from '@perhapxin/dddk';

const info = inspectForm(document.querySelector('form')!);
```

## Skip login / payment / opt-out forms

The default behaviour attaches to **every** form. Always set `skipSelector`:

```ts
new FormAssistModule({
  skipSelector: 'form#login, form[data-no-ai-fill], form.payment',
  onAssist: (info) => { /* ... */ },
});
```

A form with the conventional `data-no-ai-fill` attribute is a useful host pattern but not magic — you have to put it in `skipSelector` yourself.

## Runtime API

```ts
formAssist.attachTo(form, dddk.subtitle); // manual single-form attach
formAssist.detachFrom(form);              // remove button + clear tracking
formAssist.stop();                        // disconnect MutationObserver + remove every button
```

`attachTo` is idempotent — calling it on an already-attached form is a no-op.

## How the agent actually fills the form

This module surfaces intent. The actual fill happens through webagent's `fill_input` action (or a script skill the host wires up). A typical agent task looks like:

```
Fill the form at selector "form#customer-1024". Fields:
- Customer name (text, required)
- Email (email, required)
- Phone (tel)
- Notes (textarea)

Use the conversation context — the customer mentioned their name is Acme Corp,
email is hello@acme.com, and they have no phone on file.
```

The agent then calls `fill_input(selector, value)` once per field. AgentCursor visualises each fill if attached. Dwell is recommended off during fill — the cursor moves quickly between fields and the long-press detection adds latency.

## Tear-down

```ts
formAssist.stop();
```

Disconnects the `MutationObserver` and removes every `data-dddk-ui="form-assist-btn"` from the page.

See also: [./agent-cursor.md](./agent-cursor.md) to visualise the agent filling fields, [../skills/cookbook.md](../skills/cookbook.md) for end-to-end form-fill skill recipes, [./overview.md](./overview.md) for the module index.
