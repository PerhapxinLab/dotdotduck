import type { EpisodicEntry, EpisodicMemoryConfig } from './types';

const KEY = 'dddk:memory:episodic';

type StorageKind = NonNullable<EpisodicMemoryConfig['storage']>;

function pickStorage(kind: StorageKind | undefined): Storage | null {
  if (typeof window === 'undefined') return null;
  if (kind === 'sessionStorage') return window.sessionStorage;
  if (kind === 'memory') return null;
  return window.localStorage;
}

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[\s\p{P}]+/u).filter((t) => t.length > 1));
}

function overlapScore(query: Set<string>, doc: Set<string>): number {
  let hit = 0;
  for (const t of query) if (doc.has(t)) hit++;
  return hit / Math.max(1, query.size);
}

/** Tier 2 — ring buffer of past session summaries. */
export class EpisodicMemory {
  private entries: EpisodicEntry[] = [];
  private maxEntries: number;
  private replayTopK: number;
  private relevance: 'recency' | 'keyword';
  private storage: Storage | null;
  private retentionDays: number;

  constructor(cfg: EpisodicMemoryConfig = {}, retentionDays = 90) {
    this.maxEntries = cfg.maxEntries ?? 50;
    this.replayTopK = cfg.replayTopK ?? 3;
    this.relevance = cfg.relevance ?? 'recency';
    this.storage = pickStorage(cfg.storage);
    this.retentionDays = retentionDays;
    this.load();
    this.pruneExpired();
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(KEY);
      if (raw) this.entries = JSON.parse(raw) as EpisodicEntry[];
    } catch { /* corrupt blob */ }
  }

  private persist(): void {
    if (!this.storage) return;
    try { this.storage.setItem(KEY, JSON.stringify(this.entries)); } catch { /* quota */ }
  }

  private pruneExpired(): void {
    if (this.retentionDays <= 0) return;
    const cutoff = Date.now() - this.retentionDays * 86_400_000;
    const next = this.entries.filter((e) => e.timestamp >= cutoff);
    if (next.length !== this.entries.length) {
      this.entries = next;
      this.persist();
    }
  }

  add(entry: Omit<EpisodicEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: number }): EpisodicEntry {
    const e: EpisodicEntry = {
      id: entry.id ?? `ep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      summary: entry.summary,
      tags: entry.tags,
      timestamp: entry.timestamp ?? Date.now(),
      turnCount: entry.turnCount,
      taskSummary: entry.taskSummary,
    };
    this.entries.push(e);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    this.persist();
    return e;
  }

  list(): EpisodicEntry[] {
    return this.entries.slice();
  }

  remove(id: string): void {
    const next = this.entries.filter((e) => e.id !== id);
    if (next.length !== this.entries.length) {
      this.entries = next;
      this.persist();
    }
  }

  topK(query: string | null, k: number): EpisodicEntry[] {
    const limit = Math.min(k, this.entries.length);
    if (limit === 0) return [];
    if (this.relevance === 'recency' || !query) {
      return this.entries.slice(-limit).reverse();
    }
    const qTokens = tokenize(query);
    return this.entries
      .map((e) => ({
        entry: e,
        score: overlapScore(qTokens, tokenize(e.summary + ' ' + (e.taskSummary ?? ''))),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.entry);
  }

  clear(): void {
    this.entries = [];
    if (this.storage) {
      try { this.storage.removeItem(KEY); } catch { /* ignore */ }
    }
  }

  /** Render as a system-prompt block. Empty string when no replays. */
  toPromptBlock(query?: string | null): string {
    const picks = this.topK(query ?? null, this.replayTopK);
    if (picks.length === 0) return '';
    const lines = ['# Past relevant sessions'];
    for (const e of picks) lines.push(`- ${e.summary}`);
    return lines.join('\n');
  }
}
