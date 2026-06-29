# Overlay helpers

> The agent only has `border` as an overlay tool — but the **whole overlay toolkit** is exported from `@perhapxin/dddk` so the host can use it directly. Build a tour, debug a selector, render highlights from your own UI layer, or wrap the agent in a custom UX shell. dddk's orchestrator uses `clearOverlays()` on agent done/error.

## What's exported

```ts
import {
  border,
  highlight,
  spotlight,
  inject,
  removeOverlay,
  clearOverlays,
  listOverlays,
} from '@perhapxin/dddk';
```

All five **create** functions return an overlay id (string). All overlay DOM nodes carry `data-webagent-overlay="<type>"` and `data-overlay-id="<id>"` for easy lookup.

| Helper | Type tag | Returns | Notes |
|---|---|---|---|
| `border(selector, color?, label?)` | `border` | `id` or `''` if selector misses | The **only** overlay primitive currently exposed as an agent action. |
| `highlight(selector, color?, label?)` | `highlight` | `id` or `''` | Yellow background by default. Label renders above. |
| `spotlight(selector)` | `spotlight` | `id` or `''` | Dims everything else with a 9999px box-shadow. |
| `inject(selector, text, position?)` | `inject` | `id` or `''` | Inserts a styled text node before/after the target (not an overlay rectangle). |
| `removeOverlay(id)` | — | `void` | Removes the matching overlay **and** its label sibling (`{id}_label`). |
| `clearOverlays()` | — | `void` | Removes every `[data-webagent-overlay]` element. |
| `listOverlays()` | — | `OverlayItem[]` | Snapshot of currently-mounted overlays. |

Empty-string return means the selector didn't match anything. The functions don't throw — failed selectors are expected when DOM is mid-flux.

## Why the host might call these directly

The agent's perspective is "I called `border()` and the user sees a box." Hosts have other reasons:

- **Onboarding tour** — `border()` + `spotlight()` driven by your tour state machine, no agent involved.
- **Selector debugging** — paste a CSS selector into a devtools input and `border()` it to see what matches.
- **Custom agent shell** — you rendered your own subtitle / sidebar UI, and you want to highlight what the agent is currently working on without going through `agent.executeAction('border', ...)`.
- **Migration** — `listOverlays()` lets you snapshot, switch UI mode, and restore.
- **Cleanup on lifecycle** — `clearOverlays()` on route change, agent done, agent error.

## `border(selector, color?, label?)`

The default agent overlay. Draws a 2px solid border around the target, optionally with a small label floating above:

```ts
const id = border('#submit-button', '#10b981', 'Click here');
// later
removeOverlay(id);
```

Defaults: `color = #ff9800`, no label. Color accepts any CSS color string (hex, rgb, named).

The label is a separate DOM node with id `{id}_label` — `removeOverlay(id)` cleans both up via prefix match.

## `highlight(selector, color?, label?)`

Same call shape as `border`, but paints a translucent yellow background instead of a border. Default `rgba(255, 235, 59, 0.4)`.

```ts
highlight('.error', 'rgba(239,68,68,0.3)', 'Validation failed');
```

Useful for "this row matters" without obscuring it.

## `spotlight(selector)`

Surrounds the target with a 9999px box-shadow that dims the rest of the page. No label, no color knob — by design, spotlight is the strongest visual statement and shouldn't be customised in flight.

```ts
const id = spotlight('#onboarding-step-2');
// on advance
removeOverlay(id);
spotlight('#onboarding-step-3');
```

## `inject(selector, text, position?)`

Not a rectangle overlay — inserts an actual text node before or after the target. Styled with a yellow background and orange left border so it visibly stands out:

```ts
inject('input[name="email"]', 'Use your work email', 'after');
inject('h1', 'Read me first ↓', 'before');
```

`position` defaults to `'after'`. Useful for inline hints the agent (or your tour) wants to leave on the page.

## `removeOverlay(id)`

Removes any overlay whose `data-overlay-id` **starts with** the given id. That prefix match is what cleans up the label sibling (`{id}_label`) in the same call:

```ts
const id = border('#cta', '#10b981', 'Click here');
removeOverlay(id);  // removes both the border AND the label
```

If the id doesn't match anything, this is a no-op.

## `clearOverlays()`

Brute-force: removes every `[data-webagent-overlay]` element on the page. This is what dddk's orchestrator calls on agent done / agent error so a half-finished tour doesn't outlive the session:

```ts
agent.on('done',  () => clearOverlays());
agent.on('error', () => clearOverlays());
```

It only touches webagent overlays — your app's own absolutely-positioned elements are safe (no `data-webagent-overlay` attribute).

## `listOverlays()`

Returns the current set as `OverlayItem[]`:

```ts
interface OverlayItem {
  id: string;
  type: 'border' | 'highlight' | 'spotlight' | 'inject' | 'label';
  selector: string;
  label?: string;
  text?: string;
  position?: 'before' | 'after';
}
```

Useful for debugging ("what's actually on screen?") or migration (snapshot, swap UI, restore). Label nodes appear as their own entries with `type: 'label'`.

```ts
console.table(listOverlays());
```

## Re-positioning on resize / scroll

The helpers compute position at create time using `getBoundingClientRect()` and don't auto-update. If your layout reflows (resize, accordion open, virtualized list scroll), call `clearOverlays()` and re-create from your source-of-truth, or roll your own ResizeObserver loop that re-applies positions.

Auto-reposition was deliberately left out — most agent flows are short enough that the snapshot-at-create-time model is fine, and it's the smallest contract that fits both the agent and the host use cases.

## CSS variables for theming

The injected stylesheet (`#webagent-overlay-style`) reads CSS variables you can override:

| Variable | Default | What it tints |
|---|---|---|
| `--webagent-highlight` | `rgba(255, 235, 59, 0.4)` | `highlight` background |
| `--webagent-border` | `#ff9800` | `border` color |
| `--webagent-label-bg` | `#1a1a1a` | label background |
| `--webagent-inject-bg` | `rgba(255,235,59,0.6)` | `inject` background |
| `--webagent-accent` | `#ff9800` | `inject` left-border |

```css
:root {
  --webagent-border: #10b981;
  --webagent-highlight: rgba(16, 185, 129, 0.2);
}
```

The `color` arg to `border` / `highlight` wins over the CSS variable — variables are the default theme, per-call colors are the override.

## See also

- [Actions catalog](./catalog.md) — what's wired up as agent tools (`border` is in, the rest are host-only by default).
- [Public API](../api.md) — `agent.executeAction(name, params)` lets the host fire an action by name.
