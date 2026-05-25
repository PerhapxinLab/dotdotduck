# lang

Language packs for tokenisation, feature extraction, optional stemming and
stopwords. Universal Unicode pack covers 200+ languages from day one.

## Built-in packs

| ID | Detection | Tokeniser | Features | Stem | Stopwords |
|----|-----------|-----------|----------|------|-----------|
| `universal` | Always 0.5 (final fallback) | Unicode-aware: CJK/SE-Asian → char, others → whitespace | unigram + bigram | – | – |
| `en` | Latin-only test | lower + split non-alnum | Porter-stemmed unigram + bigram | Porter | 200+ English words |
| `zh` | CJK character ratio | char-level | char unigram + bigram | – | ~50 common particles |

## How auto-detection works

```typescript
import { languages } from '@perhapxin/dddk/toolbox/lang';

languages.detect('blue shirt').id;      // → 'en'
languages.detect('藍色襯衫').id;        // → 'zh'
languages.detect('привет мир').id;     // → 'universal' (no specialised pack)
```

Each pack reports a confidence 0..1 from `pack.detect(text)`. The registry returns
the highest-confidence pack above 0.3, otherwise falls back to universal.

## Forcing a language

```typescript
languages.forLang('en', anyText).id;        // → 'en'
languages.forLang('auto', '藍色').id;       // → 'zh' (auto-detect)
```

`Search`, `Memory`, `QA`, `Classify` all accept `language: 'auto' | 'en' | 'zh' | ...`.

## Registering third-party packs

```typescript
import { languages } from '@perhapxin/dddk/toolbox/lang';
import { ja } from '@perhapxin/dddk-lang-ja';   // hypothetical npm package

languages.register(ja);
```

## Writing a language pack

```typescript
import type { LanguagePack } from '@perhapxin/dddk/toolbox/lang';

export const ja: LanguagePack = {
  id: 'ja',

  detect(text: string): number {
    // Return 0..1 confidence
    const hiragana = (text.match(/[぀-ヿ]/g) ?? []).length;
    return Math.min(1, hiragana / Math.max(1, text.length));
  },

  tokenize(text: string): string[] {
    // Implementation up to you — MeCab, char bigram, kuromoji, ...
    return Array.from(text).filter((c) => /[\p{L}\p{N}]/u.test(c));
  },

  extractFeatures(text: string): string[] {
    const tokens = this.tokenize(text);
    const out = [...tokens];
    for (let i = 0; i + 1 < tokens.length; i++) out.push(tokens[i] + tokens[i + 1]);
    return out;
  },

  // Optional:
  stem(token: string): string { return token; },
  isStopword(token: string): boolean { return false; },
};
```

Minimum contract: `detect`, `tokenize`, `extractFeatures`. The rest is bonus.

## When to write a specialised pack vs use universal

| Situation | Pack |
|-----------|------|
| Latin / Cyrillic / Arabic / Hebrew / Indic scripts, simple use | universal (already works) |
| CJK without segmentation needs | universal (char bigram) |
| English with stemming wanted | `en` |
| Chinese with stopwords filter | `zh` |
| Need word-level segmentation for CJK (jieba/MeCab quality) | Write specialised pack |
| Morphologically rich language (Finnish/Turkish) needing proper stem | Write specialised pack with Snowball stemmer |
