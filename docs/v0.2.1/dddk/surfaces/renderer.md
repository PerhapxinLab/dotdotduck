# Surfaces — rendering structured UI

A **Surface** is dotdotduck's term for any structured UI the SDK emits — a setup form, a confirmation prompt, an agent-authored panel. Internally these are `PieceSurface` objects (a tree of typed UI primitives + an optional data model); externally they can also arrive as a flat surface envelope from a webagent or other source.

This page covers:

- The data shape
- How a host renders a surface
- The three placements (`center` / `inline` / `dock`)
- How `SurfaceSkill` plugs into the palette
- Extending the catalog (cookbook — abridged)
- Using the surface envelope bridge
- Theming

---

## The data shape

```ts
import type { PieceSurface, PieceNode } from '@perhapxin/dddk';

const surface: PieceSurface = {
  root: {
    kind: 'Card',
    children: [
      { kind: 'Heading', text: 'Refund this order?' },
      { kind: 'Text',    text: 'Order ORD-1002 — $990 — Bob Lin' },
      {
        kind: 'Row',
        children: [
          { kind: 'Button', text: 'Refund',  action: 'submit' },
          { kind: 'Button', text: 'Cancel',  action: 'cancel' },
        ],
      },
    ],
  },
  data: { /* optional initial data model for `bind:` fields */ },
};
```

Each `PieceNode` has:

- `kind` — looked up in a `PieceCatalog`
- `id` — optional, for partial updates by id
- `bind` — optional, JSON Pointer into `data` for inputs
- other props specific to its kind (`text`, `children`, `action`, …)

