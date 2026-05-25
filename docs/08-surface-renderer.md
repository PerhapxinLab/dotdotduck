# Surfaces — rendering structured UI

A **Surface** is dotdotduck's term for any structured UI the SDK emits — a setup form, a confirmation prompt, an agent-authored panel. Internally these are `PieceSurface` objects (a tree of typed UI primitives + an optional data model); externally they can also arrive as a flat surface envelope from a webagent or other tool.

This page covers:

- The data shape
- How a host renders a surface
- The three placements (`center` / `inline` / `dock`)
- How `SurfaceSkill` plugs into the palette
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

The built-in catalog covers: `Heading`, `Text`, `Markdown`, `Code`, `Image`, `Metric`, `Tag`, `Divider`, `Card`, `Stack`, `Row`, `Grid`, `Split`, `Tabs`, `Listing`, `Slot`. Hosts extend the catalog to add bespoke widgets — see [Pieces SDK](#extending-the-catalog) below.

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

## Surface envelope interop

The flat surface envelope is a wire format with `version`, `updateComponents`, `updateDataModel`, `updateActions`. dotdotduck ships two helpers in [pieces/surface-bridge.ts](../src/pieces/surface-bridge.ts):

```ts
import { envelopeToSurface, surfaceToEnvelope } from '@perhapxin/dddk';

// Inbound (agent → host): convert wire envelope to a renderable surface
const surface = envelopeToSurface(envelope);
if (surface) renderer.mount(surface);

// Outbound (host → agent / log): convert a renderable surface back to wire
const envelope = surfaceToEnvelope(surface, 'order-status');
```

You only need these if you're crossing the protocol boundary (e.g. piping surfaces through a server). When everything lives inside dotdotduck, work directly with `PieceSurface`.

---

## Extending the catalog

```ts
import { createBuiltinCatalog, PieceCatalog, PieceRenderer } from '@perhapxin/dddk';

const catalog = createBuiltinCatalog();
catalog.register({
  kind: 'EmployeeCard',
  meta: { category: 'content' },
  render(props, ctx) {
    return (
      <div className="emp-card">
        <strong>{props.name}</strong>
        <span>{props.title}</span>
      </div>
    );
  },
});

// Pass the extended catalog wherever you mount PieceRenderer.
```

Custom pieces live alongside built-ins — the same renderer drives both.

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

The full token list is in [11-theming](./11-theming.md).
