import { combine, type Adapter, type Doc, identityAdapter } from '../common/types.js';
import { resolveStorage } from '../../utils/storage/index.js';
import type { StorageAdapter } from '../../utils/storage/types.js';
import { extractFeatures as defaultExtract } from '../../utils/text/index.js';
import { SearchStore } from './store.js';
import * as builtinAll from './builtin.js';
import type {
  QueryOpts,
  SearchContext,
  SearchOpts,
  SearchResult,
  SearchScorer,
} from './types.js';

export type { SearchOpts, SearchResult, SearchScorer, SearchContext, QueryOpts } from './types.js';
export const builtin = builtinAll.builtin;
export { learnRankingWeights } from './learn.js';
export type { ClickEvent, LearnOpts, LearnedWeights } from './learn.js';

const SNAPSHOT_KEY = (id: string) => `search:${id}:snapshot`;
const VERSION_KEY = (id: string) => `search:${id}:version`;

export class Search<TRow = unknown> {
  private id: string;
  private store = new SearchStore();
  private adapter: Adapter<TRow, Doc>;
  private storage: StorageAdapter;
  private scorers: SearchScorer[];
  private weights: Record<string, number>;
  private extract: (text: string) => string[];
  private combiner: SearchOpts<TRow>['combiner'];
  private topK: number;
  private scoreThreshold: number;
  private opts: SearchOpts<TRow>;
  private opened = false;
  private lowConfHook?: (q: string, c: SearchResult[]) => Promise<SearchResult[]>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => void;

  constructor(opts: SearchOpts<TRow>) {
    this.id = opts.id ?? 'default';
    this.adapter = (opts.adapter ?? (identityAdapter as unknown as Adapter<TRow, Doc>));
    this.storage = resolveStorage(opts.storage);
    this.scorers = opts.scorers ?? [];
    this.weights = opts.weights ?? {};
    this.extract = opts.extractFeatures ?? defaultExtract;
    this.combiner = opts.combiner ?? 'product';
    this.topK = opts.topK ?? 20;
    this.scoreThreshold = opts.scoreThreshold ?? 0;
    this.opts = opts;
  }

  async init(): Promise<void> {
    await this.storage.open(`dddk-search-${this.id}`);
    this.opened = true;
    const snapshot = (await this.storage.get(SNAPSHOT_KEY(this.id))) as { docs: Doc[] } | undefined;
    if (snapshot?.docs) {
      for (const d of snapshot.docs) this.store.add(d, this.extract);
    }
    if (this.opts.sync) await this.startSync();
  }

  async addDoc(row: TRow): Promise<void> {
    const doc = this.adapter.fromRow(row);
    this.store.add(doc, this.extract);
    await this.persist();
  }

  async addDocs(rows: TRow[]): Promise<void> {
    for (const row of rows) {
      const doc = this.adapter.fromRow(row);
      this.store.add(doc, this.extract);
    }
    await this.persist();
  }

  async removeDoc(id: string): Promise<void> {
    this.store.remove(id);
    await this.persist();
  }

  async updateDoc(row: TRow): Promise<void> {
    return this.addDoc(row);
  }

