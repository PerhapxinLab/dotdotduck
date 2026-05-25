# How to add a skill

A **skill** is one named, invokable thing your product can do via the palette. There are four kinds — pick the one that matches your task:

| Type | Use when | Example |
|---|---|---|
| `ScriptSkill` | Walk the user through a guided tour | `/introduce` |
| `PromptSkill` | Send a templated prompt to the LLM | `/translate-prompt` |
| `ActionSkill` | Run a TypeScript callback (no LLM) | `/clear-clipboard` |
| `SurfaceSkill` | Open a declarative form / dialog rendered as a Piece tree | `/new-customer` |

You register skills on the `DotDotDuck` config. They appear in the palette as `/skillId — Name` automatically.

---

## ScriptSkill — `/introduce`

A scripted tour. Each step shows a subtitle and waits for the user to press space (or sets `waitForUser: false` to auto-advance).

```ts
import { DotDotDuck, type ScriptSkill } from '@perhapxin/dddk';

const introduce: ScriptSkill = {
  id: 'introduce',
  type: 'script',
  name: 'Tour the product',
  description: '1-minute walk-through',
  icon: '▶',
  steps: [
    { subtitle: 'Welcome! Press space to continue.' },
    {
      subtitle: 'This is your dashboard. The top bar is your nav.',
      action: (t) => { t.border('nav', '#ec4899'); },
    },
    {
      subtitle: 'Press Ctrl+K anytime to open the palette.',
    },
    {
      subtitle: 'That`s it. Have fun.',
      waitForUser: false,
    },
  ],
};

const dotdotduck = new DotDotDuck({
  siteName: 'Acme',
  llm: yourProvider,
  skills: [introduce],
});
dotdotduck.mount();
```

User types `/introduce` in the palette (or you call `dotdotduck.runSkill('introduce')` programmatically).

### Step API (the `t` parameter)

| Method | What it does |
|---|---|
| `t.subtitle(text)` | Replace the floating subtitle |
| `t.border(selector, color?, label?)` | Highlight an element with a colored border |
| `t.spotlight(selector)` | Dim everything except this element |
| `t.highlight(selector)` | Soft highlight (less intrusive than spotlight) |
| `t.navigate(path)` | Programmatically navigate (routes through your `onNavigate` callback) |
| `t.wait(ms)` | Pause `ms` before the next step |
| `t.clearOverlays()` | Remove all `border` / `spotlight` decorations |
| `t.ask(question)` | Ask a question, returns the user's answer as `Promise<string>` |
| `t.surface(surface, opts?)` | Show an ad-hoc Surface mid-step; resolves with form data (or `null` on cancel) |

### Mid-script Surface (form / picker / confirmation)

A step can pause the script to collect structured input via `t.surface(...)`. The SDK emits the `surface` event with a `PieceSurface` payload; your host renders it, then calls `dddk.submitSurface(data)` (or `dddk.cancelSurface()`) to resume.

```ts
const onboarding: ScriptSkill = {
  id: 'onboarding',
  type: 'script',
  name: 'Onboard new account',
  steps: [
    { subtitle: 'Welcome — let me grab a couple of details.' },
    {
      action: async (t) => {
        const data = await t.surface({
          root: {
            kind: 'Card',
            children: [
              { kind: 'Heading',   text: 'Your account' },
              { kind: 'TextInput', bind: '/name',    label: 'Name',    required: true },
              { kind: 'TextInput', bind: '/email',   label: 'Email',   required: true },
              { kind: 'Button',    text: 'Continue', action: 'submit' },
            ],
          },
          data: { name: '', email: '' },
        });
        if (!data) return;                     // user cancelled
        await fetch('/api/account', { method: 'POST', body: JSON.stringify(data) });
      },
    },
    { subtitle: 'Done — your account is set up.' },
  ],
};
```

Host wiring (one-time, where you already handle the `surface` event):

```ts
dddk.on('surface', ({ surface }) => {
  mountYourRenderer(surface, {
    onSubmit: (data) => dddk.submitSurface(data),
    onCancel: ()      => dddk.cancelSurface(),
  });
});
```

See [08-surface-renderer](./08-surface-renderer.md) for the full Surface contract.

---

## PromptSkill — `/translate-prompt`

Sends a prompt to the agent. Variables in `{braces}` get filled from `vars` you pass at invocation.

```ts
import type { PromptSkill } from '@perhapxin/dddk';

