# How to register palette commands

A **palette item** is a row in the command palette. Use them for nav shortcuts, quick toggles, anything you want users to invoke with `Ctrl+K + a few keys`.

```ts
dotdotduck.palette.addItem({
  id: 'go-billing',
  name: 'Open Billing',
  description: 'See invoices and payment history',
  section: 'Navigation',
  icon: '◇',
  handler: (p) => {
    p.close();
    yourRouter.push('/billing');
  },
});
```

That's the minimum. Drops into the palette, ranks against fuzzy matches, fires `handler` when chosen.

---

## How a row renders

```
[icon]  [prefix-pill]  Name  —  description text here          ⌘B
   ◇       nav:        Try It —  立即體驗 — 跑一遍 dotdotduck 的互動    ↵
```

Every part is optional except `name`. `description` (the bit after the dash) is muted, longer-form text — use it to remind the user what the row does or where it leads.

---

## Field reference

```ts
interface PaletteItem {
  id: string;                  // unique key; used by HeatRank for usage sorting
  name: string;                // primary label
  description?: string;        // shown after an em-dash, muted
  icon?: string;               // single glyph — monochrome Unicode is the house style
  section?: string;            // groups rows ("Navigation", "Settings", …)

  prefix?: string | string[] | { match: string | string[]; label?: string };
  prefixAcceptsAnyArg?: boolean;
  fallback?: boolean;

  shortcut?: string;           // visual hint on the far right ("⌘B", "↵", etc.)
  agentTool?: PaletteAgentTool;
  handler?: (handle: PaletteHandle, arg?: string) => void;
  detail?: (arg?: string) => PieceSurface | Promise<PieceSurface>;
}
```

The handler receives:

```ts
interface PaletteHandle {
  close(): void;
  replace(items: PaletteItem[]): void;          // swap the list (sub-menu)
  setMode(mode: 'search' | 'chat'): void;
  input: string;
  setInput(value: string): void;
  context: PaletteContext;                       // selection + image attachments
  showResult(surface: ResultSurface): void;      // in-place result mode
  clearResult(): void;
}
```

---

## How prefix routing actually works

There are three ways the palette filters rows:

### 1. No prefix, no query (empty input)
Every registered item shows, grouped by `section`. (Hosts can also opt into a *Tips* section at the top — see below.)

### 2. No prefix, with a query like `tri`
Fuzzy match against `name + description + keywords`. Highest score floats to the top.

### 3. Input starts with a registered prefix — e.g. `nav:`
Two sub-cases:

**(a) The matching item has `prefixAcceptsAnyArg: true`** — the item itself becomes the top row, and the post-prefix text (`arg`) is what gets handed to its handler. Use this for free-form prompts like `ask ai: anything`.

**(b) No `prefixAcceptsAnyArg` (or multiple items share the prefix)** — the post-prefix text fuzzy-matches against the *names* of the items that share that prefix. So `nav: try it` filters the `nav:`-prefixed items by name, surfaces `Try It`, and Enter fires *that* item's handler.

```ts
// Multiple items share `nav:` — typing `nav: try` filters to Try It.
const NAV = [
  { id: 'go-home', name: 'Home',    description: '首頁',   path: '/'    },
  { id: 'go-try',  name: 'Try It',  description: '立即體驗', path: '/try' },
  { id: 'go-docs', name: 'Docs',    description: '文件',   path: '/docs' },
];
for (const n of NAV) {
  dotdotduck.palette.addItem({
    id: n.id,
    name: n.name,
    description: n.description,
    prefix: 'nav:',
    section: 'Navigation',
    handler: (p) => { p.close(); router.push(n.path); },
  });
}
```

You — the host — choose:

- the prefix string (`nav:`, `@`, `>`, `go:` — whatever fits your product)
- the item names that match
- what the handler does on activation
- which items belong to the group (anything sharing the same `prefix`)

dotdotduck doesn't ship any built-in prefixes. The Tips section, the navigation set, `/theme` toggles, `ask ai:` — all of those are host-registered. If you don't add them, they don't exist.

---

## Pattern: free-form prefix — `ask ai: ...`

```ts
dotdotduck.palette.addItem({
  id: 'ask-ai',
  name: 'Ask AI',
  description: 'Ask anything — webagent will handle it',
  prefix: 'ask ai:',
  prefixAcceptsAnyArg: true,
  fallback: true,                  // also show when nothing else matches
  icon: '✦',
  section: 'AI',
  handler: (p, arg) => {
    p.close();
    if (arg) dotdotduck.startAgent(arg);
  },
});
```

Multiple prefixes for the same item:

```ts
prefix: ['/ai', 'ask ai:', '?'],
```

Display label different from match key:

```ts
prefix: { match: ['/ai', 'ask:'], label: '/ai' },
```

---

## Pattern: quick toggle

