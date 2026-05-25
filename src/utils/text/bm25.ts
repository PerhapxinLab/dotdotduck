/**
 * Okapi-BM25 with Lucene-style smoothed IDF.
 *   idf = log((N - df + 0.5) / (df + 0.5) + 1)      // always >= 0
 *
 * Used by `search` for full-text ranking and by `qa` for FAQ retrieval.
 */

export type BM25Opts = { k1?: number; b?: number };

export function bm25TermScore(
  tf: number,
  df: number,
  totalDocs: number,
  docLen: number,
  avgDocLen: number,
  opts: BM25Opts = {},
): number {
  const k1 = opts.k1 ?? 1.5;
  const b = opts.b ?? 0.75;
  if (tf <= 0 || df <= 0 || totalDocs <= 0) return 0;
  const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
  const denom = tf + k1 * (1 - b + (b * docLen) / Math.max(1, avgDocLen));
  return (idf * (tf * (k1 + 1))) / denom;
}

/** Saturated TF — caps marginal contribution after `cap` hits. Prevents
 *  keyword spam from dominating ranking. */
export function saturateTf(rawTf: number, cap: number): number {
  if (cap <= 0) return rawTf;
  return cap * (1 - Math.exp(-rawTf / cap));
}
