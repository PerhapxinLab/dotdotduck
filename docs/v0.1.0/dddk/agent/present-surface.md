# WebAgent — `present_surface` action

> Opt-in tool that lets the agent render a structured PieceSurface (image + text recommendation cards, option grids, confirm summaries) and await the user's pick. Default `off` — when the host doesn't enable it, the agent only narrates / manipulates the page DOM as usual.

## Why opt-in

Rich surfaces are powerful — the agent can show a 3-up product grid, a date picker, an option list with descriptions — but they're also a different threat model:

- The agent picks the image `src`, option labels, descriptions. Hallucinated content (made-up products, wrong prices) shows up as polished UI rather than obviously-questionable narration. Users trust UI more than text.
- The host has fewer levers to constrain what the surface looks like — once the agent emits a piece tree, the renderer just draws it.

Default off means hosts can adopt the rest of the SDK without thinking about this risk. Hosts who want recommendation flows opt in deliberately and tune the [persona](./prompt-design.md) + brand prompt to keep the model on-rails.

## Enabling

Two steps:

```ts
new DotDotDuck({
  // …
  webAgent: {
    allowPresent: true,                       // 1. flip the flag
    // …
  },
});

// Inside DotDotDuck.buildAgent (orchestrator does this for you):
agent.setSurfaceMounter(({ surface, placement, resolve }) => {
  // 2. wire the mounter — render the surface, listen for user pick,
  //    call `resolve({ value, cancelled })` when done.
});
```

The orchestrator ships a default mounter that renders into the subtitle bar / modal / dock based on `placement`. Override it if you need custom routing.

## Tool shape

```ts
present_surface({
  surface: {
    root: PieceNode,
    data?: Record<string, unknown>,
  },
  placement?: 'subtitle' | 'modal' | 'dock' | 'inline',  // default 'subtitle'
}): Promise<{ value: string | null; cancelled: boolean }>
```

The agent calls this once per "let the user pick something" beat. Returns synchronously to the agent loop with the chosen option's `value`, or `cancelled: true` if the user dismissed.

`placement` is restricted to 4 values (not the full 8-slot `PlacementSlot` enum). The agent cannot choose `fab`, `banner`, `toast`, `indicator` — those have semantics that should be host-controlled, not agent-controlled.

## When the agent picks `present_surface` vs other tools

| User intent | Right tool |
|---|---|
| "Yes or no — confirm?" | `ask_user_choice({ question, options: ['yes', 'no'] })` |
| "What's your email?" | `ask_user({ question })` |
| "Pick one of these 3 products" (with images) | **`present_surface`** |
| "Pick one of these 3 plans" (with descriptions) | **`present_surface`** (or `ask_user_choice` with text-only options if simple) |
| Delete / submit / pay → confirm | runtime auto-confirm gate, no special action |

For host commands (theme toggle, translation, search, etc.), register a **semantic intent tool** via `dddk.tools.register({...})` — e.g. `immersive_translate({language})`, `set_theme({mode})`. The handler internally drives the palette UI animation if visual feedback matters. See `triggers/palette.md` § "Two ways the agent reaches palette items".

Rule of thumb: use `present_surface` when the *visual* of the choice matters (product images, plan tiers with their own metadata). Use `ask_user_choice` when 2-6 short text strings are enough.

## Example — agent emits a recommendation grid

User asks "Help me find a gift for someone who loves coffee." Agent reasons, calls `present_surface`:

```json
{
  "tool": "present_surface",
  "args": {
    "surface": {
      "root": {
        "kind": "OptionGroup",
        "bind": "pick",
        "layout": "row",
        "columns": 3,
        "options": [
          {
            "value": "g1",
            "title": "Pour-over kit",
            "description": "Ceramic dripper + filters + carafe",
            "meta": ["US$45"],
            "image": { "src": "/catalog/pour-over.jpg" }
          },
          {
            "value": "g2",
            "title": "Burr grinder",
            "description": "40 stepless grind settings",
            "meta": ["US$120"],
            "image": { "src": "/catalog/grinder.jpg" }
          },
          {
            "value": "g3",
            "title": "Single-origin sampler",
            "description": "3 bags from different origins",
            "meta": ["US$60"],
            "image": { "src": "/catalog/sampler.jpg" }
          }
        ]
      }
    },
    "placement": "modal"
  }
}
```

User clicks the burr grinder → tool resolves `{ value: 'g2', cancelled: false }` → agent's next turn knows the user picked g2 and can `navigate('/cart/add?sku=g2')` or whatever the flow demands.

## Locking the surface schema

For e-commerce-style scenarios, you'll want to constrain WHAT the agent can emit (only your real product images, not arbitrary URLs). Two options:

### Option 1 — `appendSystemPrompt` with constraints

```ts
appendSystemPrompt: `
# Surface constraints (when calling present_surface)

- Image \`src\` MUST come from /catalog/<sku>.jpg. Do not invent URLs.
- Available SKUs: g1, g2, g3, g4, g5 (call \`list_catalog\` first if unsure).
- Each option's \`value\` MUST be a SKU from the list above.
`,
```

Quickest path; relies on the model following instructions.

### Option 2 — Custom catalog override

Replace the builtin `MediaCard` / `OptionGroup` in your `PieceCatalog` with versions that take only an `sku` (host resolves to image URL + price internally). The model can't emit arbitrary image URLs because the schema doesn't have an `image.src` field.

```ts
catalog.register({
  kind: 'MediaCard',
  // override — only accepts sku, not src
  render: (node, ctx) => {
    const product = lookupBySku(node.sku as string);
    if (!product) return null;
    return <ProductTile product={product} />;
  },
});
```

This is the safer pattern for shopping flows.

## Sequencing — surface → action

The typical agent flow with `present_surface`:

```
turn N:
  memory: "Last turn: surfaced 3 gift options. Still remaining: collect user's pick."
  todos_remaining: ["collect gift pick", "add picked sku to cart"]
  actions: [
    { tool: 'present_surface', args: { surface: { ... } } }
  ]

→ user picks 'g2' → tool returns { value: 'g2', cancelled: false }

turn N+1:
  memory: "Last turn: user picked g2 (burr grinder). Still remaining: add to cart."
  todos_remaining: ["add g2 to cart"]
  actions: [
    { narrate: "Adding the burr grinder to your cart now." },
    { tool: 'navigate', args: { path: '/cart/add?sku=g2' } },
    { task_finish: true }
  ]
```

`present_surface` is a turn-boundary action — the agent emits it, the user interacts, the next turn sees the result. Don't put narration before / after it in the same envelope; the narration would either auto-pause (annoying right before a picker) or run after the picker is dismissed (confusing).

## Intent stream

Every surface interaction fires intents:

- `palette_activated` is NOT fired (this isn't a palette command).
- `agent_answered` IS fired with `via: 'gesture' | 'text'` and `answer: <chosen value or empty>`.
- On cancel: `agent_answered` with `answer: ''`.

So dashboards see the same `agent_answered` aggregation regardless of whether the user picked via subtitle-bar choice picker or a rich surface.

## See also

- [composition.md](../surfaces/composition.md) — how to build the piece tree
- [pieces-catalog.md](../surfaces/pieces-catalog.md) — full piece reference
- [prompt-design.md](./prompt-design.md) — adding constraints via persona + brand
