# dddk-toolbox — overview

Host-side toolkit shipped with `@perhapxin/dddk`. Zero LLM dependency by default;
modules are organised around enterprise feature needs (search / recommend / qa /
memory / classify / proactive) plus three infrastructure layers (lang / storage /
analytics) and a raw-algorithm layer (`internals`).

## Modules

| Subpath | Purpose | Doc |
|---------|---------|-----|
| `@perhapxin/dddk/toolbox/search`    | Field-weighted site search, pluggable signals, delta sync | [01-search.md](./01-search.md) |
| `@perhapxin/dddk/toolbox/recommend` | similarTo / forCustomer / goesWith with MMR diversity     | [02-recommend.md](./02-recommend.md) |
| `@perhapxin/dddk/toolbox/qa`        | FAQ + DOM + Row multi-candidate retrieval, no chunking    | [03-qa.md](./03-qa.md) |
| `@perhapxin/dddk/toolbox/memory`    | Wings / Rooms / Drawers verbatim conversation memory      | [04-memory.md](./04-memory.md) |
| `@perhapxin/dddk/toolbox/classify`  | Multinomial Naive Bayes with explain                      | [05-classify.md](./05-classify.md) |
| `@perhapxin/dddk/toolbox/proactive` | Trigger + variants + fatigue + Space gesture binding      | [06-proactive.md](./06-proactive.md) |
| `@perhapxin/dddk/toolbox/lang`      | Language packs (universal + zh + en built-in, extensible) | [07-lang.md](./07-lang.md) |
| `@perhapxin/dddk/toolbox/storage`   | memory / localStorage / IndexedDB adapters                | [08-storage.md](./08-storage.md) |
| `@perhapxin/dddk/toolbox/analytics` | Event collection with identity passthrough                | [09-analytics.md](./09-analytics.md) |
| `@perhapxin/dddk/toolbox/internals` | BM25 / Naive Bayes / Porter / sampling primitives         | [10-internals.md](./10-internals.md) |

## Core principles

1. **Library, not service** — no databases to deploy. Data lives in three tiers:
   build-time JSON (catalog), session-only in-memory (current chat / yes-no /
   recent searches), host backend (persistent + aggregated).
2. **Adapter system** — host's DB schema is unknown. Every module accepts
   `Adapter<HostRow, ToolboxDoc>` so the host writes one `fromRow()` and keeps
   their existing DB.
3. **Pluggable signals everywhere** — ranking, recommendation, triggers, classify
   features. Built-ins are starting points, not law.
4. **No LLM by default** — every module has an optional `onLowConfidence` /
   escalation hook the host can wire to any LLM. Default path is rule-based.
5. **Multi-language day one** — universal Unicode pack auto-detects scripts;
   specialised packs ship with `zh` + `en`. For multi-lang catalogs, `search`
   supports per-field language via `fieldLanguages`. `classify` features carry
   lang prefix to avoid cross-lang feature collision.
6. **Memory is session-only by default** — toolbox's `memory` defaults to
   in-memory storage (gone on page close). Host owns long-term persistence
   via their own backend; toolbox provides `contextProvider` hook to inject
   the host's persistent facts into the agent's per-turn context.
7. **Explainable** — every ranker / classifier has `explain()` returning the
   per-signal contributions. No black box.

## Quick start

```typescript
import { createSearch, builtin } from '@perhapxin/dddk/toolbox/search';

const search = createSearch({
  adapter: { fromRow: (row) => ({ id: row.id, fields: { title: row.title } }) },
  storage: 'indexeddb',
  scorers: [
    builtin.bm25Field({ weights: { title: { weight: 10, saturation: 3 } } }),
    builtin.newProductBoost({ field: 'listed_at', withinDays: 30, multiplier: 1.5 }),
  ],
});

await search.init();
await search.addDoc({ id: 'p1', title: '藍色襯衫', listed_at: Date.now() });
const results = await search.query('襯衫');
```
