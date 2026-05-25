# recommend

Three recommendation surfaces (`similarTo` / `forCustomer` / `goesWith`) with
fully pluggable scoring signals and MMR diversity re-rank.

## Concept

```
catalog (shared with search module)
    +
preferences (yes/no from proactive prompts)
    │
    │ signal pipeline (host composes)
    ▼
ranked candidates
    │
    │ optional MMR diversity re-rank
    ▼
top-K recommendations
```

## Three surfaces

```typescript
import { createRecommend, builtin } from '@perhapxin/dddk/toolbox/recommend';

const recommend = createRecommend({
  catalog: search,                  // shared with search module
  customerId: 'cust_4823',
  storage: 'indexeddb',
  signals: [/* ... */],
  diversity: { field: 'category', weight: 0.3 },
  topK: 10,
});

await recommend.init();

// "Similar to this product"
await recommend.similarTo('sku_123', { topK: 5 });

// "For this customer (homepage)"
await recommend.forCustomer({ topK: 8 });

// "Goes with these items in cart"
await recommend.goesWith(['sku_123', 'sku_456'], { topK: 3 });
```

## Preference recording

Hook this to your proactive prompts:

```typescript
proactive.register({
  id: 'rate_product',
  surface: { text: 'Like this?' },
  onResponse: async (response, ctx) => {
    await recommend.recordPreference({
      productId: ctx.customMeta?.productId as string,
      response,
      context: { page: ctx.page },
    });
  },
});
```

Preferences are persisted to IndexedDB and used by `preferenceMatch` signal automatically.

## Built-in signals

| Signal | Purpose |
|--------|---------|
| `contentSimilarity({ source })` | Feature-bag Jaccard similarity to source product (for similarTo) |
| `recencyDecay({ field, halfLifeDays })` | Exponential time decay |
| `coldStartBayesian({ priorWeight })` | Bayesian smoothing — new items get prior, not zero |
| `saturation({ field, cap })` | `cap * (1 - exp(-x/cap))` — prevents bestsellers monopolising |
| `promoBoost({ field })` | Reads boost from doc.meta |
| `preferenceMatch({ catalog })` | Boost from user's yes-prefs, penalty from no-prefs |
| `diversityPenalty` | Placeholder — use MMR option below for real diversity |

## Host-defined signals (the point)

```typescript
// E-commerce: repurchase
{
  id: 'repurchase_rate',
  compute: (doc) => doc.meta.repurchase_rate ?? 0.5,
}

// E-commerce: return rate as penalty
{
  id: 'return_rate_penalty',
  compute: (doc) => Math.max(0, 1 - 2 * (doc.meta.return_rate ?? 0)),
}

// Video / content platform: completion rate
{
  id: 'completion_rate',
  compute: (doc) => doc.meta.avg_completion_rate ?? 0.5,
}

// Content platform: like/dislike ratio (with sample-size threshold)
{
  id: 'like_ratio',
  compute: (doc) => {
    const t = (doc.meta.likes ?? 0) + (doc.meta.dislikes ?? 0);
    return t < 10 ? 0.5 : doc.meta.likes / t;
  },
}

// B2B: inventory awareness
{
  id: 'in_stock_only',
  gate: (doc) => (doc.meta.stock_qty ?? 0) > 0,
  compute: () => 1,
}
```

Any signal that returns a number works. Gates filter; non-gates contribute multiplicatively.

## MMR Diversity

Default ranker can pick all items from one category. Diversity re-rank fixes this:

```typescript
diversity: {
  field: 'category',     // meta field to diversify on
  weight: 0.3,           // 0..1 — higher = more diversity
  poolSize: 50,          // candidates considered in MMR pool
}
```

Algorithm: greedy MMR — at each step pick the candidate that maximises
`lambda * score - (1 - lambda) * sim_to_already_picked`.

## Explain

```typescript
recommend.explain('sku_456');
// { docId, total, contributions: [{signalId, value, weight}, ...] }
```

## Sync

```typescript
prefsSync: {
  bootstrap: async () => fetch('/api/dddk/prefs').then(r => r.json()),
  pushChange: async (pref) => fetch('/api/dddk/prefs', { method: 'POST', body: JSON.stringify(pref) }),
}
```

Preferences are written to IndexedDB locally and optionally synced to host's backend.
