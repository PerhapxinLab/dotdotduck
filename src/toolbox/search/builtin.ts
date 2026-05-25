import type { Doc } from '../common/types.js';
import type { SearchContext, SearchScorer } from './types.js';
import { bm25TermScore, saturateTf } from '../../utils/text/bm25.js';
import type { SearchStore } from './store.js';

export type FieldWeightConfig = {
  weight: number;
  saturation?: number;
};

export type BM25FieldOpts = {
  weights: Record<string, FieldWeightConfig>;
  k1?: number;
  b?: number;
};

/**
 * Per-field BM25 with saturation. Reads the store from ctx._store (injected by Search).
 */
export function bm25Field(opts: BM25FieldOpts): SearchScorer {
  return {
    id: 'bm25_field',
    compute(doc: Doc, ctx: SearchContext): number {
      const s = ctx._store;
      if (!s) return 0;
      const uniqQ = new Set(ctx.queryFeatures);
      let total = 0;
      for (const f of uniqQ) {
        const postings = s.postingsFor(f);
        if (!postings) continue;
        const hit = postings.find((p) => p.docId === doc.id);
        if (!hit) continue;
        const df = postings.length;
        for (const [field, freq] of Object.entries(hit.fieldFreqs)) {
          const fw = opts.weights[field];
          if (!fw) continue;
          const sat = saturateTf(freq, fw.saturation ?? 7);
          const avgLen = s.avgFieldLen(field);
          const docLen = avgLen;
          const score = bm25TermScore(sat, df, s.totalDocs, docLen, avgLen, opts);
          total += score * fw.weight;
        }
      }
      return total;
    },
  };
}

export type RecencyOpts = { field: string; halfLifeDays?: number };
export function recencyDecay(opts: RecencyOpts): SearchScorer {
  const half = (opts.halfLifeDays ?? 90) * 86_400_000;
  return {
    id: 'recency_decay',
    compute(doc: Doc, ctx: SearchContext): number {
      const ts = Number(doc.meta?.[opts.field] ?? 0);
      if (!ts) return 1;
      const age = Math.max(0, ctx.now - ts);
      return Math.pow(0.5, age / half);
    },
  };
}

export type NewProductBoostOpts = { field: string; withinDays?: number; multiplier?: number };
export function newProductBoost(opts: NewProductBoostOpts): SearchScorer {
  const window = (opts.withinDays ?? 30) * 86_400_000;
  const m = opts.multiplier ?? 1.4;
  return {
    id: 'new_product_boost',
    compute(doc: Doc, ctx: SearchContext): number {
      const ts = Number(doc.meta?.[opts.field] ?? 0);
      if (!ts) return 1;
      return ctx.now - ts < window ? m : 1;
    },
  };
}

export type BestsellerBoostOpts = {
  field: string;
  method?: 'log_normalize' | 'rank_inverse';
  maxBoost?: number;
};
export function bestsellerBoost(opts: BestsellerBoostOpts): SearchScorer {
  const max = opts.maxBoost ?? 1.3;
  return {
    id: 'bestseller_boost',
    compute(doc: Doc): number {
      const v = Number(doc.meta?.[opts.field] ?? 0);
      if (v <= 0) return 1;
      if (opts.method === 'rank_inverse') {
        return 1 + (max - 1) / Math.max(1, v);
      }
      // default: log_normalize, with diminishing returns
      const norm = Math.log1p(v) / Math.log1p(10_000);
      return 1 + (max - 1) * Math.min(1, norm);
    },
  };
}

export function promoBoost(opts: { field?: string } = {}): SearchScorer {
  const field = opts.field ?? 'promo_boost';
  return {
    id: 'promo_boost',
    compute(doc: Doc): number {
      const v = Number(doc.meta?.[field] ?? 1);
      return v > 0 ? v : 1;
    },
  };
}

export function inventoryFilter(opts: { field?: string; min?: number } = {}): SearchScorer {
  const field = opts.field ?? 'stock_qty';
  const min = opts.min ?? 1;
  return {
    id: 'inventory_filter',
    compute: () => 1,
    gate(doc: Doc): boolean {
      const v = Number(doc.meta?.[field] ?? Infinity);
      return v >= min;
    },
  };
}

export function activeFilter(opts: { field?: string } = {}): SearchScorer {
  const field = opts.field ?? 'active';
  return {
    id: 'active_filter',
    compute: () => 1,
    gate(doc: Doc): boolean {
      const v = doc.meta?.[field];
      return v === undefined || Boolean(v);
    },
  };
}

export const builtin = {
  bm25Field,
  recencyDecay,
  newProductBoost,
  bestsellerBoost,
  promoBoost,
  inventoryFilter,
  activeFilter,
};
