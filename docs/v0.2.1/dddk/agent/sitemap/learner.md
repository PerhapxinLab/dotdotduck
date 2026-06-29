# Sitemap learner

> Static sitemap covers the routes you **remembered to write down**. Real apps have routes the author forgot, plus dynamic `/orders/:id` pages with thousands of instances. `SitemapLearner` watches navigation, collapses dynamic segments, and merges what it sees onto your static base — so the agent's site map gets richer over time without you maintaining it by hand.

## When to use it (and when not to)

| Site shape | Recommendation |
|---|---|
| Small static site (< 10 routes), stable | **Hand-written** `SitemapNode` only. The learner adds noise. |
| Mid-size SaaS (10–30 routes), mostly stable | Hand-written. Maybe add the learner in dev to spot routes you missed. |
| Large dynamic catalog / admin (30+ routes, many `/:id` pages) | **Learner on top of a hand-written skeleton.** |
| Acquired / unknown app you're agent-ifying | Learner with a minimal base. Let it discover the structure as users navigate. |

The learner is **opt-in** — `WebAgent` never instantiates it for you. You wire it into your router's navigation hook.

## Quick start

```ts
import { WebAgent, SitemapLearner, SAAS_SITEMAP_TEMPLATE } from '@perhapxin/dddk';

const learner = new SitemapLearner({
  base: SAAS_SITEMAP_TEMPLATE,
  storage: {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
  },
});

// every time the SPA navigates, tell the learner
router.afterEach((to) => {
  learner.observePath(to.path, { title: document.title });
});

// build the WebAgent with the augmented tree
const agent = new WebAgent({
  llm,
  sitemap: learner.materialize(),
});
```

`materialize()` is cheap (it's a `structuredClone` of the base plus a merge pass), so you can re-call it before each `agent.run()` to pick up routes learned since the last run.

## Constructor options

```ts
interface SitemapLearnerOptions {
  base: SitemapNode;
  storage: SitemapLearnerStorage;
  storageKey?: string;
  maxLearnedPerParent?: number;
  isDynamicSegment?: (segment: string) => boolean;
}
```

| Option | Default | Notes |
|---|---|---|
| `base` | — | Your hand-written static sitemap. Learned data merges on top — base wins on collisions for `title` / `description`, but `actions` are unioned. |
| `storage` | — | Sync K/V — `{ get(k): string \| null; set(k, v): void }`. Wrap `localStorage`, `sessionStorage`, or dddk Cache. |
| `storageKey` | `'webagent.sitemap.learned'` | Key inside `storage`. Namespace per app if you ship multi-tenant. |
| `maxLearnedPerParent` | `50` | Cap on learned children per parent node — prevents unbounded tree growth on hostile inputs (e.g. `/search/<every-query>`). |
| `isDynamicSegment` | UUIDs / pure numerics / opaque ≥12-char ids | Return `true` for segments that should collapse to `:id`. Override for your slug shape. |

### Default dynamic-segment patterns

```ts
const DEFAULT_DYNAMIC_PATTERNS = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID
  /^\d+$/,                          // pure numeric id
  /^[A-Za-z0-9_-]{12,}$/,           // long opaque id (≥12 chars)
];
```

If your slugs look like `green-widget-2024`, the default `≥12 chars` catches them. If they're short (`abc123`), the catalog page would get learned as 100 different leaf nodes — fix it with a custom matcher:

```ts
new SitemapLearner({
  base,
  storage,
  isDynamicSegment: (seg) => /^[a-z0-9]{6,}$/.test(seg) || /^\d+$/.test(seg),
});
```

## Methods

| Method | Purpose |
|---|---|
| `observePath(path, info?)` | Record one navigation. `info` = `{ title?, description?, actions? }`. Path is normalized through `isDynamicSegment` before being stored. |
| `materialize()` | Return a `SitemapNode` = deep clone of `base` merged with everything observed so far. Pass this to `WebAgent`. |
| `reset()` | Drop all learned data (keep base). Call from a "reset agent memory" button. |
| `inspect()` | Return the raw learned tree (path → `{ visitCount, lastVisited, title?, description?, actions? }`) for debugging / export. |

## Storage shape

What gets persisted under `storageKey` is a JSON object:

```json
{
  "/orders": { "visitCount": 12, "lastVisited": 1714123456000, "title": "Orders" },
  "/orders/:id": { "visitCount": 47, "lastVisited": 1714125000000, "title": "Order detail", "actions": ["view", "refund"] },
  "/settings/api-keys": { "visitCount": 2, "lastVisited": 1714000000000, "title": "API keys" }
}
```

Keys are **normalized paths** (dynamic segments already collapsed). `actions` is unioned across observations — if you `observePath('/orders/:id', { actions: ['view'] })` then later `observePath('/orders/:id', { actions: ['refund'] })`, both end up in the merged node.

Storage is read once in the constructor and written on every `observePath`. If your `storage.set` is expensive, debounce at the host layer — the learner doesn't.

## How merging works

`materialize()` walks the stored paths and folds each one into the cloned base:

- Path exists in base → metadata merges (title / description only fill if base doesn't have them; actions union).
- Path doesn't exist → new child nodes created along the way, capped at `maxLearnedPerParent` per parent.

So a hand-written base sets the **canonical** shape (titles, auth flags, notes) and the learner fills in the **shape you forgot to write**. Learned auth flags / `requiresAdmin` are not inferred — only what the host explicitly passes in `info`.

## Wiring per framework

### SvelteKit

```ts
import { afterNavigate } from '$app/navigation';

afterNavigate(({ to }) => {
  if (!to) return;
  learner.observePath(to.url.pathname, { title: document.title });
});
```

### Next.js (app router)

```tsx
'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export function LearnerHook({ learner }: { learner: SitemapLearner }) {
  const pathname = usePathname();
  useEffect(() => {
    learner.observePath(pathname, { title: document.title });
  }, [pathname, learner]);
  return null;
}
```

### React Router

```ts
const location = useLocation();
useEffect(() => {
  learner.observePath(location.pathname, { title: document.title });
}, [location.pathname]);
```

## Re-materializing on demand

`agent.config.sitemap` is read once when the agent constructs its prompt for a run. To pick up newly-learned routes:

```ts
agent.config.sitemap = learner.materialize();
await agent.run(task);
```

Or wrap it in a helper:

```ts
function startAgent(task: string) {
  agent.config.sitemap = learner.materialize();
  return agent.run(task);
}
```

The clone is cheap — don't bother caching unless you've measured a problem.

## See also

- [Sitemap tree](./tree.md) — `SitemapNode` shape, helpers (`serializeSitemap`, `resolvePath`, `searchSitemap`).
- [Public API](../api.md) — `WebAgentConfig.sitemap` field.
- [Prompt design](../prompt-design.md) — how the materialized tree enters the system prompt.
