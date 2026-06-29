# Palette actions

A palette item can either supply a bare `handler`, OR a list of typed **actions**. Actions are a discriminated union — each kind has its own payload, dddk renders the right icon, and side-effects (clipboard, navigation, agent dispatch) are handled by the runner so command authors don't re-implement them.

```ts
import { runAction } from '@perhapxin/dddk';
import type { PaletteAction } from '@perhapxin/dddk';
```

When an item carries `actions: PaletteAction[]`:

- **Primary** (the first action) runs on `⏎`.
- **Secondary** (the second, if present) runs on `Ctrl+⏎`.
- The rest open in a sub-panel via `Ctrl+K`.

If you only need one effect, set `actions: [...]` with a single entry — same UX as a bare `handler`, but with the right icon and the right side-effect for free.

---

## The eight kinds

| kind             | payload                                | What it does                                                                |
| ---------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `copy`           | `content: string`                      | `navigator.clipboard.writeText(content)`.                                   |
| `insert`         | `text: string`                         | Inserts `text` at the caret of the page's active `<input>` / `<textarea>` / contenteditable. |
| `open-url`       | `url: string, target?: 'self' \| 'new'`| `window.open(url, target)`. Default `new`.                                  |
| `navigate`       | `path: string`                         | Calls the host's `onNavigate(path)` (SPA-friendly).                         |
| `agent-task`     | `task: string`                         | Hands the string to the webagent — same as `dddk.startAgent(task)`.         |
| `render-surface` | `surface: PieceSurface, placement?`    | Emits a Surface for the host to render via `PieceRenderer`.                 |
| `run-skill`      | `skillId: string, vars?`               | Dispatches a registered skill by id, passing template vars.                 |
| `custom`         | `onActivate(ctx)`                      | Escape hatch — arbitrary callback receiving the same `ActionRunContext`.    |

Shared fields (all kinds):

| field         | type              | default | what it does                                                |
| ------------- | ----------------- | ------- | ----------------------------------------------------------- |
| `title`       | `string`          | —       | Label in the action panel.                                  |
| `icon`        | `string`          | auto    | Glyph; falls back to `defaultIconFor(kind)`.                |
| `shortcut`    | `string`          | —       | Display-only key hint, e.g. `'⌘C'`. Doesn't bind anything.  |
| `destructive` | `boolean`         | `false` | Renders red; pair with a host-level confirm if you need one. |

---

## Quick start — one item, multiple actions

```ts
import { DotDotDuck } from '@perhapxin/dddk';
import type { PaletteAction } from '@perhapxin/dddk';

const actions: PaletteAction[] = [
  { kind: 'copy',       title: 'Copy invoice ID', content: 'INV-2042' },
  { kind: 'open-url',   title: 'Open in Stripe',  url: 'https://dashboard.stripe.com/invoices/INV-2042' },
  { kind: 'agent-task', title: 'Ask why it failed', task: 'Why did invoice INV-2042 fail? Check the payment log.' },
  { kind: 'navigate',   title: 'Go to customer',  path: '/customers/cus_42' },
];

dddk.palette.addItem({
  id: 'invoice-INV-2042',
  name: 'Invoice INV-2042',
  description: 'Failed · $84.20',
  section: 'Billing',
  actions,
});
```

`⏎` copies. `Ctrl+⏎` opens Stripe. `Ctrl+K` opens a sub-panel with the agent task and the navigate row.

---

## Per-kind notes

### `copy`

```ts
{ kind: 'copy', title: 'Copy API key', content: 'sk_live_…', concealed: true }
```

`concealed: true` is a hint for host-side clipboard history logging — dddk itself doesn't keep a history.

### `insert`

```ts
{ kind: 'insert', title: 'Insert signature', text: '— Sent from dddk' }
```

Targets `document.activeElement`. Works on `<input>`, `<textarea>`, and contenteditable surfaces. No-op if nothing's focused. Useful in palette items registered as text-snippet expansions.

### `open-url`

```ts
{ kind: 'open-url', title: 'Docs', url: 'https://docs.example.com', target: 'new' }
```

