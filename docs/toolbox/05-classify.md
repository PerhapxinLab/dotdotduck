# classify

Multinomial Naive Bayes with Laplace smoothing. Pluggable feature extractors.
500-row training set is enough for most intent classification jobs.

## Usage

```typescript
import { createClassifier, builtin } from '@perhapxin/dddk/toolbox/classify';

const intent = createClassifier({
  features: [
    builtin.bigramFeatures(),
    builtin.lengthBucket(),
    // host custom
    { id: 'has_sku', extract: (t) => /[A-Z]{2,}-\d+/.test(t) ? ['__has_sku'] : [] },
  ],
  smoothing: { alpha: 1.0 },
  storage: 'indexeddb',
});
await intent.init();

intent.train([
  { text: '我要退貨', label: 'refund' },
  { text: '怎麼換貨', label: 'refund' },
  { text: '東西壞掉', label: 'refund' },
  { text: '商品瑕疵', label: 'refund' },
  { text: '甚麼時候到', label: 'shipping' },
  { text: '物流多久', label: 'shipping' },
  // 50-500 samples total
]);

const result = intent.predict('我東西壞掉可以換嗎');
// { label: 'refund', scores: { refund: -10.7, shipping: -16.4 }, margin: 5.7 }
```

## Why this beats LLM zero-shot

For narrow domain (10-20 intents, recognisable vocabulary), Naive Bayes:
- < 1ms inference
- Zero API calls
- Fully explainable
- Improves incrementally with `partialTrain`

LLM zero-shot is good for open-domain. For your closed set of customer-service
intents, train this and skip the API.

## Explain — debug exactly which feature voted for which class

```typescript
const expl = intent.explain('我東西壞掉可以換嗎', 'refund');
// {
//   label: 'refund',
//   features: [
//     { feature: '壞掉', contribution:  2.3, inClass: 0.045, inOther: 0.002 },
//     { feature: '換',   contribution:  1.8, inClass: 0.038, inOther: 0.008 },
//     ...
//   ],
// }
```

`contribution > 0` means the feature pushed toward this class.

## Multi-language training

Mix languages in the same training set. Each sample optionally carries `lang`;
if absent, the language is auto-detected. Features are prefixed with the
detected language ID, preventing cross-language collisions:

```typescript
intent.train([
  { text: '我要退貨',          label: 'refund',   lang: 'zh' },
  { text: 'I want to return',  label: 'refund',   lang: 'en' },
  { text: '送貨時間',          label: 'shipping', lang: 'zh' },
  { text: 'when does it ship', label: 'shipping', lang: 'en' },
]);

intent.predict('東西壞掉');                  // → 'refund' (zh path)
intent.predict('my item is broken');         // → 'refund' (en path)
```

Internally, the bigram for "壞掉" is stored as `zh:壞掉` and "broken" as
`en:broken` — so a chinese character that incidentally byte-matches an English
substring won't poison the prediction.

## Incremental learning

```typescript
intent.partialTrain({ text: '配送出問題', label: 'shipping' });
await intent.save();   // persist to IndexedDB
```

Train once at deploy, accumulate new examples as you collect real queries.
