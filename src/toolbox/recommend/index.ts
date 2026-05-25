import type { Doc, Signal, Combiner } from '../common/types.js';
import { combine } from '../common/types.js';
import { resolveStorage } from '../../utils/storage/index.js';
import type { StorageAdapter, StorageKind } from '../../utils/storage/types.js';

/**
 * Structural interface a catalog implementation must satisfy to feed
 * `Recommend`. The shipped `Search` class implements this naturally, so
 * the most common wiring is still
 *
 *   const cat = createSearch({...});
 *   const rec = createRecommend({ catalog: cat, ... });
 *
 * but the interface lets hosts plug their own catalog backend in —
 * e.g. a remote-paged vector store, a graph-based retriever, or a
 * raw in-memory list with no BM25 layer at all. Whatever holds your
 * docs and can yield their features for similarity matching works.
 */
export interface RecommendCatalog {
  /** Look up a single doc by id. */
  getDoc(id: string): Doc | undefined;
  /** Yield every doc the catalog knows about. Order doesn't matter —
   *  `Recommend` scores then re-sorts. */
  allDocs(): Iterable<Doc>;
  /** Return the feature-vector / token list for the doc with this id,
   *  or `undefined` if absent. Used by `contentSimilarity` and the
   *  preference-match scorer to compute Jaccard-style overlap. */
  getFeatures(id: string): string[] | undefined;
}

export type Preference = {
  productId: string;
  response: 'yes' | 'no' | 'dismiss';
  ts: number;
  context?: Record<string, unknown>;
};

export type RecommendContext = {
  userId?: string;
  source?: 'similarTo' | 'forCustomer' | 'goesWith';
  sourceProductId?: string | string[];
  now: number;
  prefs?: Preference[];
  customMeta?: Record<string, unknown>;
};

export type RecommendScorer = Signal<Doc, RecommendContext> & {
  gate?(doc: Doc, ctx: RecommendContext): boolean;
};

export type DiversityOpts = {
  /** meta field to diversify on (e.g. 'category'). */
  field: string;
  /** 0..1 — higher = more diversity. Pure MMR lambda is (1 - this). */
  weight?: number;
  /** how many candidates to consider in MMR pool before slicing topK. */
  poolSize?: number;
};

export type RecommendOpts = {
  id?: string;
  /**
   * Doc source. Any object with `getDoc` / `allDocs` / `getFeatures` works
   * — the shipped `Search` class satisfies this out of the box, but hosts
   * can pass a custom backend (vector store, graph retriever, etc.).
   */
  catalog: RecommendCatalog;
  customerId?: string;
  storage?: StorageKind;
  signals: RecommendScorer[];
  weights?: Record<string, number>;
  combiner?: Combiner;
  topK?: number;
  diversity?: DiversityOpts;
  prefsSync?: {
    bootstrap?: () => Promise<Preference[]>;
    pushChange?: (p: Preference) => Promise<void>;
  };
};

export class Recommend {
  private id: string;
  private catalog: RecommendCatalog;
  private customerId?: string;
  private storage: StorageAdapter;
  private signals: RecommendScorer[];
  private weights: Record<string, number>;
  private combiner: Combiner;
  private topK: number;
  private prefs: Preference[] = [];
  private opened = false;
  private opts: RecommendOpts;

  constructor(opts: RecommendOpts) {
    this.id = opts.id ?? 'default';
    this.catalog = opts.catalog;
    this.customerId = opts.customerId;
    this.storage = resolveStorage(opts.storage ?? 'indexeddb');
    this.signals = opts.signals;
    this.weights = opts.weights ?? {};
    this.combiner = opts.combiner ?? 'product';
    this.topK = opts.topK ?? 10;
    this.opts = opts;
  }

  async init(): Promise<void> {
    await this.storage.open(`dddk-recommend-${this.id}`);
    this.opened = true;
    const snap = (await this.storage.get('recommend:prefs')) as Preference[] | undefined;
    if (snap) this.prefs = snap;
    else if (this.opts.prefsSync?.bootstrap) {
      this.prefs = await this.opts.prefsSync.bootstrap();
      await this.storage.set('recommend:prefs', this.prefs);
    }
  }

