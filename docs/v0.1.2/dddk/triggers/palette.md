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
  keywords?: string[];         // extra strings fed to fuzzy match (alt names, path, …)

  prefix?: string | string[] | { match: string | string[]; label?: string };
  prefixAcceptsAnyArg?: boolean;
  fallback?: boolean;

  /** Dynamic resource expansion — see the `Browse` pattern below. */
  browse?: (arg: string) => PaletteItem[];
  /** Section heading used for items returned by `browse`. */
  browseSection?: string;

  /**
   * Hide from the empty state + partial-prefix list; still appears in
   * free-text fuzzy search. Use for deep destinations you want findable
   * by keyword but not crowding the default list — see `searchOnly`
   * pattern below.
   */
  searchOnly?: boolean;

  shortcut?: string;           // visual hint on the far right ("⌘B", "↵", etc.)
  agentTool?: PaletteAgentTool;
  handler?: (handle: PaletteHandle, arg?: string) => void;
  detail?: (arg?: string) => PieceSurface | Promise<PieceSurface>;
}
```

Prefix matching is **case-insensitive** — `Docs:`, `DOCS:`, and `docs:` all route to the same item. Use whatever casing reads best to your users.

The handler receives:

```ts
interface PaletteHandle {
  close(): void;
  replace(items: PaletteItem[]): void;          // swap the list (sub-menu)
  input: string;
  setInput(value: string): void;
  context: PaletteContext;                       // selection + image attachments
  showResult(surface: ResultSurface): void;      // in-place result mode
  clearResult(): void;