```ts
let darkMode = false;

dotdotduck.palette.addItem({
  id: 'toggle-dark',
  name: 'Toggle light / dark mode',
  description: '切換暗色 / 亮色',
  section: 'Settings',
  icon: '◐',
  handler: (p) => {
    p.close();
    darkMode = !darkMode;
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
  },
});
```

For a more ergonomic version of this exact toggle, use the built-in `ThemeToggleModule` — see [04-how-to-toggle-features](./04-how-to-toggle-features.md).

---

## Pattern: opt-in as agent tool

Mark a palette item with `agentTool` and webagent can invoke it mid-task.

```ts
dotdotduck.palette.addItem({
  id: 'refund-order',
  name: 'Refund order',
  prefix: 'refund:',
  prefixAcceptsAnyArg: true,
  icon: '↩',
  agentTool: {
    description: 'Refund the order whose ID is passed as `arg`. Requires confirmation.',
    parameters: {
      type: 'object',
      properties: { arg: { type: 'string', description: 'Order ID like ORD-1002' } },
      required: ['arg'],
    },
    requireConfirmation: true,
  },
  handler: async (p, arg) => {
    p.close();
    if (!arg) return;
    await fetch(`/api/orders/${arg}/refund`, { method: 'POST' });
  },
});
```

If the agent gets the task "refund Bob's order", it can find the order and then call `refund-order` with `arg='ORD-1002'`. `requireConfirmation: true` triggers a confirm dialog first.

Items without `agentTool` are never exposed to the agent — opt-in by design.

---

## Pattern: image attach (camera button)

Show a camera button at the right of the input. Off by default — opt in via the `DotDotDuck` constructor:

```ts
new DotDotDuck({
  // …
  camera: {
    mode: 'screenshot',                          // or 'upload'
    title: 'Attach a frame of the page below',
    onCapture: (file, source) => {
      // The blob is also auto-pushed to palette.context.attachments,
      // so a handler can grab it without you re-wiring anything.
    },
    accept: 'image/*',
    capture: true,                                // mobile only: open camera directly
  },
});
```

Switch modes at runtime: `dotdotduck.palette.setCameraMode('screenshot')`.

---

## Tips section — host-curated, not auto-generated

dddk does not auto-build a Tips section. If you want one, register items with `section: 'Tips'` like any other section. The convention is:

- `name === prefix label` (so the SDK hides the redundant bold name slot and the row reads as `<prefix-pill> — <desc>`)
- `handler: (h) => h.setInput(prefix)` so clicking seeds the prefix into the input rather than executing anything

```ts
const TIPS = [
  { prefix: 'nav:',    desc: 'jump to a page' },
  { prefix: 'ask ai:', desc: 'free-form question to the agent' },
];
for (const t of TIPS) {
  palette.addItem({
    id: `tip-${t.prefix}`,
    name: t.prefix,
    description: t.desc,
    prefix: t.prefix,
    prefixAcceptsAnyArg: true,
    section: 'Tips',
    handler: (h) => h.setInput(t.prefix),
  });
}
```

Tips items only show in the empty-state list. The SDK filters them out when the user is mid-typing or has a prefix match, so they never duplicate the concrete commands they hint at.

---

## Pinned context — pre-load the chip bar before opening

A host module (Dwell, Spotter, a "select an element" feature, etc.) can hand the palette a context string + selector to surface on the *next* open:

```ts
dddk.palette.setPinnedContext('The selected order: ORD-1002 — Bob Lin — $990', '#row-ORD-1002');
// later — user hits Ctrl+K:
//   chip-bar shows "CONTEXT: The selected order: ORD-1002 — Bob Lin — $990"
//   palette.context.selectionText / .selectionElement available to skill handlers
```

The pin is sticky across multiple palette opens. Clear it when the source state ends:

```ts
dddk.palette.clearPinnedContext();
```

(The Dwell module wires this automatically via its `onSelect` / `onClear` callbacks — see [04-how-to-toggle-features](./04-how-to-toggle-features.md).)

---

## Plain text + Enter — implicit fallback

A registered item with `fallback: true` is the catch-all when the user types something that matches no command. The SDK's behaviour depends on how many fallbacks exist:

| Number of fallbacks | UX |
| --- | --- |
| 0 | Enter on unmatched text does nothing. |
| 1 (recommended) | **No row rendered.** Enter fires the fallback handler directly with the raw input. Clean "type anything → goes to the agent" UX. |
| 2+ | Both render as rows so the user picks (e.g. `ask ai:` vs `web search:`). |

```ts
palette.addItem({
  id: 'ask-ai-fallback',
  name: 'Ask AI',
  description: 'Send the typed text to the agent',
  icon: '✦',
  fallback: true,
  section: 'AI',
  handler: (p, arg) => {
    p.close();
    if (arg) dddk.startAgent(arg);
  },
});
```

