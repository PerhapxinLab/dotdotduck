# Search

全文搜尋,per-field BM25、可插拔評分 signals、per-field 語言包。索引在記憶體裡(可選擇鏡像到 IndexedDB)。

## 快速上手

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

const hits = await search.query('藍色襯衫', { topK: 10 });
// hits: Array<{ doc, score, explanation? }>
```

## API

- `createSearch<TRow>({ adapter, scorers, weights, combiner, topK, language, fieldLanguages, storage, sync, id })`
- `await search.init()` — 開 storage、載入持久化索引
- `await search.addDoc(row)` / `await search.addDocs(rows)` / `await search.updateDoc(row)` / `await search.removeDoc(id)`
- `await search.query(text, { topK, scoreThreshold, customMeta, explain })` → `SearchResult[]`
- `search.explain(text, docId)` — 單筆評分拆解
- `search.onLowConfidence((q, top) => ...)` — escalation hook
- `search.getDoc(id)` / `search.allDocs()` / `search.getFeatures(id)`

## 評分 signals

內建(`builtin.*`):

| Signal | 用途 |
|---|---|
| `bm25Field({ weights })` | 每個 field 的 BM25 + tf-saturation |
| `recencyDecay({ field, halfLifeDays })` | timestamp 欄位半衰期 decay |
| `newProductBoost({ field, withinDays, multiplier })` | 期間內新品加成 |
| `bestsellerBoost({ field, method, maxBoost })` | log-normalize 後的銷量加成 |
| `promoBoost({ field })` | 每筆文件的乘法 boost |
| `inventoryFilter({ field, min })` | Gate:庫存小於 min 的隱藏 |
| `activeFilter({ field })` | Gate:下架商品隱藏 |

自訂 signal 很簡單 — 實作 `SearchScorer`:

```ts
const editorPick: SearchScorer = {
  id: 'editor_pick',
  compute: (doc) => doc.meta?.editor_pick ? 1.5 : 1,
};
```

## Per-field 語言

多語 catalog 直接標每個 field 的語言:

```ts
const search = createSearch({
  adapter: { /* ... */ },
  fieldLanguages: {
    title_zh: 'zh',
    title_en: 'en',
    title_ja: 'ja',
    brand:    'universal',  // 品牌名跨語言用通用 pack
  },
});
```

每個 field 用對應的 lang pack 抽 feature(zh: bigram、en: Porter stemmer、universal: Unicode segmentation)。查詢時自動偵測語言、對到正確的 field。

## 透過 webagent

```ts
dddk.tools.registerSearch({
  items: products,
  toDoc: (p) => ({ id: p.sku, fields: { title: p.name, body: p.description } }),
});
```

LLM 會看到 `search_catalog({ query })`,使用者問商品的時候 agent 自己會 call。詳見 repo 的 `notes/toolbox-as-tools.md` 設計筆記。
