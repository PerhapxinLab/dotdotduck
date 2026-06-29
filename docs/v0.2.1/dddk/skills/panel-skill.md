# PanelSkill — top-input + bottom-panel runtime

> `PanelSkill` is the only one of the four skill types that has its own runtime. It opens a two-section overlay outside the palette (input on top, panel below) with a navigation stack so the user can keep typing while exploring nested content.

## When to use PanelSkill

| Skill type | When |
| --- | --- |
| `script` | A sequence of steps that ends once it's run |
| `prompt` | Map user input into a system prompt and hand off to the agent |
| `action` | One-shot handler, no persistent UI |
| `surface` | One-shot form that closes on submit |
| **`panel`** | **Sustained interaction: the user types while reading results (search, chat, recommend, browse)** |

PanelSkill characteristics:
- The input stays at the top — the user can keep editing it at any time.
- Every input change triggers `onInput(text, ctx)` (debounced, default 200 ms).
- You can push child panels; the breadcrumb updates automatically. Esc or Backspace-on-empty pops one level.
- It doesn't auto-dismiss — the user closes it explicitly (× button, Esc to the root, click backdrop).

## Skill shape

```ts
import type { PanelSkill } from '@perhapxin/dddk';

interface PanelSkill extends BaseSkill {
  type: 'panel';
  inputMode: 'palette' | 'takeover';
  inputPlaceholder?: string;
  onEnter?: (ctx: PanelSkillContext) => Promise<unknown> | unknown;
  onInput:  (text: string, ctx: PanelSkillContext) => Promise<unknown> | unknown;
  onSubmit?: (text: string, ctx: PanelSkillContext) => Promise<unknown> | unknown;
  onAction?: (action: string, data: unknown, ctx: PanelSkillContext) => Promise<unknown> | unknown;
  onLeave?: () => Promise<void> | void;
}
```

| Field | Purpose |
| --- | --- |
| `inputMode: 'palette'` | Keeps `/command` parsing and the Ask-AI fallback; free text routes to `onInput`. Good for search / qa / classify. |
| `inputMode: 'takeover'` | Hands the input entirely to `onInput`; no slash-command parsing. Good for chat / continuous webagent. |
| `inputPlaceholder` | The input's placeholder on entry. |
| `onEnter` | Runs once when the panel mounts (input is still empty). Usually calls `ctx.render(...)` for the initial view. |
| `onInput` | Fires on every (debounced) input change. |
| `onSubmit` | Fires when the user presses Enter. Most live panels don't need it — `onInput` is enough. |
| `onAction` | Fires when a Piece button / row inside the panel triggers a named action. |
| `onLeave` | Fires when the panel is popped from the stack. Use to cancel requests, unbind listeners. |

## PanelSkillContext

```ts
interface PanelSkillContext extends ActionSkillContext {
  render(surface: unknown): void;        // draws a PieceSurface into the panel
  back(): void;                          // pops the current level
  setPlaceholder(text: string): void;    // updates the input placeholder
}
```

Inherits `palette / subtitle / storage / getPreferences / llm / agent / navigate` from `ActionSkillContext`, plus three panel-specific methods.

## End-to-end example: two-level browse (list → detail)

```ts
import type { PanelSkill } from '@perhapxin/dddk';

const ordersBrowse: PanelSkill = {
  id: 'orders',
  type: 'panel',
  name: 'Orders',
  inputMode: 'palette',
  inputPlaceholder: 'Type an order # or customer name…',

  onEnter: async (ctx) => {
    // Start with the 10 most recent
    const recent = await fetch('/api/orders?limit=10').then((r) => r.json());
    ctx.render(listSurface(recent));
  },

  onInput: async (text, ctx) => {
    if (!text) {
      const recent = await fetch('/api/orders?limit=10').then((r) => r.json());
      ctx.render(listSurface(recent));
      return;
    }
    const hits = await fetch(`/api/orders?q=${encodeURIComponent(text)}`).then((r) => r.json());
    ctx.render(listSurface(hits));
  },

  onAction: async (action, data, ctx) => {
    if (action === 'open_order') {
      const id = (data as { id: string }).id;
      const order = await fetch(`/api/orders/${id}`).then((r) => r.json());
      void runtime.enter(orderDetailPanel(order));
    }
  },
};

function listSurface(orders: Array<{ id: string; customer: string; total: number }>) {
  return {
    root: {
      kind: 'Stack',
      children: orders.map((o) => ({
        kind: 'Card',
        children: [
          { kind: 'Heading', text: `${o.id} — ${o.customer}` },
          { kind: 'Text',    text: `$${o.total}` },
          { kind: 'Button',  text: 'View', action: 'open_order', data: { id: o.id } },
        ],
      })),
    },
  };
}
```