With this one item registered, typing anything and pressing Enter goes straight to `dddk.startAgent(...)`.

---

## In-place result — custom UI inside the palette

A handler can replace the list with arbitrary host-rendered content via `handle.showResult(...)`. The result mode keeps the input visible at the top; everything below the input becomes yours.

```ts
palette.addItem({
  id: 'chat',
  name: '/chat',
  prefix: '/chat',
  handler: (p) => {
    const root = document.createElement('div');
    root.innerHTML = `<my-chat-panel />`;  // or any DOM you want
    p.showResult(root);
  },
});
```

`showResult` accepts `string | HTMLElement | AsyncIterable<string> | (() => Promise<…>)`. Use cases:

- **Chat panel** — host renders a chat surface, wires the input + LLM round-trips
- **Product / order list** — render result cards inside the palette
- **AI streaming answer** — pass an `AsyncIterable<string>` and the SDK appends each chunk
- **Multi-section settings panel** — left sidebar + right pane, all yours

The demo's `/test_palette_frame` command in the dotdotduck.com sandbox uses this exact API — see the live page for a full example with sub-menus, forms, chat, image gallery, and inline AI input.

The host can also clear the result and return to the list:

```ts
p.clearResult();
```

---

## Sub-menu pattern — `replace()` (one level deep)

```ts
palette.addItem({
  id: 'language',
  name: '/language',
  prefix: '/language',
  handler: (p) => {
    p.replace([
      { id: 'en',    name: 'English',        handler: (h) => { setLocale('en');    h.close(); } },
      { id: 'zh-TW', name: '繁體中文',       handler: (h) => { setLocale('zh-TW'); h.close(); } },
    ]);
  },
});
```

Esc pops the sub-menu back to the previous list (sub-menus stack). Closing and reopening the palette always returns to root.

---

## Removing or updating items

```ts
dotdotduck.palette.removeItem('go-billing');
dotdotduck.palette.setItems(newList);    // full replace
```

If you add items dynamically (per route / per user role), call `removeItem` on the previous set first to avoid duplicates.

---

## Theming a palette row

Every visual part of a row is a CSS custom property — override in your host stylesheet, no recompile needed. (Defaults are themed with the rest of dotdotduck; this list is the per-row breakdown.)

```css
:root {
  /* row container */
  --dddk-palette-row-padding:        10px 20px;
  --dddk-palette-row-gap:            12px;
  --dddk-palette-row-radius:         6px;
  --dddk-palette-row-bg-hover:       var(--dddk-accent-soft);
  --dddk-palette-row-bg-active:      var(--dddk-accent);

  /* icon */
  --dddk-palette-icon-size:          18px;
  --dddk-palette-icon-color:         var(--dddk-text-muted);
  --dddk-palette-icon-color-active:  var(--dddk-text-on-accent);

  /* prefix pill (`nav:`, `/theme`, …) */
  --dddk-palette-prefix-font:        var(--dddk-font-mono);
  --dddk-palette-prefix-font-size:   12px;
  --dddk-palette-prefix-bg:          var(--dddk-accent-soft);
  --dddk-palette-prefix-color:       var(--dddk-accent);
  --dddk-palette-prefix-radius:      4px;
  --dddk-palette-prefix-padding:     2px 6px;

  /* name */
  --dddk-palette-name-color:         var(--dddk-text);
  --dddk-palette-name-color-active:  var(--dddk-text-on-accent);
  --dddk-palette-name-font-size:     14px;
  --dddk-palette-name-font-weight:   500;

  /* — dash between name and description — */
  --dddk-palette-dash-color:         var(--dddk-text-muted);
  --dddk-palette-dash-opacity:       0.55;

  /* description */
  --dddk-palette-desc-color:         var(--dddk-text-muted);
  --dddk-palette-desc-color-active:  var(--dddk-text-on-accent);
  --dddk-palette-desc-font-size:     13px;
  --dddk-palette-desc-opacity-active: 0.85;

  /* shortcut hint on the far right */
  --dddk-palette-shortcut-color:     var(--dddk-text-muted);
  --dddk-palette-shortcut-font:      var(--dddk-font-mono);
  --dddk-palette-shortcut-font-size: 12px;
  --dddk-palette-shortcut-opacity:   0.6;

  /* section header ("NAVIGATION", "SETTINGS", …) */
  --dddk-palette-section-color:           var(--dddk-text-muted);
  --dddk-palette-section-font-size:       11px;
  --dddk-palette-section-letter-spacing:  0.08em;
  --dddk-palette-section-padding:         12px 20px 4px;
  --dddk-palette-section-text-transform:  uppercase;
}
```

The active-row variants (`-active` suffix) only apply on the currently highlighted row — set the same values as their non-active siblings if you don't want a colour shift.

For other dotdotduck surfaces (palette frame itself, subtitle bar, Dwell outline) see [11-theming](./11-theming.md).
