export type Doc<TMeta = Record<string, unknown>> = {
  id: string;
  fields: Record<string, string>;
  meta?: TMeta;
};

export interface Adapter<R, D = Doc> {
  fromRow(row: R): D;
  toRow?(doc: D, original?: R): R;
}

export const identityAdapter: Adapter<Doc, Doc> = { fromRow: (d) => d };

export type DeltaOp<TRow = unknown> =
  | { op: 'add'; row: TRow }
  | { op: 'update'; row: TRow }
  | { op: 'remove'; id: string };

export type DeltaPayload<TRow = unknown> = {
  version: string | number;
  changes: DeltaOp<TRow>[];
};

export type BootstrapPayload<TRow = unknown> = {
  version: string | number;
  rows: TRow[];
};

export type SyncConfig<TRow = unknown> = {
  bootstrap?: () => Promise<BootstrapPayload<TRow>>;
  fetchDelta?: (sinceVersion: string | number) => Promise<DeltaPayload<TRow>>;
  pollIntervalMs?: number;
  subscribe?: (onChange: (delta: DeltaPayload<TRow>) => void) => () => void;
};

export interface Signal<TDoc = Doc, TCtx = unknown> {
  id: string;
  compute(doc: TDoc, ctx: TCtx): number;
  meta?: { range?: [number, number]; description?: string };
}

export type CombinerKind = 'product' | 'weighted_sum' | 'log_sum';
export type Combiner =
  | CombinerKind
  | ((scores: Record<string, number>, weights: Record<string, number>) => number);

export type ScoreExplanation = {
  docId: string;
  total: number;
  contributions: Array<{ signalId: string; value: number; weight: number }>;
};

export type IdentityProvider = () => Record<string, unknown> | undefined;

export function nfkc(s: string): string {
  return s.normalize('NFKC');
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function combine(
  kind: Combiner,
  scores: Record<string, number>,
  weights: Record<string, number>
): number {
  if (typeof kind === 'function') return kind(scores, weights);
  const ids = Object.keys(scores);
  if (kind === 'product') {
    let p = 1;
    for (const id of ids) {
      const w = weights[id] ?? 1;
      p *= Math.pow(Math.max(0, scores[id] ?? 0), w);
    }
    return p;
  }
  if (kind === 'log_sum') {
    let s = 0;
    for (const id of ids) {
      const w = weights[id] ?? 1;
      s += w * Math.log(Math.max(1e-9, scores[id] ?? 0));
    }
    return Math.exp(s);
  }
  let s = 0;
  for (const id of ids) {
    const w = weights[id] ?? 1;
    s += w * (scores[id] ?? 0);
  }
  return s;
}
