# dotdotduck — Skills SDK

> A Skill is a registrable "unit of dotdotduck behaviour." Four types cover everything from plain prompt templates, to visual walkthroughs, to structured-UI Surfaces.

## The four Skill types

### 1. ScriptSkill — a sequence of visual steps

Best for onboarding tours, tutorials, and replayable walkthroughs.

```ts
import type { ScriptSkill } from '@perhapxin/dddk';

const introduce: ScriptSkill = {
  id: 'introduce',
  type: 'script',
  name: 'Tour our features',
  description: '5 minutes covering every highlight',
  steps: [
    {
      page: '/',
      subtitle: 'Welcome. This is the home page.',
      action: (tools) => tools.spotlight('.hero'),
    },
    {
      page: '/pricing',
      subtitle: 'Here are our plans.',
      action: (tools) => tools.highlight('.plans', undefined, 'look here'),
    },
    {
      page: '/dashboard',
      subtitle: 'Once you sign in you land on the dashboard. Press Ctrl+K any time to summon me.',
      waitForUser: true,  // wait for Space before advancing
    },
  ],
};
```

Each step has:
- `page` (optional) — navigate before running
- `subtitle` (optional) — what the subtitle bar says
- `action` (optional) — a visual operation (highlight / spotlight / border / inject)
- `waitForUser` (default `true`) — pause until the user presses Space

### 2. PromptSkill — custom agent system prompt

Best for "one kind of task, used repeatedly."

```ts
const translate: PromptSkill = {
  id: 'translate',
  type: 'prompt',
  name: 'Translate this page',
  prompt: 'Use the immersive_translate action to translate this page into {{language}}. When done, call show_subtitle to inform the user.',
};
```

`{{variable}}` placeholders are pulled from the user's input.

User types `/translate English` in the palette → variable `language = 'English'` → the rendered prompt becomes the agent's system prompt → agent runs.

### 3. ActionSkill — a plain function, no agent

Best for "execute immediately, no LLM judgment needed."

```ts
const clipboardHistory: ActionSkill = {
  id: 'clipboard-history',
  type: 'action',
  name: 'Clipboard history',
  handler: (ctx) => {
    const items = ctx.storage.get('clipboard') ?? [];
    ctx.palette.replace(items.map(i => ({
      id: i.id,
      name: i.text.slice(0, 50),
      handler: () => navigator.clipboard.writeText(i.text),
    })));
  },
};
```

The handler receives a context object with:
- `ctx.palette` — manipulate the palette
- `ctx.subtitle` — show a subtitle
- `ctx.storage` — read / write storage
- `ctx.llm` — call the LLM directly when needed
- `ctx.agent` — invoke the agent when needed

### 4. SurfaceSkill — open a structured UI

Best for "needs structured input or shows structured results." Returns a `PieceSurface` (root node + optional data model). dotdotduck emits a `surface` event; the host renders it with `PieceRenderer`. See [../surfaces/renderer.md](../surfaces/renderer.md).

```ts
import type { SurfaceSkill } from '@perhapxin/dddk';

const orderStatus: SurfaceSkill = {
  id: 'order-status',
  type: 'surface',
  name: 'Check order status',
  build: async (ctx) => ({
    root: {
      kind: 'Card',
      children: [
        { kind: 'Heading',   text: 'Find an order' },
        { kind: 'TextInput', id: 'orderId', bind: '/orderId', label: 'Order #' },
        { kind: 'Button',    text: 'Search', action: 'submit' },
      ],
    },
    data: { orderId: '' },
  }),
  onSubmit: async ({ orderId }, ctx) => {
    const order = await fetch(`/api/orders/${orderId}`).then((r) => r.json());
    return {
      // Return another surface to render the result (multi-step form),
      // or `undefined` to close the flow.
      root: {
        kind: 'Card',
        children: [
          { kind: 'Heading', text: `${order.id} — ${order.customer}` },
          { kind: 'Metric',  label: 'Total', value: `$${order.total}` },
        ],
      },
    };
  },
};
```

`build` returns the first surface. `onSubmit` receives the user's submission and can return a follow-up surface (multi-step) or `undefined` to end the flow.

## SkillRegistry

```ts
class SkillRegistry {
  register(skill: Skill): void;
  unregister(id: string): void;
  get(id: string): Skill | undefined;
  list(): Skill[];
  match(command: string): Skill | undefined;  // "/introduce" → skill "introduce"
}
```

`SkillRegistry` is built into dotdotduck. Host passes skills via config:

```ts
new DotDotDuck({
  skills: [introduce, translate, orderStatus, clipboardHistory],
});
```

Or register them dynamically later:

```ts
dotdotduck.skills.register(newSkill);
```

## SkillTools (passed to ScriptSkill actions)

```ts
interface SkillTools {
  navigate(path: string): void;
  highlight(selector: string, color?: string, label?: string): string;  // returns overlay id
  border(selector: string, color?: string, label?: string): string;
  spotlight(selector: string): string;
  inject(selector: string, text: string, position?: 'before' | 'after'): string;
  subtitle(text: string): void;
  clearOverlays(): void;
  ask(question: string): Promise<string>;       // ask the user a plain question
  wait(ms: number): Promise<void>;
  llm?(prompt: string): Promise<string>;        // one-shot LLM call
  runSkill?(id: string, vars?: Record<string, string>): Promise<void>;
  /**
   * Open an ad-hoc Surface form mid-script and await its submission.
   * - resolves with the submitted data
   * - or `null` if the user pressed Esc / cancelled
   */
  surface(
    surface: PieceSurface,
    opts?: { placement?: 'center' | 'inline' | 'dock' }
  ): Promise<Record<string, unknown> | null>;
}
```

`tools.surface()` behaves identically to a `SurfaceSkill` — it emits a `surface` event and waits for `dddk.submitSurface(data)` / `dddk.cancelSurface()`. The difference: a ScriptSkill can drop a temporary form **mid-script** and then continue, whereas a SurfaceSkill IS one surface. See [how-to-add-a-skill.md](./how-to-add-a-skill.md) — *Mid-script Surface*.

## Skill IDs and palette integration

Skill IDs typically start with a slash because the palette treats slash-prefixed input as a skill command:

```
User types "/introduce" in the palette
  → registry.match("/introduce") → finds the `introduce` skill
  → dispatch(introduce, args)
```

Non-slash IDs work too (free-text name match). Convention: ScriptSkill / PromptSkill use a slash, ActionSkill / SurfaceSkill use plain names.

## How many built-in skills ship with the package? — **Zero.**

dotdotduck ships **no** built-in skills. Every skill is written and registered by the host (your team / your enterprise).

Why:
- Skills are business behaviour. There is no universal "sensible default."
- Anything we ship would need maintenance, docs, and i18n.
- Users assume bundled defaults are "supposed to be there" and avoid removing them — a worse outcome than no defaults at all.

For sample skills to copy from, see [cookbook.md](./cookbook.md) (cookbook is documentation, not exported code).

## Composing multiple skills

A ScriptSkill step can invoke another skill:

```ts
{
  page: '/dashboard',
  action: async (tools) => {
    await tools.runSkill('translate', { language: 'en' });
    tools.subtitle('Translation done — resuming the tour.');
  },
}
```

A PromptSkill prompt can also reference other skills: "First call /clipboard-history to find recently copied content, then ..."

## Enterprise cookbook

Full examples in [cookbook.md](./cookbook.md).