  // Hijack the top input box so your sub-tool can use it as ITS OWN
  // input — for chat / live-filter / per-tool prompt panels. The
  // override clears automatically when the palette closes or Esc-back
  // exits the sub-menu.
  setInputContext(ctx: {
    placeholder?: string;
    onSubmit: (value: string, handle: PaletteHandle) => void;
    onInput?: (value: string, handle: PaletteHandle) => void;  // fires on every keystroke
    clearOnSubmit?: boolean;
    hideList?: boolean;                          // hide the registered-item list below the input
  }): void;
  clearInputContext(): void;
}
```

### Worked example: input as a custom search box

When the host needs the palette body to be a search UI with its OWN data source (not the registered item list), wire `showResult()` for the body + `setInputContext({ onInput })` for live filtering. The result mode keeps the input visible; `onInput` runs on every keystroke and the host re-renders the body:

```ts
dddk.palette.addItem({
  id: 'invoices',
  name: '/invoices',
  prefix: '/invoices',
  handler: (h) => {
    const invoices = await loadInvoices();           // your data source
    const root = renderList(invoices);                // HTMLElement you own
    h.showResult(root);
    h.setInputContext({
      placeholder: 'Search invoices…',
      hideList: false,
      onInput: (q) => {
        const matches = invoices.filter((inv) =>
          inv.number.includes(q) || inv.customer.toLowerCase().includes(q.toLowerCase()),
        );
        root.replaceChildren(...renderList(matches).children);
      },
      onSubmit: (q) => {
        const top = matches[0];
        if (top) goto(`/invoices/${top.id}`);
        h.close();
      },
    });
  },
});
```

The same pattern powers the live-data UI demos on the dddk demo site — palette body shows a list / detail panel; the input on top is the host's own search input, not the registered-item filter. `hideList: false` is the usual default — keep host content visible alongside any matching palette items the input might surface; pass `true` for chat-panel style where the registered items should be invisible while the panel is active.

> Instead of a bare `handler`, an item can declare `actions: PaletteAction[]` — a typed discriminated union (`copy` / `insert` / `open-url` / `navigate` / `agent-task` / `render-surface` / `run-skill` / `custom`) with primary / secondary / Ctrl+K sub-panel UX. See [Palette actions](./palette-actions.md).

---

## How prefix routing actually works

There are three ways the palette filters rows:

### 1. No prefix, no query (empty input)
Every registered item shows, grouped by `section`. (Hosts can also opt into a *Tips* section at the top — see below.)

### 2. No prefix, with a query like `tri`
Fuzzy match against `name + description + keywords`. Highest score floats to the top.

### 3. Input starts with a registered prefix — e.g. `nav:`
Three sub-cases, in order of precedence:

**(a) The matching item has `browse(arg)`** — call it. The returned `PaletteItem[]` become the displayed list (fuzzy-filtered by `arg`); the Ask AI fallback is appended at the end if `arg` is non-empty. This is the **dynamic resource expansion** pattern — see *Pattern: Browse* below. Typical resource prefixes look like `order:` / `customer:` / `doc:`.

**(b) The matching item has `prefixAcceptsAnyArg: true`** — the item itself becomes the top row, and the post-prefix text (`arg`) is what gets handed to its handler. Use this for free-form prompts like `ask ai: anything`.

**(c) No `browse` and no `prefixAcceptsAnyArg` (or multiple items share the prefix)** — the post-prefix text fuzzy-matches against the *names* of the items that share that prefix. So `nav: try it` filters the `nav:`-prefixed items by name, surfaces `Try It`, and Enter fires *that* item's handler.

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

## Pattern: Browse — dynamic resource expansion under a prefix

Typing a resource prefix like `order:` reveals matching orders, `customer:` reveals customers, `doc:` reveals docs — all without leaving the palette. Wire your own by giving a prefix item a `browse(arg)` callback that returns `PaletteItem[]`. The SDK fuzzy-filters them by what the user types after the colon.

```ts
palette.addItem({
  id: 'tip-orders',
  name: 'order:',
  description: 'browse orders · 訂單',
  icon: '📦',
  section: 'Tips',
  prefix: 'order:',
  prefixAcceptsAnyArg: true,
  browseSection: 'Orders',         // section header when children render
  browse: (arg) => {
    // arg is whatever the user typed after `order:` (trimmed).
    // SDK fuzzy-filters the returned items by arg automatically — you
    // don't need to filter yourself. Just return the full resource list
    // (cache fetches; this fires on every keystroke under the prefix).
    return orders.map((o) => ({
      id: `order-${o.id}`,
      name: o.number,
      description: `${o.customer} · $${o.total}`,
      icon: '◇',
      handler: (h) => {
        h.close();
        router.push(`/orders/${o.id}`);
        // — or render inline in the palette instead of navigating:
        //   h.showResult(renderOrderDetail(o));
      },
    }));
  },
  // Enter on the tip itself seeds the prefix so refilter re-routes here
  // and `browse('')` lights up the full list.
  handler: (p) => { p.setInput('order:'); },
});
```

**Two-level hierarchy** (a `Section › Page` breadcrumb pattern): inspect `arg` inside `browse()` and decide what to return. Detect a leading "package" / "category" token and return its children with breadcrumb names:

```ts
browse: (arg) => {
  const lower = arg.trim().toLowerCase();
  const drill = PACKAGES.find((p) => lower === p || lower.startsWith(`${p} `));
  if (drill) {
    // Second level — chapter / item list under the selected package.
    return chaptersOf(drill).map((c) => ({
      id: `${drill}-${c.slug}`,
      name: `docs › ${drill} › ${c.title}`,   // breadcrumb in the row name
      description: c.slug,
      handler: (h) => { h.close(); router.push(`/docs/${drill}/${c.slug}`); },
    }));
  }
  // First level — package rows; activating one seeds the input to drill.
  return PACKAGES.map((p) => ({
    id: `pkg-${p}`,
    name: `docs › ${p}`,
    description: `${chaptersOf(p).length} chapters`,
    handler: (h) => { h.setInput(`docs:${p} `); },
  }));
},
```

`browse` is **sync** — host caches its data and calls into the cached list. For async / paginated fetches, use `showResult(...)` on the parent item instead (full custom UI inside the palette).

---

## Pattern: searchOnly — surfaceable deep destinations

Surface every deep destination on plain-text typing — `policy` shows `Settings › Traffic Policies`, `dns` shows `Networking › DNS Policies`, no prefix needed. Register each deep destination as a flat `PaletteItem` whose `name` is the breadcrumb, with `searchOnly: true` so it doesn't crowd the empty state.

```ts
for (const c of allChapters) {
  palette.addItem({
    id: `doc-${c.id}`,
    name: `docs › ${c.pkg} › ${c.title}`,
    description: c.slug,
    icon: '◈',
    section: 'Docs',
    keywords: [c.pkg, c.slug],
    searchOnly: true,                       // hidden in empty state
    handler: (h) => { h.close(); router.push(`/docs/${c.id}`); },
  });
}
```

Result:
- Empty state — clean, only Tips + flat top-level entries.
- User types `react` — `docs › dddk › React adapter` floats up via fuzzy match against `name + description + keywords`, query characters highlighted in warm yellow.
- The same destination can ALSO be reachable via a `docs:` browse tip; both routes coexist.

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

For a more ergonomic version of this exact toggle, use the built-in `ThemeToggleModule` — see [modules overview](../modules/overview.md).

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

Items without `agentTool` are never exposed to the agent as their own named tool. If you want the agent to be able to invoke an item, register a **semantic intent tool** (see below) — the agent gets one cleanly-named tool, and the handler internally drives palette UI animation if visual feedback matters.

If you want to hide an item from the agent entirely, set `searchOnly: true` (also hides from the empty state) or omit it from the palette and reach the same code path via another surface.

---

## Two ways the agent reaches palette items

The generic `open_palette` tool (let the agent open the panel and click its way through) was **removed in v0.1.0+**. Multi-level UI navigation isn't reliable on small models — they invent CSS selectors, miss sub-menus, or re-open the palette mid-flow. Two clean paths replace it:

| Mechanism | When | How |
|---|---|---|
| **`agentTool` opt-in** | Single-step, handler should fire **silently** (no palette UI) — destructive ops, QA lookups, background mutations. | Set `agentTool: { description, parameters, requireConfirmation? }` on the item. Becomes a top-level tool named `palette_<id>` that fires the handler directly without showing the palette. |
| **Semantic intent tool (`dddk.tools.register`)** | Multi-level palette flow (`/immersive_translate → language sub-menu`) or anywhere you want the agent's invocation to **visibly walk the palette** as feedback. | Register a semantic tool via `dddk.tools.register({...})` — e.g. `immersive_translate({language})`. The handler internally calls `dddk.palette.open()` → `activateById(parent)` → `activateById(child)` so the user sees the path, then resolves. The agent sees one intent tool, not a sequence of UI clicks. |

Reference: `dddk-frontend/src/lib/agent-tools.ts` wraps `/immersive_translate`'s two-level palette as `immersive_translate({language})` and `docs:` search as `search_docs({query})` returning JSON.

---

## How to write `description` for agent visibility

Both `agentTool.description` AND a plain palette item's `description` are read by the agent. Write them with the agent's reasoning in mind, not just the user's discoverability.

**The agent picks tools by matching user intent against tool descriptions.** A good description tells the agent:

1. **Verb-first**: start with what the tool DOES. "Translate the current page to a target language" — not "Translation tool for users".
2. **Concrete inputs / outputs**: what `arg` means, what `parameters` accept, what the tool returns. Type-aware models pick better tools when they see arg shapes.
3. **When to use, when NOT to use**: include "DO NOT use for X" if the tool is easily confused with another. The agent ranks tools by description fit; competing tools need disambiguation.
4. **Side effects**: if the tool navigates, sends an email, mutates DB rows, say so — the agent will then sequence narration appropriately ("I'm about to refund this order…" before calling).
5. **No implementation details**: don't mention internal services / RPC names / db tables. Stay at the user-action level.

### Good vs bad

```ts
// Bad
description: 'Refund order'

