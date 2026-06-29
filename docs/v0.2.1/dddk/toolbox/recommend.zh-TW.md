# Recommend

Catalog 推薦器 — 共用一個 Search index 做內容相似度,加上可插拔 signal pipeline 做排序。記錄 `yes/no/dismiss` 偏好,即時影響推薦排序。

## 快速上手

```ts
import { createSearch } from '@perhapxin/dddk/toolbox/search';
import { createRecommend, builtin as recBuiltin } from '@perhapxin/dddk/toolbox/recommend';
import { builtin as searchBuiltin } from '@perhapxin/dddk/toolbox/search';

// 1. 建 Search index — 就是 recommend 的 catalog
const catalog = createSearch({
  adapter: { fromRow: (p: Product) => ({ id: p.sku, fields: { title: p.name, category: p.cat } }) },
  scorers: [searchBuiltin.bm25Field({ weights: { title: { weight: 2 } } })],
});
await catalog.init();
await catalog.addDocs(products);

// 2. 對著 catalog 接 recommender
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

// 3. 三種 query 模式
const similar    = await rec.similarTo('sku-101', { topK: 5 });
const forYou     = await rec.forCustomer({ topK: 5 });
const goesWith   = await rec.goesWith(['sku-101', 'sku-203'], { topK: 5 });

// 4. 記錄偏好 — 下一次 query 立即反映
await rec.recordPreference({ productId: 'sku-101', response: 'yes' });
await rec.recordPreference({ productId: 'sku-999', response: 'no' });
```

## 內建 signals(`recBuiltin.*`)

| Signal | 效果 |
|---|---|
| `preferenceMatch({ catalog, yesBoost, noBoost })` | 跟 yes 物品共享特徵的加成,跟 no 共享的扣分 |
| `contentSimilarity()` | query / item feature cosine similarity |
| `recencyDecay({ field, halfLifeDays })` | timestamp 半衰期 decay |
| `saturation({ field, cap })` | 數值欄位對數飽和 |
| `promoBoost({ field })` | 每筆乘法 boost |
| `coldStartBayesian({ ratingField, countField, prior })` | 新品 Bayesian 平均 |
| `diversityPenalty({ field, topNPenalty })` | 同類別過度集中扣分 |

## 三種 query 模式

- `similarTo(productId)` — 「跟這個類似的」
- `forCustomer()` — 為當前 customer 個人化 top-K
- `goesWith(productIds)` — 搭配 / 互補推薦

## 偏好持久化

偏好寫入 `storage`(預設 IndexedDB)。Host 也可以透過 `prefsSync.pushChange` / `bootstrap` 同步到後端。

## 透過 webagent

```ts
dddk.tools.registerRecommend({
  items: products,
  toDoc: (p) => ({ id: p.sku, fields: { title: p.name, category: p.cat } }),
});
```

會註冊三個工具到 agent:

- `recommend_for_customer()` — 無參數,個人化 top-K
- `recommend_similar({ productId })` — 類似的物品
- `record_preference({ productId, response: 'yes'|'no'|'dismiss' })` — 回饋使用者意見

LLM 可以串著用:「給你 3 本像 Dune 的書」(`recommend_similar`)、使用者選一本、agent 自動 `record_preference({yes})`、下一次 `forCustomer` 排序立即不同。

## API

- `createRecommend({ catalog, customerId, signals, weights, combiner, topK, diversity, prefsSync, storage, id })`
- `await rec.init()`
- `await rec.recordPreference({ productId, response, context? })`
- `await rec.similarTo(productId, { topK })`
- `await rec.forCustomer({ topK })`
- `await rec.goesWith(productIds, { topK })`
- `rec.explain(productId, ctx?)`
