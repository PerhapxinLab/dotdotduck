# Search

Full-text search with per-field BM25, pluggable scoring signals, and
per-field language packs. Index lives in memory (and optionally
mirrors to IndexedDB).

## Quick start

```ts
import { createSearch, builtin } from '@perhapxin/dddk/toolbox/search';

interface Product { sku: string; name: string; description: string; price: number; }

const search = createSearch<Product>({
  adapter: {
    fromRow: (p) => ({
      id: p.sku,
      fields: { name: p.name, body: p.description },
      meta: { price: p.price },
    }),
  },
  scorers: [
    builtin.bm25Field({ weights: { name: { weight: 3 }, body: { weight: 1 } } }),
  ],
  weights: { bm25_field: 1.0 },
  combiner: 'weighted_sum',
});

await search.init();
await search.addDocs(products);

const hits = await search.query('blue shirt', { topK: 10 });
// hits: Array<{ doc, score, explanation? }>
```

## API

- `createSearch<TRow>({ adapter, scorers, weights, combiner, topK, language, fieldLanguages, storage, sync, id })`
- `await search.init()` — open storage + load any persisted index
- `await search.addDoc(row)` / `await search.addDocs(rows)` / `await search.updateDoc(row)` / `await search.removeDoc(id)`
- `await search.query(text, { topK, scoreThreshold, customMeta, explain })` → `SearchResult[]`
- `search.explain(text, docId)` — score breakdown for one doc
- `search.onLowConfidence((q, top) => ...)` — escalation hook
- `search.getDoc(id)` / `search.allDocs()` / `search.getFeatures(id)`

## Scoring signals

Built-in signals (`builtin.*`):

| Signal | What it scores |
|---|---|
| `bm25Field({ weights })` | Per-field BM25 with tf-saturation |
| `recencyDecay({ field, halfLifeDays })` | Half-life decay on a timestamp field |
| `newProductBoost({ field, withinDays, multiplier })` | Multiplier for items within a date window |
| `bestsellerBoost({ field, method, maxBoost })` | Log-normalised popularity boost |
| `promoBoost({ field })` | Multiplicative boost from a per-doc numeric field |
| `inventoryFilter({ field, min })` | Gate: hide docs whose stock < min |
| `activeFilter({ field })` | Gate: hide inactive items |

Custom signals are easy — implement `SearchScorer`:

```ts
const editorPick: SearchScorer = {
  id: 'editor_pick',
  compute: (doc) => doc.meta?.editor_pick ? 1.5 : 1,
};
```

## Per-field language

Multi-lingual catalogs declare which field is which language:

```ts
const search = createSearch({
  adapter: { /* ... */ },
  fieldLanguages: {
    title_zh: 'zh',
    title_en: 'en',
    title_ja: 'ja',
    brand:    'universal',  // brand names don't have a language
  },
});
```

Each field gets indexed with its language pack (zh: bigram tokenizer,
en: Porter stemmer, universal: Unicode segmentation). The query is
auto-detected and matches against the right field.

## Through the webagent

```ts
dddk.tools.registerSearch({
  items: products,
  toDoc: (p) => ({ id: p.sku, fields: { title: p.name, body: p.description } }),
});
```

The LLM sees `search_catalog({ query })` and calls it autonomously
when the user asks about products. See `notes/toolbox-as-tools.md`
in the repo for the design notes.