  async query(text: string, opts: QueryOpts = {}): Promise<SearchResult[]> {
    const queryFeatures = this.extract(text);
    const ctx: SearchContext = {
      query: text,
      queryFeatures,
      now: Date.now(),
      customMeta: opts.customMeta,
      _store: this.store,
    };
    const candIds = this.store.candidates(queryFeatures);
    const results: SearchResult[] = [];
    for (const id of candIds) {
      const doc = this.store.docs.get(id);
      if (!doc) continue;
      let passed = true;
      const partial: Record<string, number> = {};
      for (const s of this.scorers) {
        if (s.gate && !s.gate(doc, ctx)) {
          passed = false;
          break;
        }
        partial[s.id] = s.compute(doc, ctx);
      }
      if (!passed) continue;
      const score = combine(this.combiner ?? 'product', partial, this.weights);
      if (score < (opts.scoreThreshold ?? this.scoreThreshold)) continue;
      const result: SearchResult = { doc, score };
      if (opts.explain) {
        result.explanation = {
          docId: id,
          total: score,
          contributions: Object.entries(partial).map(([signalId, value]) => ({
            signalId,
            value,
            weight: this.weights[signalId] ?? 1,
          })),
        };
      }
      results.push(result);
    }
    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, opts.topK ?? this.topK);
    if (this.lowConfHook && top.length > 0 && (top[0]?.score ?? 0) < (opts.scoreThreshold ?? this.scoreThreshold) * 2) {
      return await this.lowConfHook(text, top);
    }
    return top;
  }

  explain(text: string, docId: string) {
    const queryFeatures = this.extract(text);
    const doc = this.store.docs.get(docId);
    if (!doc) return undefined;
    const ctx: SearchContext = { query: text, queryFeatures, now: Date.now(), _store: this.store };
    const partial: Record<string, number> = {};
    for (const s of this.scorers) {
      if (s.gate && !s.gate(doc, ctx)) return { docId, total: 0, gated: true, contributions: [] };
      partial[s.id] = s.compute(doc, ctx);
    }
    const total = combine(this.combiner ?? 'product', partial, this.weights);
    return {
      docId,
      total,
      contributions: Object.entries(partial).map(([signalId, value]) => ({
        signalId,
        value,
        weight: this.weights[signalId] ?? 1,
      })),
    };
  }

  onLowConfidence(fn: (q: string, c: SearchResult[]) => Promise<SearchResult[]>): void {
    this.lowConfHook = fn;
  }

  async snapshot() {
    return { docs: [...this.store.docs.values()] };
  }
  async restore(snap: { docs: Doc[] }): Promise<void> {
    this.store = new SearchStore();
    for (const d of snap.docs) this.store.add(d, this.extract);
    await this.persist();
  }

  async dispose(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.unsubscribe) this.unsubscribe();
    if (this.opened) await this.storage.close();
    this.opened = false;
  }

  getDoc(id: string): Doc | undefined {
    return this.store.docs.get(id);
  }
  allDocs(): Iterable<Doc> {
    return this.store.docs.values();
  }
  getFeatures(id: string): string[] | undefined {
    return this.store.features.get(id);
  }
  // Internal access used by adjacent modules (e.g. recommend.contentSimilarity)
  _store(): SearchStore {
    return this.store;
  }

  private async persist(): Promise<void> {
    if (!this.opened) return;
    await this.storage.set(SNAPSHOT_KEY(this.id), { docs: [...this.store.docs.values()] });
  }

  private async startSync(): Promise<void> {
    const sync = this.opts.sync;
    if (!sync) return;
    const currentVersion = (await this.storage.get(VERSION_KEY(this.id))) as string | number | undefined;

    if (currentVersion === undefined && sync.bootstrap) {
      const payload = await sync.bootstrap();
      for (const row of payload.rows) {
        const doc = this.adapter.fromRow(row);
        this.store.add(doc, this.extract);
      }
      await this.persist();
      await this.storage.set(VERSION_KEY(this.id), payload.version);
    }

    if (sync.subscribe) {
      this.unsubscribe = sync.subscribe(async (delta) => this.applyDeltaPayload(delta));
    } else if (sync.fetchDelta && sync.pollIntervalMs) {
      this.pollTimer = setInterval(async () => {
        const v = (await this.storage.get(VERSION_KEY(this.id))) as string | number | undefined;
        if (v === undefined) return;
        try {
          const payload = await sync.fetchDelta!(v);
          await this.applyDeltaPayload(payload);
        } catch {
          /* swallow */
        }
      }, sync.pollIntervalMs);
    }
  }

  private async applyDeltaPayload(payload: {
    version: string | number;
    changes: Array<{ op: 'add' | 'update' | 'remove'; row?: TRow; id?: string }>;
  }): Promise<void> {
    for (const ch of payload.changes) {
      if (ch.op === 'remove' && ch.id) this.store.remove(ch.id);
      else if (ch.row) {
        const d = this.adapter.fromRow(ch.row);
        this.store.add(d, this.extract);
      }
    }
    await this.persist();
    await this.storage.set(VERSION_KEY(this.id), payload.version);
  }
}

export function createSearch<TRow = unknown>(opts: SearchOpts<TRow>): Search<TRow> {
  return new Search<TRow>(opts);
}
