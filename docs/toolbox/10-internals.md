# internals

Raw algorithm primitives exposed for advanced hosts. Most hosts won't need these
directly — the feature modules (`search` / `recommend` / etc.) wrap them.

## What's there

| Export | Purpose |
|--------|---------|
| `porterStem(word)`                   | Porter (1980) English stemmer |
| `EN_STOPWORDS`, `ZH_STOPWORDS`       | Curated stopword sets |
| `bm25TermScore(tf, df, N, dl, avgDl, opts)` | Okapi-BM25 single-term scoring |
| `saturateTf(tf, cap)`                | TF saturation `cap * (1 - exp(-tf/cap))` |
| `NaiveBayes`                         | Multinomial NB class with `snapshot` / `restore` / `explain` |
| `betaSample(alpha, beta)`            | Beta distribution sample (Thompson sampling) |
| `wilsonScoreLower(positive, total)`  | Wilson confidence-interval lower bound |

## When to import directly

- Writing a custom search scorer that needs raw BM25
- Building a custom A/B selector (use `betaSample`)
- Statistically robust ranking from sparse data (use `wilsonScoreLower`)
- Standalone Naive Bayes use outside of `classify`

```typescript
import { NaiveBayes, bm25TermScore, betaSample } from '@perhapxin/dddk/toolbox/internals';

const nb = new NaiveBayes({ alpha: 1.0 });
nb.train([{ features: ['a', 'b'], label: 'x' }]);

const idfTerm = bm25TermScore(2, 5, 100, 10, 12);

const winner = ['A', 'B', 'C'][
  [
    [yesA, noA],
    [yesB, noB],
    [yesC, noC],
  ].map(([y, n]) => betaSample(y + 1, n + 1)).indexOf(Math.max(...samples))
];
```
