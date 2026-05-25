# search

Field-weighted full-text search with pluggable scoring signals. BM25 baseline,
saturation, delta sync, and IndexedDB persistence. Zero LLM by default.

## Concept

```
host catalog (D1 / Postgres / API)
       │
       │  adapter.fromRow()
       ▼
   Doc { id, fields: {title, brand, ...}, meta }
       │
       │  bigram + stemming via lang pack
       ▼
   Inverted index in memory + IndexedDB
       │
       │  query → BM25 + signal pipeline
       ▼
   Ranked SearchResult[]
```

## Basic usage

```typescript
import { createSearch, builtin } from '@perhapxin/dddk/toolbox/search';

const search = createSearch({
  adapter: {
    fromRow: (row) => ({
      id: row.sku,
      fields: {
        title: row.title,
        brand: row.brand,
        tags: row.tags.join(' '),
        description: row.description,
      },
      meta: {
        listed_at: row.created_at,
        promo_boost: row.promo_boost ?? 1.0,
        stock_qty: row.stock_qty,
        sales_30d: row.sales_30d,
        active: row.status === 'active',
      },
    }),
  },
  storage: 'indexeddb',
  scorers: [
    builtin.bm25Field({
      weights: {
        title:       { weight: 10, saturation: 3 },
        brand:       { weight: 8,  saturation: 2 },
        tags:        { weight: 5,  saturation: 5 },
        description: { weight: 1,  saturation: 10 },
      },
    }),
    builtin.recencyDecay({ field: 'listed_at', halfLifeDays: 90 }),
    builtin.newProductBoost({ field: 'listed_at', withinDays: 30, multiplier: 1.4 }),
    builtin.bestsellerBoost({ field: 'sales_30d', maxBoost: 1.3 }),
    builtin.promoBoost(),
    builtin.inventoryFilter({ field: 'stock_qty', min: 1 }),
    builtin.activeFilter(),
  ],
});

await search.init();
const results = await search.query('藍色襯衫', { topK: 10, explain: true });
```

## Delta sync — host's DB is the source of truth

```typescript
const search = createSearch({
  adapter: {...},
  sync: {
    bootstrap: async () => (await fetch('/api/dddk/catalog')).json(),
    fetchDelta: async (since) => (await fetch(`/api/dddk/catalog/delta?since=${since}`)).json(),
    pollIntervalMs: 60_000,
    // or push:
    // subscribe: (onChange) => { /* WebSocket / SSE */ }
  },
});
```

Host's API needs to return:
- `bootstrap` → `{ version, rows: [...] }`
- `fetchDelta` → `{ version, changes: [{ op: 'add'|'update'|'remove', row?, id? }] }`

Toolbox handles the rest: IndexedDB cache + incremental index update + version tracking.

## Multi-language catalogs — `fieldLanguages`

When your catalog has aligned translation fields (`title_zh`, `title_en`,
`title_ja`, ...), specify each field's language:

```typescript
const search = createSearch({
  adapter: {
    fromRow: (row) => ({
      id: row.sku,
      fields: {
        title_zh: row.title_zh,
        title_en: row.title_en,
        title_ja: row.title_ja ?? '',
        brand:    row.brand,
      },
    }),
  },
  fieldLanguages: {
    title_zh: 'zh',
    title_en: 'en',
    title_ja: 'ja',
    brand:    'universal',     // cross-language fields
  },
});
```

Each field is indexed with the right tokenizer / stemmer. Query in `zh` matches
`title_zh`, query in `en` matches `title_en`. Pure NLP can't match across
languages (e.g. "blue" → "藍色") — for that, either align translations like
above, or hook LLM via `onLowConfidence` for query translation.

## Built-in signals

| Signal | Purpose | Reads |
|--------|---------|-------|
| `bm25Field`         | Per-field BM25 with saturation                    | `doc.fields.*` |
| `recencyDecay`      | Exponential decay by age                          | `doc.meta.listed_at` |
| `newProductBoost`   | Constant multiplier for items < N days old        | `doc.meta.listed_at` |
| `bestsellerBoost`   | Log-normalized boost from sales count             | `doc.meta.sales_30d` |
| `promoBoost`        | Reads boost multiplier from doc                   | `doc.meta.promo_boost` |
| `inventoryFilter`   | **Gate**: filters out items below stock threshold | `doc.meta.stock_qty` |
| `activeFilter`      | **Gate**: filters out inactive items              | `doc.meta.active` |

Gates use the `gate` property — when it returns `false`, the doc is dropped entirely.
Regular signals just contribute to the score.

## Custom signals

```typescript
const profitableBoost: SearchScorer = {
  id: 'profitable_boost',
  compute: (doc) => 1 + Math.min(0.3, (doc.meta?.margin_rate as number) ?? 0),
};

const editorPin: SearchScorer = {
  id: 'editor_pin',
  compute: (doc) => doc.meta?.editor_pinned ? 2.0 : 1.0,
};
```

## Combiner

Default is `'product'` — signals multiply. Alternatives:
- `'weighted_sum'` — additive
- `'log_sum'` — geometric mean
- Custom function — `(scores, weights) => number`

## Explain

```typescript
const expl = search.explain('藍色襯衫', 'sku_123');
// {
//   docId: 'sku_123',
//   total: 12.4,
//   contributions: [
//     { signalId: 'bm25_field',        value: 8.2, weight: 1 },
//     { signalId: 'recency_decay',     value: 0.9, weight: 1 },
//     { signalId: 'new_product_boost', value: 1.4, weight: 1 },
//     { signalId: 'promo_boost',       value: 1.2, weight: 1 },
//   ],
// }
```

## Learn-to-rank (advanced)

Once you have ~10k click events, learn per-field weights from data:

```typescript
import { learnRankingWeights } from '@perhapxin/dddk/toolbox/search';

const learned = learnRankingWeights(clickEvents, {
  fields: ['title', 'brand', 'tags', 'description'],
  iterations: 200,
  learningRate: 0.05,
});
// learned.weights → { title: 11.3, brand: 6.8, tags: 4.1, description: 0.7 }
```

Implementation: pairwise logistic regression with L2. Pure TypeScript, no ML deps.

## Low-confidence escalation

```typescript
search.onLowConfidence(async (query, candidates) => {
  // Top-1 score below threshold × 2 → host's LLM gets a shot
  return await myLLM.rerank(query, candidates);
});
```