  async recordPreference(p: Omit<Preference, 'ts'> & { ts?: number }): Promise<void> {
    const pref: Preference = { ...p, ts: p.ts ?? Date.now() };
    this.prefs.push(pref);
    if (this.opened) await this.storage.set('recommend:prefs', this.prefs);
    if (this.opts.prefsSync?.pushChange) {
      try {
        await this.opts.prefsSync.pushChange(pref);
      } catch {
        /* swallow */
      }
    }
  }

  async similarTo(productId: string, opts: { topK?: number } = {}): Promise<Array<{ doc: Doc; score: number }>> {
    const ctx: RecommendContext = {
      userId: this.customerId,
      source: 'similarTo',
      sourceProductId: productId,
      now: Date.now(),
      prefs: this.prefs,
    };
    return this.rank(ctx, (d) => d.id !== productId, opts.topK ?? this.topK);
  }

  async forCustomer(opts: { topK?: number } = {}): Promise<Array<{ doc: Doc; score: number }>> {
    const ctx: RecommendContext = {
      userId: this.customerId,
      source: 'forCustomer',
      now: Date.now(),
      prefs: this.prefs,
    };
    return this.rank(ctx, () => true, opts.topK ?? this.topK);
  }

  async goesWith(productIds: string[], opts: { topK?: number } = {}): Promise<Array<{ doc: Doc; score: number }>> {
    const ctx: RecommendContext = {
      userId: this.customerId,
      source: 'goesWith',
      sourceProductId: productIds,
      now: Date.now(),
      prefs: this.prefs,
    };
    const set = new Set(productIds);
    return this.rank(ctx, (d) => !set.has(d.id), opts.topK ?? this.topK);
  }

  explain(productId: string, ctx?: Partial<RecommendContext>) {
    const doc = this.catalog.getDoc(productId);
    if (!doc) return undefined;
    const full: RecommendContext = {
      userId: this.customerId,
      source: 'forCustomer',
      now: Date.now(),
      prefs: this.prefs,
      ...ctx,
    };
    const partial: Record<string, number> = {};
    for (const s of this.signals) {
      if (s.gate && !s.gate(doc, full)) return { docId: productId, total: 0, gated: true, contributions: [] };
      partial[s.id] = s.compute(doc, full);
    }
    const total = combine(this.combiner, partial, this.weights);
    return {
      docId: productId,
      total,
      contributions: Object.entries(partial).map(([signalId, value]) => ({
        signalId,
        value,
        weight: this.weights[signalId] ?? 1,
      })),
    };
  }

  private rank(ctx: RecommendContext, filter: (d: Doc) => boolean, topK: number) {
    const results: Array<{ doc: Doc; score: number }> = [];
    for (const doc of this.catalog.allDocs()) {
      if (!filter(doc)) continue;
      let passed = true;
      const partial: Record<string, number> = {};
      for (const s of this.signals) {
        if (s.gate && !s.gate(doc, ctx)) {
          passed = false;
          break;
        }
        partial[s.id] = s.compute(doc, ctx);
      }
      if (!passed) continue;
      const score = combine(this.combiner, partial, this.weights);
      results.push({ doc, score });
    }
    results.sort((a, b) => b.score - a.score);

    // Optional diversity re-rank (MMR-style: greedy max relevance penalized by similarity to already-picked)
    const div = this.opts.diversity;
    if (div) {
      const pool = results.slice(0, div.poolSize ?? topK * 5);
      const picked: Array<{ doc: Doc; score: number }> = [];
      const lambda = 1 - (div.weight ?? 0.3);
      while (picked.length < topK && pool.length > 0) {
        let bestIdx = 0;
        let bestMmr = -Infinity;
        for (let i = 0; i < pool.length; i++) {
          const cand = pool[i]!;
          const candValue = String(cand.doc.meta?.[div.field] ?? '');
          let maxSim = 0;
          for (const p of picked) {
            const pv = String(p.doc.meta?.[div.field] ?? '');
            if (pv && candValue && pv === candValue) {
              maxSim = 1;
              break;
            }
          }
          const mmr = lambda * cand.score - (1 - lambda) * maxSim * (results[0]?.score ?? 1);
          if (mmr > bestMmr) {
            bestMmr = mmr;
            bestIdx = i;
          }
        }
        picked.push(pool.splice(bestIdx, 1)[0]!);
      }
      return picked;
    }

    return results.slice(0, topK);
  }

  async dispose(): Promise<void> {
    if (this.opened) await this.storage.close();
    this.opened = false;
  }
}

