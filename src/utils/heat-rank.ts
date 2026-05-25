/**
 * HeatRank — frequency × recency scoring for palette items, recent files,
 * snippet suggestions, etc.
 *
 * Algorithm: each "visit" adds a unit boost that decays exponentially over
 * `halfLifeMs`. Total score = sum of decayed visit weights.
 *   score(now) = Σ (0.5 ^ ((now - visitedAt) / halfLifeMs))
 *
 * Sorted descending → most-recently-and-frequently-used items float to top.
 *
 * Storage is opaque — caller passes a `read/write` adapter. Default uses
 * an in-process Map (lost on reload). For persistence, wire to the dddk Cache.
 */

export interface HeatRankAdapter {
  read(scope: string): Record<string, number[]>;
  write(scope: string, data: Record<string, number[]>): void;
}

export interface HeatRankOptions {
  /** Identifier scoping ranks (e.g. 'palette', 'recent-files'). */
  scope?: string;
  /** Time in ms for visit weight to halve. Default 7 days. */
  halfLifeMs?: number;
  /** Cap on visits kept per item — prevents unbounded growth. Default 20. */
  maxVisitsPerItem?: number;
  /** Adapter for persistence. Defaults to in-memory. */
  adapter?: HeatRankAdapter;
}

const DEFAULT_HALF_LIFE = 7 * 24 * 60 * 60 * 1000; // 7 days

export class HeatRank {
  private scope: string;
  private halfLifeMs: number;
  private maxVisitsPerItem: number;
  private adapter: HeatRankAdapter;

  constructor(opts: HeatRankOptions = {}) {
    this.scope = opts.scope ?? 'default';
    this.halfLifeMs = opts.halfLifeMs ?? DEFAULT_HALF_LIFE;
    this.maxVisitsPerItem = opts.maxVisitsPerItem ?? 20;
    this.adapter = opts.adapter ?? makeMemoryAdapter();
  }

  /** Record a usage event for the given id. */
  visit(id: string): void {
    const all = this.adapter.read(this.scope);
    const arr = all[id] ?? [];
    arr.push(Date.now());
    if (arr.length > this.maxVisitsPerItem) {
      arr.splice(0, arr.length - this.maxVisitsPerItem);
    }
    all[id] = arr;
    this.adapter.write(this.scope, all);
  }

  /** Current score for one id. */
  score(id: string, now: number = Date.now()): number {
    const all = this.adapter.read(this.scope);
    const visits = all[id];
    if (!visits || visits.length === 0) return 0;
    let sum = 0;
    for (const t of visits) {
      const age = now - t;
      if (age < 0) sum += 1;
      else sum += Math.pow(0.5, age / this.halfLifeMs);
    }
    return sum;
  }

  /** Sort items in descending score. Items not yet visited go last (via fallbackCompare). */
  sort<T>(
    items: T[],
    idOf: (item: T) => string,
    fallbackCompare?: (a: T, b: T) => number
  ): T[] {
    const now = Date.now();
    return [...items].sort((a, b) => {
      const sa = this.score(idOf(a), now);
      const sb = this.score(idOf(b), now);
      if (sa === sb) return fallbackCompare ? fallbackCompare(a, b) : 0;
      return sb - sa;
    });
  }

  /** Drop scoring data for one item. */
  forget(id: string): void {
    const all = this.adapter.read(this.scope);
    delete all[id];
    this.adapter.write(this.scope, all);
  }

  /** Drop all scoring data in this scope. */
  reset(): void {
    this.adapter.write(this.scope, {});
  }
}

// ─── adapters ──────────────────────────────────────────────────────

function makeMemoryAdapter(): HeatRankAdapter {
  const store: Record<string, Record<string, number[]>> = {};
  return {
    read: (scope) => store[scope] ?? {},
    write: (scope, data) => {
      store[scope] = data;
    },
  };
}

/** Persistence adapter backed by dddk Cache (or any sync K/V). */
export function makeCacheAdapter(cache: {
  get(key: string): string | null;
  set(key: string, value: string): void;
}): HeatRankAdapter {
  return {
    read(scope) {
      const raw = cache.get(`heatrank:${scope}`);
      if (!raw) return {};
      try {
        return JSON.parse(raw) as Record<string, number[]>;
      } catch {
        return {};
      }
    },
    write(scope, data) {
      cache.set(`heatrank:${scope}`, JSON.stringify(data));
    },
  };
}