Default `target: 'new'`. Use `'self'` only when you really want to leave the SPA.

### `navigate`

```ts
{ kind: 'navigate', title: 'Open billing', path: '/billing' }
```

Calls the host's `onNavigate` (passed into `DotDotDuckConfig`). If you forget to wire `onNavigate`, this is a no-op — see [palette](./palette.md) for the config plumbing.

### `agent-task`

```ts
{ kind: 'agent-task', title: 'Summarize this page', task: 'Give a 3-bullet summary of the current page.' }
```

Same effect as `dddk.startAgent(task)`. The palette closes first; any pinned context (selection, attachments) is carried into the agent automatically. See [webagent api](../agent/api.md).

### `render-surface`

```ts
{
  kind: 'render-surface',
  title: 'Show pricing card',
  surface: {
    root: {
      kind: 'Card',
      children: [
        { kind: 'Heading', text: 'Pro plan' },
        { kind: 'Metric', label: 'Per month', value: '$29' },
      ],
    },
  },
  placement: 'center',
}
```

Emits a `surface` event; the host renders it with `PieceRenderer`. Placement options are `'center' | 'inline' | 'dock'` — see [pieces / surfaces](../surfaces/renderer.md).

### `run-skill`

```ts
{ kind: 'run-skill', title: 'Translate this page', skillId: 'translate', vars: { language: 'English' } }
```

Looks up the skill in the `SkillRegistry` and dispatches it. `vars` template-substitutes into the skill's prompt / steps.

### `custom`

```ts
{
  kind: 'custom',
  title: 'Refresh dashboard data',
  onActivate: (ctx) => {
    refreshAll();
    ctx.startAgent('Tell the user the dashboard is now up to date.');
  },
}
```

`onActivate` receives an `ActionRunContext`:

```ts
interface ActionRunContext {
  navigate(path: string): void;
  startAgent(task: string): void;
  runSkill(skillId: string, vars?: Record<string, string>): void;
  emitSurface(surface: unknown, placement?: SurfacePlacement): void;
}
```

Reach for `custom` only when no typed kind fits. Anything that's "open URL + then do X" should compose typed actions instead — that's what the action panel is for.

---

## `runAction()` directly

If you want to run an action outside the palette (e.g. from a toolbar button), call `runAction`:

```ts
import { runAction } from '@perhapxin/dddk';

await runAction(
  { kind: 'copy', title: 'Copy', content: 'hello' },
  {
    navigate:     (path) => goto(path),
    startAgent:   (task) => dddk.startAgent(task),
    runSkill:     (id, vars) => dddk.runSkill(id, vars),
    emitSurface:  (surface, placement) => dddk.emitSurface(surface, placement),
  },
);
```

Inside the palette, dddk wires the context for you — you only call `runAction` directly when reusing actions outside palette UI.

---

## When to use which kind

- **Want zero LLM involvement?** Use `copy`, `insert`, `open-url`, or `navigate`. Instant, deterministic, no token cost.
- **Want the agent to handle it?** `agent-task`.
- **Have a structured form / result UI?** `render-surface` plus a `SurfaceSkill` — see [skills](../skills/overview.md).
- **Recurring multi-step flow?** `run-skill` referencing a `ScriptSkill` or `PromptSkill`.
- **None of the above fit?** `custom`. But check twice — most "custom" needs are really two typed actions in sequence.

---

## When to use `actions` vs `handler`

`handler` is fine for: "one effect, one row." If the row will only ever do one thing and that thing is hard to express as a typed action (e.g. it manipulates the palette via `PaletteHandle.replace(...)` to push a sub-menu of dynamic data), keep using `handler`.

Switch to `actions` when:

- The row has more than one reasonable Enter behaviour.
- The effect is one of the typed kinds — you get the right icon + behaviour for free.
- You want the side-panel discoverability (`Ctrl+K` to see all actions on this row).

The two are not exclusive — but if `actions` is set, the typed kinds run via `runAction()` and `handler` is ignored.