The built-in catalog covers: `Heading`, `Text`, `Markdown`, `Code`, `Image`, `Metric`, `Tag`, `Divider`, `Card`, `Stack`, `Row`, `Grid`, `Split`, `Tabs`, `Listing`, `Slot`. Hosts extend the catalog to add bespoke widgets — see [Extending the catalog](#extending-the-catalog-cookbook) below.

---

## Rendering a surface in a host

dotdotduck emits a `surface` event whenever a skill or webagent produces one. The host owns the rendering:

```tsx
import { useEffect, useState } from 'react';
import { PieceRenderer, createBuiltinCatalog, type PieceSurface } from '@perhapxin/dddk';

const catalog = createBuiltinCatalog();

function App({ dotdotduck }) {
  const [active, setActive] = useState<{ surface: PieceSurface; placement: string } | null>(null);

  useEffect(() => {
    const handler = (payload: { surface: unknown; placement: string }) =>
      setActive({ surface: payload.surface as PieceSurface, placement: payload.placement });
    dotdotduck.on('surface', handler);
    return () => dotdotduck.off('surface', handler);
  }, [dotdotduck]);

  if (!active) return null;
  return (
    <SurfaceShell placement={active.placement} onDismiss={() => setActive(null)}>
      <PieceRenderer
        surface={active.surface}
        catalog={catalog}
        onAction={(action, data) => {
          // submit / cancel / your custom action names
          if (action === 'cancel') setActive(null);
        }}
      />
    </SurfaceShell>
  );
}
```

`SurfaceShell` is yours — a modal wrapper, a sticky dock, an inline strip. The point of dotdotduck's three placements is that the *host* decides where each lands; the SDK just hands you the tree.

---

## Placements

The orchestrator emits `placement: 'center' | 'inline' | 'dock'` so the host can switch between three patterns without rewriting the catalog:

| Placement | What it's for                                       | Steals focus? |
| --------- | --------------------------------------------------- | ------------- |
| `center`  | Full form / confirmation modal                      | Yes — backdrop + click-outside cancels |
| `inline`  | Short confirmation strip above the subtitle bar     | No — user keeps reading the page |
| `dock`    | Persistent side panel (progress tracker, task list) | No — stays visible while user works |

dotdotduck's preferences setup form (rendered automatically when a `SurfaceSkill` declares unfilled `required: true` prefs) defaults to `center`. Host can pass a different `placement` when invoking the renderer.

---

## SurfaceSkill — palette-triggered surfaces

```ts
import type { SurfaceSkill } from '@perhapxin/dddk';

const orderStatus: SurfaceSkill = {
  id: 'order-status',
  name: 'Order status',
  description: 'Look up an order',
  type: 'surface',

  async build(ctx) {
    return {
      root: {
        kind: 'Stack',
        children: [
          { kind: 'Heading', text: 'Order status' },
          { kind: 'TextInput', id: 'orderId', bind: '/orderId', placeholder: 'ORD-1002' },
          { kind: 'Button',    text: 'Look up', action: 'submit' },
        ],
      },
      data: { orderId: '' },
    };
  },

  async onSubmit(data, ctx) {
    const order = await fetch(`/api/orders/${data.orderId}`).then((r) => r.json());
    // Return another surface for a multi-step flow, or `undefined` to close.
    return {
      root: {
        kind: 'Card',
        children: [
          { kind: 'Heading', text: `${order.id} — $${order.total}` },
          { kind: 'Text',    text: `Customer: ${order.customer}` },
        ],
      },
    };
  },
};
```

Lifecycle:

1. User types `/order-status` in the palette and hits Enter
2. dotdotduck calls `skill.build(ctx)` → gets a `PieceSurface`
3. dotdotduck emits `surface` event with placement `center`
4. Host renders via `PieceRenderer` (see above)
5. User fills the form, hits the `submit`-action button
6. Host calls `skill.onSubmit(formData, ctx)`
7. Return value: another surface (multi-step), or `undefined` (close)

---

## Extending the catalog — cookbook

> This is the abridged "minimum to grok the concept" version. For the full deep-dive — `PieceCatalog` class, `PieceContext`, `propsSchema`, overriding builtins, Slot vs. catalog trade-offs — see [pieces-catalog](./pieces-catalog.md).

The catalog is a string-keyed lookup: `kind: 'EmployeeCard'` in a node resolves to a `PieceDefinition.render(props, ctx)` function. Adding your own piece is three steps.

### 1. Define the TS shape of your piece's props

```ts
import type { PieceNode } from '@perhapxin/dddk';

interface EmployeeCardProps extends PieceNode {
  kind: 'EmployeeCard';
  name: string;
  title: string;
  avatarUrl?: string;
}
```

Just an interface — no runtime cost. dddk types its node bag loosely on purpose so hosts can extend without re-generating types.

### 2. Write the render function

```tsx
import type { PieceDefinition } from '@perhapxin/dddk';

const EmployeeCard: PieceDefinition = {
  kind: 'EmployeeCard',
  meta: { category: 'content', description: 'Employee summary card' },
  render: (node, ctx) => {
    const p = node as EmployeeCardProps;
    return (
      <div data-dddk-piece="employee-card" className="emp-card">
        {p.avatarUrl && <img src={p.avatarUrl} alt="" />}
        <strong>{p.name}</strong>
        <span>{p.title}</span>
      </div>
    );
  },
};
```

Two arguments: `node` (the `PieceNode` itself — kind, id, your custom props) and `ctx` (`{ data, setBinding, trigger, render }`). To recurse into children, call `ctx.render(childNode)`. To fire an action handled by `onAction` on `PieceRenderer`, call `ctx.trigger('actionName', payload)`. To read/write a `bind`-attached data path, use `ctx.setBinding`.

### 3. Register it with the catalog

```ts
import { createBuiltinCatalog, PieceRenderer } from '@perhapxin/dddk';

const catalog = createBuiltinCatalog();   // 33 builtins
catalog.register(EmployeeCard);

// Pass the same catalog wherever you mount the renderer:
<PieceRenderer surface={surface} catalog={catalog} onAction={handleAction} />
```

Your custom piece coexists with the builtins — same renderer drives both. Any surface (skill-emitted, agent-authored, host-handwritten) that uses `kind: 'EmployeeCard'` will resolve to your render function.

That's the whole loop. When you need finer control — overriding `Button`, declaring a JSON Schema for LLM agents to author against, deciding catalog-register vs. `Slot` escape-hatch — open [pieces-catalog](./pieces-catalog.md).

---

## Using the surface envelope bridge

A **surface envelope** is the flat wire format used when surfaces cross a process boundary (e.g. a webagent running inside a worker posts a UI description back to the host). It's a list of components keyed by id, plus a data model. Our `PieceSurface` is the nested tree the renderer wants. The bridge converts between them.

dddk ships two helpers in [`pieces/surface-bridge.ts`](../../../dddk/src/pieces/surface-bridge.ts):

```ts
import { envelopeToSurface, surfaceToEnvelope } from '@perhapxin/dddk';
```

### Use case: agent posts an envelope from a worker, host renders it

```ts
// Worker side — the agent has authored UI and wants to show it to the user
self.postMessage({
  type: 'render-surface',
  envelope: {
    version: 'v0.10',
    updateComponents: {
      surfaceId: 'agent-result',
      components: [
        { id: 'root', component: 'Card', children: ['heading', 'body'] },
        { id: 'heading', component: 'Heading', text: 'Found 3 matches' },
        { id: 'body',    component: 'Listing', items: [/* … */] },
      ],
    },
    updateDataModel: {
      surfaceId: 'agent-result',
      data: { /* … */ },
    },
  },
});
```

```tsx
// Host side — receive, convert, render
import { envelopeToSurface, PieceRenderer, createBuiltinCatalog } from '@perhapxin/dddk';

const catalog = createBuiltinCatalog();

worker.onmessage = (e) => {
  if (e.data.type !== 'render-surface') return;
  const surface = envelopeToSurface(e.data.envelope);
  if (!surface) return;          // empty / malformed envelope
  setActive(surface);            // hand it to your renderer state
};

// Same PieceRenderer call as before — the bridge gave you a normal PieceSurface
<PieceRenderer surface={active} catalog={catalog} onAction={handleAction} />;
```

`envelopeToSurface` does the heavy lifting:

- Picks the component with `id: 'root'` as the tree root, falling back to the first component if there's no explicit root.
- Resolves `children: string[]` (ids) into nested `PieceNode` objects.
- Cycle-guards: if envelope A lists B as a child and B lists A back, the descent stops instead of stack-overflowing.

Returns `null` if the envelope has no components.

### Reverse direction — host hands a surface back to the agent

When the host has hand-authored a surface and wants to send it cross-process (to log it, replay it in tests, hand it to a server-side agent that operates on the wire format), use `surfaceToEnvelope`:

```ts
import { surfaceToEnvelope } from '@perhapxin/dddk';

const envelope = surfaceToEnvelope(surface, 'order-status');
// envelope is now the flat shape — JSON-safe, postMessage-safe, fetch-body-safe
worker.postMessage({ type: 'surface-snapshot', envelope });
```

The second argument is the `surfaceId` to stamp into the envelope (defaults to `'default'`). Node `id`s that already exist are preserved; missing ones get `auto_1`, `auto_2`, … so the children-by-id references resolve correctly.

### When you DON'T need the bridge

If everything stays inside dddk — skill emits `PieceSurface`, host renders with `PieceRenderer`, user clicks a button, host calls `skill.onSubmit(data)` — you never touch the envelope shape. The bridge is for the boundary; inside, work with the tree directly.

---

## Theming

The renderer uses dotdotduck's design tokens. Hosts theme via plain CSS variables on a parent element (typically `:root`):

```css
:root {
  --dddk-bg-elevated: #fff;
  --dddk-text:        #111;
  --dddk-radius:      10px;
  --dddk-accent:      #6366f1;
}
```

The full token list is in [theming](../theming.md).