The second-level child panel reuses the same `PanelSkill` shape — its `onEnter` paints the detail view, `onInput` could search within the order's line items:

```ts
function orderDetailPanel(order: Order): PanelSkill {
  return {
    id: `order:${order.id}`,
    type: 'panel',
    name: order.id,
    hidden: true,                // don't list it in the palette
    inputMode: 'palette',
    inputPlaceholder: 'Search items in this order…',
    onEnter: (ctx) => ctx.render(detailSurface(order)),
    onInput: (q, ctx) => ctx.render(detailSurface(order, q)),
    onAction: (action, data, ctx) => {
      if (action === 'refund') ctx.agent?.(`refund order ${order.id}`);
    },
  };
}
```

Pressing Esc or Backspace-on-empty pops back to the list; the breadcrumb shows "← orders › ORD-12345".

## Lifecycle

```
host calls runtime.enter(skill)
  └─ overlay mounts (if this is the first frame)
  └─ stack.push(frame)
  └─ skill.onEnter(ctx)            ← once

user types
  └─ debounce 200 ms
  └─ skill.onInput(text, ctx)      ← every change

user clicks a Piece Button[action]
  └─ skill.onAction(action, data, ctx)

user presses Enter
  └─ skill.onSubmit?(text, ctx)

user presses Esc / Backspace-on-empty / clicks a breadcrumb
  └─ skill.onLeave?()
  └─ stack.pop()
  └─ overlay unmounts (when the stack empties)
```

## Compared to ScriptSkill / PromptSkill

| | ScriptSkill | PromptSkill | PanelSkill |
| --- | --- | --- | --- |
| Persistent UI | Per-step subtitle | None | Yes, its own overlay |
| User input | Mid-step `ask()` | One-shot (variable expansion) | Continuous typing |
| Navigation stack | None | None | Yes |
| Good for | Tutorials / tours | The same task repeated | Exploratory interaction |

## Runtime: `PanelRuntime`

PanelSkill does NOT "run itself" — the host creates a `PanelRuntime` and pushes the skill in:

```ts
import { PanelRuntime } from '@perhapxin/dddk';

const runtime = new PanelRuntime({
  host: {
    llm: (prompt) => myLLM.complete(prompt),
    navigate: (path) => router.push(path),
    renderPiece: (container, surface, onAction) => {
      mountReact(container, <PieceRenderer surface={surface} catalog={catalog} onAction={onAction} />);
    },
  },
});

// From any entry point (palette item, external button, another skill) push a panel:
await runtime.enter(ordersBrowse);
```

| API | |
| --- | --- |
| `runtime.enter(skill)` | Push and mount. |
| `runtime.back()` | Pop the top frame. |
| `runtime.close()` | Pop everything, unmount. |
| `runtime.isOpen()` | Whether the overlay is currently on screen. |
| `runtime.stackDepth()` | Current depth. |

`renderPiece` is optional. If omitted, the runtime uses a built-in fallback that recognises eight piece kinds (`Stack / Row / Card / Heading / Text / Markdown / Tag / Button`) — enough for a demo, not enough for production. Production hosts should wire `renderPiece` to a full [PieceRenderer](../surfaces/renderer.md).

## See also

- [SkillTools / SurfaceSkill](./overview.md) — the other three skill types.
- [Pieces catalog](../surfaces/pieces-catalog.md) — what gets drawn inside the panel is decided by the Piece system.
- [Placements](../surfaces/placements.md) — `PanelRuntime` mounts its own overlay and doesn't use a placement slot by default; a customised version can call `applyPlacement(el, 'palette')` instead.
