/**
 * learn-to-rank — logistic regression over per-field BM25 contributions.
 *
 * Input: click events `{query, shown: [{docId, fields_score: {title, brand, ...}}], clicked: docId}`
 * Output: per-field weights that maximize click-through.
 *
 * Algorithm: minibatch gradient descent on binary cross-entropy with L2.
 * Pure TS, no external ML deps. Good enough for ~100k events.
 */

export type ClickEvent = {
  query: string;
  shown: Array<{
    docId: string;
    fieldScores: Record<string, number>; // BM25 contribution per field
  }>;
  clickedDocId: string;
};

export type LearnOpts = {
  fields: string[];
  iterations?: number;
  learningRate?: number;
  l2?: number;
  batchSize?: number;
};

export type LearnedWeights = {
  weights: Record<string, number>;
  loss: number;
  iterations: number;
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function learnRankingWeights(events: ClickEvent[], opts: LearnOpts): LearnedWeights {
  const fields = opts.fields;
  const lr = opts.learningRate ?? 0.05;
  const l2 = opts.l2 ?? 1e-4;
  const iterations = opts.iterations ?? 200;
  const batchSize = opts.batchSize ?? 32;

  // Build pairwise training set: (clicked_doc, non_clicked_doc) pairs.
  // Target: P(clicked > non_clicked) = sigmoid(w·(f_clicked - f_other))
  type Pair = { delta: Record<string, number> };
  const pairs: Pair[] = [];
  for (const ev of events) {
    const clicked = ev.shown.find((s) => s.docId === ev.clickedDocId);
    if (!clicked) continue;
    for (const s of ev.shown) {
      if (s.docId === ev.clickedDocId) continue;
      const delta: Record<string, number> = {};
      for (const f of fields) {
        delta[f] = (clicked.fieldScores[f] ?? 0) - (s.fieldScores[f] ?? 0);
      }
      pairs.push({ delta });
    }
  }

  // Initialize weights
  const weights: Record<string, number> = {};
  for (const f of fields) weights[f] = 1;

  let lastLoss = Infinity;
  for (let iter = 0; iter < iterations; iter++) {
    // Shuffle (simple)
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j]!, pairs[i]!];
    }
    let totalLoss = 0;
    for (let bs = 0; bs < pairs.length; bs += batchSize) {
      const batch = pairs.slice(bs, bs + batchSize);
      const grads: Record<string, number> = {};
      for (const f of fields) grads[f] = 0;
      let batchLoss = 0;
      for (const p of batch) {
        let z = 0;
        for (const f of fields) z += (weights[f] ?? 0) * (p.delta[f] ?? 0);
        const prob = sigmoid(z);
        batchLoss += -Math.log(Math.max(1e-12, prob));
        const err = 1 - prob;
        for (const f of fields) {
          grads[f] = (grads[f] ?? 0) + err * (p.delta[f] ?? 0);
        }
      }
      for (const f of fields) {
        const g = (grads[f] ?? 0) / Math.max(1, batch.length);
        weights[f] = (weights[f] ?? 0) + lr * g - lr * l2 * (weights[f] ?? 0);
      }
      totalLoss += batchLoss;
    }
    lastLoss = totalLoss / Math.max(1, pairs.length);
  }

  return { weights, loss: lastLoss, iterations };
}