// Better
description: 'Refund the order whose ID is passed as `arg` (format: ORD-NNNN). Sends a refund request to the billing API and emits a `refund_issued` event. Requires confirmation — runtime gates this on user Space-accept. Use when the user explicitly asks to refund a specific order; do NOT use for partial refunds (those go through `partial-refund:` instead).'
```

```ts
// Bad
description: 'Find a customer'

// Better
description: 'Look up a customer by name, email, or order ID. Pass the query as `arg`. Returns the first matching customer\'s id (call this BEFORE invoking customer-mutating tools like `refund-order` so you know which customer you\'re acting on). Returns null if no match — fall back to `ask_user_choice` with the top 3 candidates.'
```

### Description length

Aim for 2–4 sentences per tool. The full agent prompt has a token budget — every tool's description goes in. With ~12 built-in actions + N palette items, you have ~80–150 tokens of description budget per item before the prompt bloats. Trim ruthlessly; specificity > completeness.

---

## Pattern: image attach (camera button)

The palette can collect image attachments (uploads or page screenshots) and carry them into the next handler invocation via `palette.context.attachments`.

> Camera attachments and the `attachments` context have their own page — see [Palette attachments](./palette-attachments.md).

---

## Tips section — host-curated, not auto-generated

dddk does not auto-build a Tips section. If you want one, register items with `section: 'Tips'` like any other section. The convention is:

- `name === prefix label` (so the SDK hides the redundant bold name slot and the row reads as `<prefix> — <desc>`)
- `handler: (h) => h.setInput(prefix)` so clicking seeds the prefix into the input rather than executing anything

```ts
const TIPS = [
  { prefix: 'nav:',    desc: 'jump to a page' },
  { prefix: 'ask ai:', desc: 'free-form question to the agent' },
  { prefix: 'order:',  desc: 'browse orders' },        // pair with browse()
  { prefix: '#',       desc: 'full-text site search' },// pair with browse()
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

**Empty-state behaviour** — tips show, and the SDK automatically hides any non-Tips item whose `prefix` is already represented by a Tip. So if you register a tip with `prefix: '/theme'` *and* a real `/theme` command under `section: 'Settings'`, only the Tip renders in the empty state. As soon as the user starts typing, Tips drop out and the real commands take over. Items without a prefix (Skills, Go-to rows, plain commands) always show in the empty state — Tips never displace them.

**Mid-typing behaviour** — Tips never participate in free-text fuzzy search or partial-prefix attempts. They surface only when the input is exactly empty.

---

## Pattern: `#` find-on-page — current-page DOM search

The SDK exports `searchPageText(query)` for "find inside the current page's visible DOM body" — distinct from full-text search of your docs/content corpus. Wire it through a `#` Tip so users can grep the page they're on without leaving the palette:

```ts
import { searchPageText } from '@perhapxin/dddk';

palette.addItem({
  id: 'tip-find',
  name: '#',
  description: 'find on this page',
  prefix: '#',
  prefixAcceptsAnyArg: true,
  section: 'Tips',
  browseSection: 'On this page',
  browse: (arg) => {
    const q = arg.trim();
    if (!q) return [];
    // Walks visible text nodes, returns up to 20 hits with their parent element.
    return searchPageText(q).map((hit, i) => ({
      id: `pagehit-${i}`,
      name: hit.text,             // already truncated to ~80 chars
      handler: (h) => {
        h.close();
        hit.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
    }));
  },
  handler: (p) => { p.setInput('#'); },
});
```

`searchPageText` is intentionally *just* a DOM walker — it does no fuzzy / stemming / indexing. For corpus search (docs / catalog / orders), use `browse` with your own data source (see the Browse pattern above).

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

(The Dwell module wires this automatically via its `onSelect` / `onClear` callbacks — see [modules overview](../modules/overview.md).)

### Context auto-promotes the Ask AI fallback

When the chip bar has anything in it (live selection text, pinned element, image attachment), the SDK assumes the user attached it because they want AI to act on it. So the registered `fallback` item gets pulled to the TOP of the list and the keyboard cursor lands on it — pressing Enter immediately routes the captured context to the agent, without the user having to navigate past nav rows / settings rows / etc.

This is **on by default** (`contextPromotesFallback: true`). Opt out at construction time when your palette uses context for something other than AI:

```ts
new DotDotDuck({
  // …
  paletteOptions: {
    contextPromotesFallback: false,  // fallback stays at the bottom like normal
  },
});
```

Promotion only fires when the user is NOT actively typing a registered prefix (`docs:`, `order:`, …) — when they're drilling into a resource, the intent is "browse / pick", not "ask AI", and the fallback stays out of the way.

The fallback's description is rewritten to reflect what it'll send: empty input → "use captured context"; with typed text → `"<your query>"`.

---

## Plain text + Enter — Ask AI fallback row

A registered item with `fallback: true` is the catch-all when the user types something. The SDK **always renders the fallback row(s)** at the bottom of the list whenever the input is non-empty and not routed to a prefix — a persistent `Ask AI — "<query>"` row. The description is auto-replaced with the live query so users see exactly what will be sent.

| Number of fallbacks | UX |
| --- | --- |
| 0 | Plain-text Enter does nothing — host hasn't wired an Ask AI handler. |
| 1 (recommended) | One persistent `Ask AI — "<query>"` row pinned at the bottom of every search result list. Enter fires it with the typed text. |
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
dotdotduck.palette.addItem({ id, ... }); // add OR upsert by id
```

**`addItem` upserts by `id`** — if an item with the same `id` is already registered, the new one replaces it in-place (position preserved). So updating an item is just `addItem` again with the same `id`; no `removeItem` round-trip needed. Use `setItems` when you want a full root replace (e.g. per-route registration on navigation).

`HeatRank` (usage frequency for "most-used floats to top") tracks by `id`, so re-registering with the same `id` preserves the user's history across the update.

---

## Internationalisation (i18n)

The SDK is **i18n-framework-agnostic** — bring your own (i18next / paraglide / vue-i18n / a tiny `tr(loc, en, zh)` helper). The contract dotdotduck offers is just enough to make locale switching clean.

**The three rules:**

1. **`id` is locale-agnostic.** Use stable English IDs like `'theme'`, `'language'`, `'go-billing'`. Never put translated text in `id`.
2. **`name` / `description` follow the UI locale.** Resolve them through your i18n framework at registration time.
3. **`keywords` is a multi-language search pool.** Stuff translations + synonyms of the name into `keywords` so a user typing in any language hits the item, even if the row is displayed in a different locale.

```ts
// Build items for a given UI locale. Re-run on locale change.
function buildItems(loc: Locale, palette: PaletteAPI) {
  palette.addItem({
    id: 'theme',                           // ← locale-agnostic identity
    name: '/theme',                        // ← prefix slug, ASCII so anyone can type it
    description: t(loc, 'cmd.theme.desc'), // ← UI-locale display string
    prefix: '/theme',
    icon: ICONS.cog,
    section: t(loc, 'section.settings'),
    // Searchable across every language you support — users type whichever
    // word they know, the same item surfaces. One-time write, grows linearly
    // with new languages (no rewriting existing items).
    keywords: [
      'theme', 'appearance', 'mode', 'dark', 'light',  // en
      '主題', '外觀', '暗色', '亮色', '深色',             // zh
      'テーマ', '外観', 'ダーク', 'ライト',               // ja
      '테마', '모양',                                     // ko
      'tema', 'apariencia',                              // es
      'thème', 'apparence',                              // fr
      'Design', 'Erscheinungsbild',                      // de
    ],
    handler: (p, arg) => toggleTheme(arg),
  });
  // …rest of items
}

// Wire it to the host's locale store.
locale.subscribe((loc) => buildItems(loc, dotdotduck.palette));
// `addItem` upserts by id, so the second pass replaces the first cleanly.
// HeatRank usage by id is preserved across the locale swap.
```

**Why the SDK doesn't ship its own i18n**

Every host already has one (i18next, @formatjs/intl, paraglide, vue-i18n, your own `tr()`). Adding a parallel SDK i18n means double-bookkeeping: every translation lives in two places, and resource loading / lazy-split / SSR pre-loading are all properties of the host's framework. The contract above is the minimum the SDK needs to expose so your existing i18n setup just works.

**Anti-pattern: dual-language strings**

```ts
// DON'T — fine for 2 languages, breaks at 3+.
description: 'switch light / dark · 切換亮暗',
```

```ts
// DO — resolved per locale, scales to any language count.
description: t(loc, 'cmd.theme.desc'),
keywords: [...all_locales_synonyms],
```

---

## Theming a palette row

Every visual part of a row is a CSS custom property — override in your host stylesheet, no recompile needed. (Defaults are themed with the rest of dotdotduck; this list is the per-row breakdown.)

```css
:root {
  /* row container */
  --dddk-palette-row-padding:        9px 16px;
  --dddk-palette-row-gap:            12px;
  --dddk-palette-row-radius:         6px;
  /* Neutral grey tint, NOT the brand accent — keeps the row signal calm
     regardless of how loud the host's accent colour is. Auto-flips to
     white-on-dark in dark mode. */
  --dddk-palette-row-bg-hover:       rgba(0, 0, 0, 0.04);
  --dddk-palette-row-bg-active:      rgba(0, 0, 0, 0.06);
  /* `→` indicator at the right edge of the focused row. */
  --dddk-palette-row-arrow-color:    var(--dddk-text-muted);

  /* icon */
  --dddk-palette-icon-size:          16px;
  --dddk-palette-icon-color:         var(--dddk-text-muted);
  --dddk-palette-icon-color-active:  var(--dddk-accent);

  /* prefix (`nav:`, `/theme`, …) — rendered as plain inline text in the
     row font, NOT a coloured pill. Calmer when many commands share a
     prefix family. Hosts wanting the pill style can override these. */
  --dddk-palette-prefix-font:        inherit;
  --dddk-palette-prefix-font-size:   var(--dddk-font-size-md);
  --dddk-palette-prefix-bg:          transparent;
  --dddk-palette-prefix-color:       var(--dddk-text-muted);
  --dddk-palette-prefix-radius:      0;
  --dddk-palette-prefix-padding:     0;

  /* name */
  --dddk-palette-name-color:         var(--dddk-text);
  --dddk-palette-name-color-active:  var(--dddk-text);
  --dddk-palette-name-font-size:     14px;
  --dddk-palette-name-font-weight:   500;

  /* — dash between name and description — */
  --dddk-palette-dash-color:         var(--dddk-text-muted);
  --dddk-palette-dash-opacity:       0.55;

  /* description */
  --dddk-palette-desc-color:         var(--dddk-text-muted);
  --dddk-palette-desc-color-active:  var(--dddk-text-muted);
  --dddk-palette-desc-font-size:     13px;
  --dddk-palette-desc-opacity-active: 1;

  /* search-match highlight inside name / description (warm yellow
     marker — kept distinct from the brand accent so it always reads as
     "this is the part your query matched") */
  --dddk-palette-match-bg:           rgba(250, 204, 21, 0.35);
  --dddk-palette-match-color:        inherit;
  --dddk-palette-match-radius:       2px;
  --dddk-palette-match-weight:       600;

  /* shortcut hint on the far right */
  --dddk-palette-shortcut-color:     var(--dddk-text-muted);
  --dddk-palette-shortcut-font:      var(--dddk-font-mono);
  --dddk-palette-shortcut-font-size: 12px;
  --dddk-palette-shortcut-opacity:   0.6;

  /* section header ("Navigation", "Settings", …) — sentence-case, no
     letter-spacing. Headers are `position: sticky` so they pin to the
     top of the scrolling list; `bg` MUST be opaque (defaults to the
     palette body). */
  --dddk-palette-section-color:           var(--dddk-text-muted);
  --dddk-palette-section-font-size:       12px;
  --dddk-palette-section-font-weight:     500;
  --dddk-palette-section-letter-spacing:  0;
  --dddk-palette-section-padding:         14px 16px 6px;
  --dddk-palette-section-text-transform:  none;
  --dddk-palette-section-bg:              var(--dddk-bg-elevated);

  /* footer kbd chips (↑ ↓ ⏎ esc hints) — borderless, low-contrast
     surface tile so the hint strip reads as ambient help. */
  --dddk-palette-kbd-bg:             rgba(0, 0, 0, 0.05);
  --dddk-palette-kbd-color:          var(--dddk-text-muted);
}
```

The active-row variants (`-active` suffix) only apply on the currently highlighted row — set the same values as their non-active siblings if you don't want a colour shift.

Dark mode automatically swaps `--dddk-palette-row-bg-hover/active` to white-tinted (`rgba(255,255,255,0.05)` / `0.08`), the match highlight to a softer amber, and the kbd chip background to white-tinted — no extra host CSS needed.

For other dotdotduck surfaces (palette frame itself, subtitle bar, Dwell outline) see [theming](../theming.md).