const translateSkill: PromptSkill = {
  id: 'translate-prompt',
  type: 'prompt',
  name: 'Translate clipboard',
  prompt: 'Translate the following to {target}: {args}',
  icon: '文',
};

dotdotduck.registerSkill(translateSkill);
// User: /translate-prompt es Hello world
//   → prompt becomes "Translate the following to es: Hello world"
```

Args after the skill name are joined into `{args}`. For more control, the skill can read the user's first positional arg as a named variable — see `parseArgs` in the SkillRegistry.

---

## ActionSkill — `/clear-clipboard`

Runs a TypeScript callback. No LLM involved.

```ts
import type { ActionSkill } from '@perhapxin/dddk';

const clearClipboard: ActionSkill = {
  id: 'clear-clipboard',
  type: 'action',
  name: 'Clear clipboard',
  icon: '✕',
  handler: async (ctx) => {
    await navigator.clipboard.writeText('');
    ctx.subtitle.show({ text: 'Clipboard cleared.', type: 'info', autoHide: 1500 });
  },
};
```

`ctx` gives you:
- `ctx.palette.close()` / `ctx.palette.replace(items)`
- `ctx.subtitle.show(...)` / `ctx.subtitle.hide()`
- `ctx.storage.get(key)` / `ctx.storage.set(key, value)` (persists in localStorage by default)
- `ctx.getPreferences<T>()` (if your skill declared `preferences`)
- `ctx.agent(task)` to delegate to the webagent
- `ctx.navigate(path)`

---

## SurfaceSkill — `/new-customer`

Returns a `PieceSurface` — a tree of UI primitives + an optional data model. dotdotduck emits the `surface` event; the host renders via `PieceRenderer`. See [08-surface-renderer](./08-surface-renderer.md) for the full rendering contract.

```ts
import type { SurfaceSkill } from '@perhapxin/dddk';

const newCustomer: SurfaceSkill = {
  id: 'new-customer',
  type: 'surface',
  name: 'New customer',
  icon: '◉',
  build: async (ctx) => ({
    root: {
      kind: 'Stack',
      children: [
        { kind: 'Heading',   text: 'New customer' },
        { kind: 'TextInput', id: 'name',  bind: '/name',  label: 'Name',  required: true },
        { kind: 'TextInput', id: 'email', bind: '/email', label: 'Email', required: true },
        {
          kind: 'Select', id: 'plan', bind: '/plan', label: 'Plan',
          options: [
            { value: 'free',       label: 'Free' },
            { value: 'pro',        label: 'Pro' },
            { value: 'enterprise', label: 'Enterprise' },
          ],
        },
        { kind: 'Button', text: 'Create', action: 'submit' },
      ],
    },
    data: { name: '', email: '', plan: 'free' },
  }),
  onSubmit: async (values, ctx) => {
    const { name, email, plan } = values;
    await fetch('/api/customers', { method: 'POST', body: JSON.stringify({ name, email, plan }) });
    ctx.subtitle.show({ text: `Created ${name}.`, type: 'info', autoHide: 2000 });
  },
};
```

---

## Per-skill preferences (settings)

A skill can declare fields the user needs to set once before it runs. dotdotduck auto-opens a setup form and persists the values to storage.

```ts
const summarizeSkill: ActionSkill = {
  id: 'summarize',
  type: 'action',
  name: 'Summarize selection',
  preferences: [
    { name: 'targetLang', label: 'Target language', type: 'select', options: ['en', 'zh-TW', 'ja'], default: 'en' },
    { name: 'tone', label: 'Tone', type: 'text', default: 'professional' },
  ],
  handler: async (ctx) => {
    const prefs = ctx.getPreferences<{ targetLang: string; tone: string }>();
    // use prefs.targetLang / prefs.tone
  },
};
```

First time the skill runs, dotdotduck shows the setup form. Subsequent runs read from storage.

---

## Registering after construction

If your skills aren't known at construction time:

```ts
const dotdotduck = new DotDotDuck({ /* …no skills yet… */ });
dotdotduck.skills.register(introduce);
dotdotduck.skills.register(clearClipboard);
dotdotduck.mount();
```

You can also unregister at runtime via `dotdotduck.skills.remove('introduce')`.
