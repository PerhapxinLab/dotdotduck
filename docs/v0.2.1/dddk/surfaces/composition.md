# Composing rich layouts

> Patterns for image + text + interactive option surfaces, without the "every piece is a card with a border" stacking-frames problem.

The four layout pieces (`Group`, `MediaCard`, `OptionGroup`, `ChoiceList`) are designed to compose: pick the right outer shape, drop in the right inner items, and you get an e-commerce-style recommendation surface in 20 lines of JSON.

## The composition rules

1. **One envelope per surface.** A `Card` (or the placement's own framing — `subtitle` already has a bar, `palette` already has a panel) is the visual container. Don't nest a second Card inside.
2. **`Group` for transparent stacking.** Inside the envelope, use `Group` to cluster related children. It has no border / shadow / background — children render edge-to-edge against the surrounding envelope.
3. **`MediaCard` is content, not container.** Its own background is transparent. Drop it inside `Card` for a single hero, or inside `OptionGroup` for one-of-many.
4. **Selection state lives in `data`.** All input pieces (`OptionGroup`, `ChoiceList`, `Picker`, etc.) bind to a `data.<key>` path. Read it back from the same path after `trigger('choose', …)` fires.

## Pattern 1 — Image + text intro, options below

A common proactive recommendation flow: explain what you're recommending, show 3 picks, let the user choose.

```ts
{
  root: {
    kind: 'Card',
    children: [
      {
        kind: 'MediaCard',
        orientation: 'left',
        image: { src: '/recommend.png', alt: '', aspectRatio: '1' },
        title: 'Based on your recent reads',
        description: 'Three picks we think you\'ll like — pick one or skip.',
      },
      { kind: 'Divider' },
      {
        kind: 'OptionGroup',
        bind: 'pick',
        layout: 'column',
        options: [
          { value: 'b1', title: 'Book A', description: 'Genre · 320 pp', image: { src: '/b1.jpg' } },
          { value: 'b2', title: 'Book B', description: 'Genre · 192 pp', image: { src: '/b2.jpg' } },
          { value: 'b3', title: 'Book C', description: 'Genre · 410 pp', image: { src: '/b3.jpg' } },
        ],
      },
    ],
  },
}
```

Layout: outer `Card` is the only framed container; `MediaCard` is the intro (left-aligned image + prose); `Divider` separates intro from picker; `OptionGroup` is the picker. No nested borders.

## Pattern 2 — 3-up horizontal recommendation grid

Same data but for a wider surface (modal or dock):

```ts
{
  root: {
    kind: 'Card',
    children: [
      { kind: 'Heading', text: 'Pick your plan', level: 3 },
      {
        kind: 'OptionGroup',
        bind: 'plan',
        layout: 'row',
        columns: 3,
        options: [
          { value: 'starter', title: 'Starter', description: 'For solo devs', meta: ['US$10/mo'], image: { src: '/p-starter.png' } },
          { value: 'pro',     title: 'Pro',     description: 'For small teams', meta: ['US$49/mo'], image: { src: '/p-pro.png' } },
          { value: 'team',    title: 'Team',    description: 'For growing orgs', meta: ['US$199/mo'], image: { src: '/p-team.png' } },
        ],
      },
    ],
  },
}
```

`layout: 'row'` + `columns: 3` → CSS grid `repeat(3, 1fr)`. Each option is a vertical tile with image on top, text below.

## Pattern 3 — Text-only quick pick

When images are overkill:

```ts
{
  root: {
    kind: 'ChoiceList',
    bind: 'route',
    orientation: 'column',
    options: [
      { value: 'continue', label: 'Continue here', description: 'Keep reading on this page' },
      { value: 'docs', label: 'See the docs', description: 'Open the reference manual' },
      { value: 'demo', label: 'Try the demo', description: 'Open the live playground' },
    ],
  },
}
```

No outer `Card` needed — the subtitle bar / palette body is the envelope.

## Pattern 4 — Group within a Card (no nested borders)

Two clusters of related fields, visually separated without two Card frames:

```ts
{
  root: {
    kind: 'Card',
    children: [
      { kind: 'Heading', text: 'Account settings', level: 4 },
      {
        kind: 'Group',
        children: [
          { kind: 'Text', text: 'Profile' },
          { kind: 'TextField', bind: 'name', placeholder: 'Display name' },
          { kind: 'TextField', bind: 'email', placeholder: 'Email' },
        ],
      },
      { kind: 'Divider' },
      {
        kind: 'Group',
        children: [
          { kind: 'Text', text: 'Notifications' },
          { kind: 'Switch', bind: 'emailNotify', label: 'Email me about replies' },
          { kind: 'Switch', bind: 'digestWeekly', label: 'Weekly digest' },
        ],
      },
    ],
  },
}
```

## Keyboard navigation

`OptionGroup` and `ChoiceList` both ship with built-in arrow-key navigation, Enter / Space confirm, and roving tabindex (only the selected tile is tab-able; arrow keys move within the group, Tab moves out of the group entirely).

Per layout:
- `layout: 'row'` / `orientation: 'row'` → ←/→ moves focus, ↑/↓ also works
- `layout: 'column'` / `orientation: 'column'` → ↑/↓ moves focus, ←/→ also works

Confirm is always Enter OR Space, fires `ctx.trigger('choose', { value, index })`.

## Where these surfaces appear

- **Proactive prompts** — set `surface.pieces` on a `PromptDefinition` (see [proactive overview](../modules/proactive/overview.md)). Replaces the default yes/no Card.
- **WebAgent** — opt in with `WebAgentConfig.allowPresent: true`, then the agent can call the `present_surface` action with a piece tree. See [present-surface.md](../agent/present-surface.md).
- **Skills / palette** — `dddk.surfaces.render(surface, { placement })` mounts any piece tree at any [placement](./placements.md).

## What NOT to do

| ❌ Anti-pattern | ✅ Fix |
|---|---|
| `Card` inside `Card` | outer `Card` only; inner `Group` for clustering |
| `OptionGroup` inside `Card` and the Card has its own border | drop the outer Card — `OptionGroup` items already have selection borders |
| Each tile is itself a `Card` | use `MediaCard` (transparent) instead |
| Mixing `Picker` (native select) with `ChoiceList` (custom) for similar choices | pick one; `ChoiceList` if you want descriptions / wider hit targets, `Picker` if you want a compact dropdown |
| Trigger an action from `MediaCard` directly | wrap in `OptionGroup` with one option, or use `Button` next to it |