// ── Built-in signals ──

function contentSimilarity(opts: { source: RecommendCatalog }): RecommendScorer {
  return {
    id: 'content_similarity',
    compute(doc, ctx) {
      const sourceId = Array.isArray(ctx.sourceProductId) ? ctx.sourceProductId[0] : ctx.sourceProductId;
      if (!sourceId) return 0;
      const sFeats = opts.source.getFeatures(sourceId);
      const tFeats = opts.source.getFeatures(doc.id);
      if (!sFeats || !tFeats) return 0;
      const sSet = new Set(sFeats);
      let overlap = 0;
      for (const f of tFeats) if (sSet.has(f)) overlap++;
      const denom = Math.sqrt(sFeats.length * tFeats.length) || 1;
      return overlap / denom;
    },
  };
}

function recencyDecay(opts: { field?: string; halfLifeDays?: number } = {}): RecommendScorer {
  const field = opts.field ?? 'listed_at';
  const half = (opts.halfLifeDays ?? 90) * 86_400_000;
  return {
    id: 'recency_decay',
    compute(doc, ctx) {
      const ts = Number(doc.meta?.[field] ?? 0);
      if (!ts) return 1;
      const age = Math.max(0, ctx.now - ts);
      return Math.pow(0.5, age / half);
    },
  };
}

function coldStartBayesian(opts: { priorWeight?: number; priorRate?: number; yesField?: string; eventsField?: string } = {}): RecommendScorer {
  const k = opts.priorWeight ?? 50;
  const prior = opts.priorRate ?? 0.5;
  const yes = opts.yesField ?? 'lifetime_yes_count';
  const events = opts.eventsField ?? 'lifetime_event_count';
  return {
    id: 'cold_start_bayesian',
    compute(doc) {
      const y = Number(doc.meta?.[yes] ?? 0);
      const e = Number(doc.meta?.[events] ?? 0);
      return (y + prior * k) / (e + k);
    },
  };
}

function saturation(opts: { field: string; cap?: number }): RecommendScorer {
  const cap = opts.cap ?? 200;
  return {
    id: 'saturation_' + opts.field,
    compute(doc) {
      const v = Number(doc.meta?.[opts.field] ?? 0);
      return cap * (1 - Math.exp(-v / cap));
    },
  };
}

function promoBoost(opts: { field?: string } = {}): RecommendScorer {
  const field = opts.field ?? 'promo_boost';
  return {
    id: 'promo_boost',
    compute(doc) {
      const v = Number(doc.meta?.[field] ?? 1);
      return v > 0 ? v : 1;
    },
  };
}

function preferenceMatch(opts: { catalog: RecommendCatalog; yesBoost?: number; noBoost?: number } = {} as never): RecommendScorer {
  const yesBoost = opts.yesBoost ?? 2.0;
  const noBoost = opts.noBoost ?? 0.3;
  return {
    id: 'preference_match',
    compute(doc, ctx) {
      const prefs = ctx.prefs ?? [];
      if (prefs.length === 0) return 1;
      const targetFeats = new Set(opts.catalog.getFeatures(doc.id) ?? []);
      let yesOverlap = 0;
      let noOverlap = 0;
      for (const p of prefs) {
        const f = opts.catalog.getFeatures(p.productId);
        if (!f) continue;
        let overlap = 0;
        for (const x of f) if (targetFeats.has(x)) overlap++;
        if (p.response === 'yes') yesOverlap += overlap;
        else if (p.response === 'no') noOverlap += overlap;
      }
      const yesFactor = 1 + (yesBoost - 1) * Math.tanh(yesOverlap / 10);
      const noFactor = noBoost + (1 - noBoost) * Math.exp(-noOverlap / 10);
      return yesFactor * noFactor;
    },
  };
}

function diversityPenalty(opts: { field: string; topNPenalty?: number }): RecommendScorer {
  // Note: true diversity needs post-ranking; this stub just deprioritizes overrepresented categories
  void opts;
  return {
    id: 'diversity_penalty',
    compute: () => 1,
  };
}

export const builtin = {
  contentSimilarity,
  recencyDecay,
  coldStartBayesian,
  saturation,
  promoBoost,
  preferenceMatch,
  diversityPenalty,
};

export function createRecommend(opts: RecommendOpts): Recommend {
  return new Recommend(opts);
}
