import type {
  Adapter,
  Combiner,
  Doc,
  ScoreExplanation,
  Signal,
  SyncConfig,
} from '../common/types.js';
import type { StorageKind } from '../../utils/storage/types.js';
import type { SearchStore } from './store.js';

export type SearchContext = {
  query: string;
  queryFeatures: string[];
  now: number;
  userId?: string;
  customMeta?: Record<string, unknown>;
  /** Internal — injected by Search.query for scorers that need store access (e.g. bm25Field). */
  _store?: SearchStore;
};

export type SearchScorer = Signal<Doc, SearchContext> & {
  /**
   * Optional gate: if returns false, the doc is filtered out entirely
   * (e.g. inventoryFilter for out-of-stock items).
   */
  gate?(doc: Doc, ctx: SearchContext): boolean;
};

export type SearchOpts<TRow = unknown> = {
  id?: string;
  adapter?: Adapter<TRow, Doc>;
  storage?: StorageKind;
  sync?: SyncConfig<TRow>;
  /**
   * Optional host-supplied tokeniser. Same function is used to index docs
   * AND to parse queries — symmetry is what makes BM25 matching work.
   *
   * Default: a Unicode-aware universal tokeniser (NFKC normalise +
   * whitespace split for whitespace scripts; codepoint + bigram for CJK,
   * Thai, Lao, Khmer, Burmese; lowercase throughout). Handles 200+
   * languages out of the box with no per-locale packs.
   *
   * Plug in your own when you have domain-specific tokenisation rules
   * (e.g. medical term splitter, product SKU boundaries, ICD codes).
   */
  extractFeatures?: (text: string) => string[];
  scorers: SearchScorer[];
  combiner?: Combiner;
  weights?: Record<string, number>;
  topK?: number;
  scoreThreshold?: number;
};

export type SearchResult<TDoc = Doc> = {
  doc: TDoc;
  score: number;
  explanation?: ScoreExplanation;
};

export type QueryOpts = {
  topK?: number;
  explain?: boolean;
  scoreThreshold?: number;
  customMeta?: Record<string, unknown>;
};
