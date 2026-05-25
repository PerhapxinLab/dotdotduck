/**
 * Universal text utilities — tokenisation, BM25 ranking, Beta sampling.
 *
 * Locale-neutral by design: no per-language packs, no English stemmers, no
 * hardcoded stopword lists. Hosts with a domain-specific tokeniser pass their
 * own to the consumer (e.g. `createSearch({ tokenize })`). See
 * `feedback_no_language_hardcoding.md` for the rationale.
 */
export { tokenize, extractFeatures, nfkc } from './tokenize.js';
export { bm25TermScore, saturateTf, type BM25Opts } from './bm25.js';
export { betaSample, wilsonScoreLower } from './sampling.js';
