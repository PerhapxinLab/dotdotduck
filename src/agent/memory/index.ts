/**
 * Memory — long-term recall layer for the agent. Stores verbatim drawers
 * (never summarised) and retrieves them via BM25 over a Unicode-aware
 * universal tokeniser. The agent calls `memory.search(query)` per turn to
 * surface relevant past context.
 *
 * Locale-neutral by design — hosts override `extractFeatures` only when
 * they have a domain-specific tokeniser.
 */
import { extractFeatures as defaultExtract, bm25TermScore } from '../../utils/text/index.js';
import { resolveStorage } from '../../utils/storage/index.js';
import type { StorageAdapter, StorageKind } from '../../utils/storage/types.js';

export type Drawer = {
  id: string;
  text: string;          // verbatim, never summarized
  ts: number;
  wing?: string;
  room?: string;
  meta?: Record<string, unknown>;
};

export type MemoryOpts = {
  customerId: string;
  storage?: StorageKind;
  /**
   * Optional host-supplied tokeniser. Receives the drawer text, returns
   * the feature list used for BM25 recall. Default handles 200+ languages
   * out of the box (no per-locale packs). See `dddk/utils/text`.
   */
  extractFeatures?: (text: string) => string[];
  sync?: {
    bootstrap?: () => Promise<{ drawers: Drawer[] }>;
    pushChange?: (change: { op: 'add' | 'remove'; drawer?: Drawer; id?: string }) => Promise<void>;
  };
};

export type MemorySearchOpts = {
  topK?: number;
  scope?: { wing?: string; room?: string };
  recencyBoost?: boolean;
};

export class Memory {
  private customerId: string;
  private storage: StorageAdapter;
  private drawers = new Map<string, Drawer>();
  private features = new Map<string, string[]>();
  private opened = false;
  private opts: MemoryOpts;
  private extract: (text: string) => string[];

  constructor(opts: MemoryOpts) {
    this.customerId = opts.customerId;
    // Default to 'memory' (session-only). Hosts that want persistence must
    // explicitly opt in to 'indexeddb', or run their own backend sync.
    this.storage = resolveStorage(opts.storage ?? 'memory');
    this.extract = opts.extractFeatures ?? defaultExtract;
    this.opts = opts;
  }

  async init(): Promise<void> {
    await this.storage.open(`dddk-memory-${this.customerId}`);
    this.opened = true;
    const snap = (await this.storage.get('memory:snapshot')) as { drawers: Drawer[] } | undefined;
    if (snap?.drawers) for (const d of snap.drawers) this.indexDrawer(d);
    else if (this.opts.sync?.bootstrap) {
      const fetched = await this.opts.sync.bootstrap();
      for (const d of fetched.drawers) this.indexDrawer(d);
      await this.persist();
    }
  }

  private indexDrawer(d: Drawer): void {
    this.drawers.set(d.id, d);
    this.features.set(d.id, this.extract(d.text));
  }

  wing(name: string): WingScope {
    return new WingScope(this, name);
  }

  async addDrawer(d: Omit<Drawer, 'id'> & { id?: string }): Promise<Drawer> {
    const drawer: Drawer = {
      id: d.id ?? `${d.wing ?? '_'}/${d.room ?? '_'}/${d.ts}/${Math.random().toString(36).slice(2, 8)}`,
      text: d.text,
      ts: d.ts ?? Date.now(),
      wing: d.wing,
      room: d.room,
      meta: d.meta,
    };
    this.indexDrawer(drawer);
    await this.persist();
    if (this.opts.sync?.pushChange) {
      try {
        await this.opts.sync.pushChange({ op: 'add', drawer });
      } catch {
        /* offline */
      }
    }
    return drawer;
  }

  async removeDrawer(id: string): Promise<void> {
    this.drawers.delete(id);
    this.features.delete(id);
    await this.persist();
    if (this.opts.sync?.pushChange) {
      try {
        await this.opts.sync.pushChange({ op: 'remove', id });
      } catch {
        /* offline */
      }
    }
  }

  async search(query: string, opts: MemorySearchOpts = {}): Promise<Drawer[]> {
    const qFeats = this.extract(query);
    const qSet = new Set(qFeats);
    const candidates: Drawer[] = [];
    for (const [id, drawer] of this.drawers) {
      if (opts.scope?.wing && drawer.wing !== opts.scope.wing) continue;
      if (opts.scope?.room && drawer.room !== opts.scope.room) continue;
      const feats = this.features.get(id) ?? [];
      const tf = new Map<string, number>();
      for (const f of feats) if (qSet.has(f)) tf.set(f, (tf.get(f) ?? 0) + 1);
      if (tf.size === 0) continue;
      let s = 0;
      const N = this.drawers.size;
      let avgLen = 0;
      for (const arr of this.features.values()) avgLen += arr.length;
      avgLen = avgLen / Math.max(1, N);
      for (const [f, count] of tf) {
        let df = 0;
        for (const arr of this.features.values()) if (arr.includes(f)) df++;
        s += bm25TermScore(count, df, N, feats.length, avgLen);
      }
      if (opts.recencyBoost !== false) {
        const ageDays = (Date.now() - drawer.ts) / 86_400_000;
        s *= Math.pow(0.5, ageDays / 365); // gentle decay
      }
      candidates.push(drawer);
      (drawer as Drawer & { _score?: number })._score = s;
    }
    candidates.sort((a, b) => ((b as Drawer & { _score?: number })._score ?? 0) - ((a as Drawer & { _score?: number })._score ?? 0));
    return candidates.slice(0, opts.topK ?? 10);
  }

  recent(opts: { wing?: string; room?: string; days?: number; limit?: number } = {}): Drawer[] {
    const cutoff = Date.now() - (opts.days ?? 30) * 86_400_000;
    return [...this.drawers.values()]
      .filter((d) => {
        if (opts.wing && d.wing !== opts.wing) return false;
        if (opts.room && d.room !== opts.room) return false;
        return d.ts >= cutoff;
      })
      .sort((a, b) => b.ts - a.ts)
      .slice(0, opts.limit ?? 50);
  }

  private async persist(): Promise<void> {
    if (!this.opened) return;
    await this.storage.set('memory:snapshot', { drawers: [...this.drawers.values()] });
  }

  async dispose(): Promise<void> {
    if (this.opened) await this.storage.close();
    this.opened = false;
  }
}

class WingScope {
  constructor(private mem: Memory, public name: string) {}
  room(name: string) {
    return new RoomScope(this.mem, this.name, name);
  }
  search(q: string, opts: MemorySearchOpts = {}) {
    return this.mem.search(q, { ...opts, scope: { ...opts.scope, wing: this.name } });
  }
  recent(opts: { days?: number; limit?: number } = {}) {
    return this.mem.recent({ ...opts, wing: this.name });
  }
}
class RoomScope {
  constructor(private mem: Memory, public wing: string, public room: string) {}
  addDrawer(d: { text: string; ts?: number; meta?: Record<string, unknown> }) {
    return this.mem.addDrawer({
      text: d.text,
      ts: d.ts ?? Date.now(),
      meta: d.meta,
      wing: this.wing,
      room: this.room,
    });
  }
  search(q: string, opts: MemorySearchOpts = {}) {
    return this.mem.search(q, { ...opts, scope: { wing: this.wing, room: this.room } });
  }
}

export function createMemory(opts: MemoryOpts): Memory {
  return new Memory(opts);
}
