# Recommend

Catalog recommender that shares a Search index for content similarity
plus a pluggable signal pipeline for ranking. Records `yes/no/dismiss`
preferences and adjusts recommendations live.

## Quick start

```ts
import { createSearch } from '@perhapxin/dddk/toolbox/search';
import { createRecommend, builtin as recBuiltin } from '@perhapxin/dddk/toolbox/recommend';
import { builtin as searchBuiltin } from '@perhapxin/dddk/toolbox/search';

// 1. Build a Search index — this IS the recommend catalog.
const catalog = createSearch({
  adapter: { fromRow: (p: Product) => ({ id: p.sku, fields: { title: p.name, category: p.cat } }) },
  scorers: [searchBuiltin.bm25Field({ weights: { title: { weight: 2 } } })],
});
await catalog.init();
await catalog.addDocs(products);

// 2. Wire the recommender against that catalog.
const rec = createRecommend({
  catalog,
  customerId: 'cust_4823',
  signals: [
    recBuiltin.preferenceMatch({ catalog, yesBoost: 2.0, noBoost: 0.3 }),
    recBuiltin.contentSimilarity(),
    recBuiltin.recencyDecay({ field: 'created_at', halfLifeDays: 90 }),
  ],
  weights: { preference_match: 1.0, content_similarity: 0.5, recency_decay: 0.3 },
  combiner: 'weighted_sum',
  topK: 10,
});
await rec.init();

// 3. Three query modes:
const similar    = await rec.similarTo('sku-101', { topK: 5 });
const forYou     = await rec.forCustomer({ topK: 5 });
const goesWith   = await rec.goesWith(['sku-101', 'sku-203'], { topK: 5 });

// 4. Record preferences — re-ranks immediately on next query.
await rec.recordPreference({ productId: 'sku-101', response: 'yes' });
await rec.recordPreference({ productId: 'sku-999', response: 'no' });
```

## Built-in signals (`recBuiltin.*`)

| Signal | Effect |
|---|---|
| `preferenceMatch({ catalog, yesBoost, noBoost })` | Boosts items sharing features with `yes` items, penalises features from `no` |
| `contentSimilarity()` | Cosine similarity between query / item features |
| `recencyDecay({ field, halfLifeDays })` | Half-life decay on a timestamp |
| `saturation({ field, cap })` | Logarithmic saturation of a numeric field |
| `promoBoost({ field })` | Multiplier from a per-doc field |
| `coldStartBayesian({ ratingField, countField, prior })` | Bayesian average for new items |
| `diversityPenalty({ field, topNPenalty })` | Deprioritise overrepresented categories |

## Three query modes

- `similarTo(productId)` — "more like this"
- `forCustomer()` — personalised top-K for the current customer
- `goesWith(productIds)` — bundle / complementary recommendations

## Preferences persist

Preferences write to `storage` (default IndexedDB). The host can also
sync to a backend via `prefsSync.pushChange` / `bootstrap`.

## Through the webagent

```ts
dddk.tools.registerRecommend({
  items: products,
  toDoc: (p) => ({ id: p.sku, fields: { title: p.name, category: p.cat } }),
});
```

Three tools get registered on the agent:

- `recommend_for_customer()` — no args, personalised top-K
- `recommend_similar({ productId })` — items like this one
- `record_preference({ productId, response: 'yes'|'no'|'dismiss' })` — feed user feedback back

The LLM can use them in sequence: "Here are 3 books like Dune"
(`recommend_similar`), user picks one, agent calls
`record_preference({yes})`, next `forCustomer` call ranks differently.

## API

- `createRecommend({ catalog, customerId, signals, weights, combiner, topK, diversity, prefsSync, storage, id })`
- `await rec.init()`
- `await rec.recordPreference({ productId, response, context? })`
- `await rec.similarTo(productId, { topK })`
- `await rec.forCustomer({ topK })`
- `await rec.goesWith(productIds, { topK })`
- `rec.explain(productId, ctx?)`
