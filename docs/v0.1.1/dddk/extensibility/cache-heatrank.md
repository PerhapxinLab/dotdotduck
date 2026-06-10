# Cache + HeatRank

> Two small utilities. `Cache` is a sync LRU with optional `sessionStorage` / `localStorage` backing. `HeatRank` ranks frequently-used items with time-decayed frequency. dddk uses them internally for palette ordering and minor data caching; hosts can reuse them without adding another dependency.

## `Cache`

```ts
import { Cache } from '@perhapxin/dddk';
import type { CacheOptions, CacheTier } from '@perhapxin/dddk';

const cache = new Cache({
  namespace: 'orders',      // default 'dddk'; prefixes backing keys
  capacity:  500,           // mem LRU cap. Default 1000.
  tier:      'session',     // 'memory' | 'session' | 'local'. Default 'memory'.
  ttl:       60_000,        // ms. Default Infinity.
});
```

| Method | |
| --- | --- |
| `get(key): string \| null` | Sync. On memory miss → check backing → promote to memory. |
| `set(key, value: string)` | Write memory + backing; oldest entry evicted when capacity is exceeded. |
| `has(key)` | Equivalent to `get(key) !== null`. |
| `delete(key)` | Removes from both layers. |
| `clear()` | Drops the entire namespace (memory + backing). |
| `size()` | Memory size only (does not include backing-only entries). |
| `subscribe(handler)` | Subscribe to mutations; returns an unsubscribe. |

### Why sync

Typical flow:

```ts
const cached = cache.get('user-42');
if (cached) showUser(JSON.parse(cached));        // render now
fetchUser(42).then((u) => cache.set('user-42', JSON.stringify(u)));  // refresh in the background
```

`useMemo` / `useState` need "a value right now"; an async cache that resolves a microtask later is too late. Cache stores strings only — the host does its own JSON.stringify / parse.

### Tier

- `'memory'`: pure in-process Map; cleared on page reload.
- `'session'`: writes to `sessionStorage`; persists across reload, lost when tab closes.
- `'local'`: writes to `localStorage`; persists across tabs and sessions.

The memory layer is **always present**; `tier` adds a second backing layer. On read, backing is scanned only when memory misses; on write, both layers are written. SSR-safe — when `window === undefined` the backing layer is skipped.

### TTL

`ttl` applies to every entry. Expired entries are removed lazily on `get` (no background GC).

### When the host uses it directly

dddk uses `Cache` internally for palette debounce results, recent skill rosters, and preference reads — hosts usually don't touch it. Common host use cases:

- Short-term API response cache (avoid re-fetching on every React rerender).
- Persistence backing for HeatRank (see below).
- Skill handlers wanting to keep state across invocations (`ActionSkillContext.storage` works too, but storage is a raw KV; `Cache` adds LRU + TTL).

### `subscribe`

```ts
const unsub = cache.subscribe((key, value) => {
  if (value === null) console.log(`evicted: ${key}`);
  else console.log(`set: ${key} = ${value}`);
});
```

Not fired on `get` — only on `set` / `delete` / `clear`.

## `HeatRank`

```ts
import { HeatRank, makeCacheAdapter } from '@perhapxin/dddk';
import type { HeatRankOptions, HeatRankAdapter } from '@perhapxin/dddk';

const heat = new HeatRank({
  scope:            'palette',       // separate scope per independent ranking
  halfLifeMs:       7 * 24 * 3600e3, // 1-week half-life, the default
  maxVisitsPerItem: 20,              // keep only the most recent 20 visits per item
  adapter:          makeCacheAdapter(cache),  // optional; default is in-memory
});
```

### Algorithm

Every `visit(id)` records a unit-weight event; event weight decays exponentially over time:

```
score(now) = Σ over visits of 0.5 ^ ((now - visitedAt) / halfLifeMs)
```

A 7-day-old visit is worth 0.5; a 14-day-old visit is worth 0.25. Items used recently AND items used many times in the past both surface.

### Methods

| | |
| --- | --- |
| `visit(id)` | Record one use. |
| `score(id, now?)` | Compute the current score. |
| `sort(items, idOf, fallback?)` | Sort items by descending score; ties broken by the fallback comparator. |
| `forget(id)` | Drop one item's history. |
| `reset()` | Drop the whole scope. |

### Typical use

```ts
// When the user runs a palette skill
dddk.events.on('skill_run', ({ id }) => heat.visit(id));

// When listing the palette, hot skills bubble to the top
const sortedSkills = heat.sort(
  registry.list(),
  (s) => s.id,
  (a, b) => a.name.localeCompare(b.name)  // alphabetical fallback on ties
);
```

Scopes separate contexts:

```ts
const palette = new HeatRank({ scope: 'palette',      adapter });
const files   = new HeatRank({ scope: 'recent-files', adapter });
```

### Adapter

```ts
interface HeatRankAdapter {
  read(scope: string): Record<string, number[]>;
  write(scope: string, data: Record<string, number[]>): void;
}
```

Without an adapter the data stays in memory (lost on reload). For persistence, wrap a Cache:

```ts
const cache = new Cache({ namespace: 'heatrank', tier: 'local' });
const heat  = new HeatRank({ scope: 'palette', adapter: makeCacheAdapter(cache) });
```

`makeCacheAdapter(kv)` only needs an object with `{ get(key), set(key, value) }` — not necessarily dddk's `Cache`. Plug it into any sync KV (your Redux store, a sync wrapper around IndexedDB, etc.).

## Where dddk uses these internally

- `Cache`: palette result debounce, recent LLM responses, the in-memory layer for preference reads.
- `HeatRank`: palette skill ordering (frequently-used skills float to the top), recent commands, module-internal suggestion ranking.

The host doesn't have to do anything — DotDotDuck wires these up internally. Host-facing scenarios:

- **Replace** dddk's defaults (your own KV / your own score) — instantiate your own, subscribe, override.
- **Spin up your own** for a host feature (recent views, top customers) — pick a unique namespace / scope.

## See also

- [PreferenceStore](../skills/preferences.md) — also a sync KV concept, but schema-aware. Use `Cache` for ad-hoc caching, `PreferenceStore` for per-skill settings.
