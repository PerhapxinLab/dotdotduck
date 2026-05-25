/**
 * Cache — synchronous key/value store with LRU eviction.
 *
 * Why sync (not async)? Because the canonical use case is:
 *   const cached = cache.get('user-42');  // render immediately
 *   if (cached) showResult(JSON.parse(cached));
 *   fetchUser(42).then(u => cache.set('user-42', JSON.stringify(u)));  // refresh
 *
 * `useState` / `useMemo` flow needs the value RIGHT NOW, not a microtask later.
 *
 * Storage tiers (configurable):
 *   - 'memory'  — in-process Map. Lost on page reload.
 *   - 'session' — sessionStorage backup. Survives reload, dies on tab close.
 *   - 'local'   — localStorage backup. Survives tab close, dies on clear.
 *
 * The in-memory layer is always present. Lower tier (if set) is read on first
 * touch and written on every set.
 */

export type CacheTier = 'memory' | 'session' | 'local';

export interface CacheOptions {
  /** Logical namespace — prefixes storage keys to avoid collision. */
  namespace?: string;
  /** Max entries in memory. Older entries evicted (LRU). Default 1000. */
  capacity?: number;
  /** Backing store. Default 'memory' only. */
  tier?: CacheTier;
  /** Time-to-live in ms. Default Infinity. Applies to all entries. */
  ttl?: number;
}

interface Entry {
  value: string;
  expiresAt: number;
}

type Listener = (key: string, value: string | null) => void;

export class Cache {
  private mem = new Map<string, Entry>();
  private listeners = new Set<Listener>();
  private namespace: string;
  private capacity: number;
  private tier: CacheTier;
  private ttl: number;
  private backing?: Storage;

  constructor(opts: CacheOptions = {}) {
    this.namespace = opts.namespace ?? 'dddk';
    this.capacity = opts.capacity ?? 1000;
    this.tier = opts.tier ?? 'memory';
    this.ttl = opts.ttl ?? Infinity;
    this.backing = this.resolveBacking(this.tier);
  }

  // ─── public sync API ──────────────────────────────────────────────

  get(key: string): string | null {
    const k = this.fullKey(key);

    // memory first
    const mem = this.mem.get(k);
    if (mem) {
      if (mem.expiresAt < Date.now()) {
        this.delete(key);
        return null;
      }
      // touch (move to most-recent end of insertion order)
      this.mem.delete(k);
      this.mem.set(k, mem);
      return mem.value;
    }

    // fall back to backing
    if (this.backing) {
      const raw = this.backing.getItem(k);
      if (raw == null) return null;
      try {
        const parsed = JSON.parse(raw) as Entry;
        if (parsed.expiresAt < Date.now()) {
          this.backing.removeItem(k);
          return null;
        }
        this.mem.set(k, parsed);
        this.evictIfOverflow();
        return parsed.value;
      } catch {
        return null;
      }
    }

    return null;
  }

  set(key: string, value: string): void {
    const k = this.fullKey(key);
    const entry: Entry = {
      value,
      expiresAt: this.ttl === Infinity ? Number.MAX_SAFE_INTEGER : Date.now() + this.ttl,
    };
    // Refresh insertion order
    this.mem.delete(k);
    this.mem.set(k, entry);
    this.evictIfOverflow();

    if (this.backing) {
      try {
        this.backing.setItem(k, JSON.stringify(entry));
      } catch {
        // Quota — silently ignore. Memory still has it.
      }
    }

    this.notify(key, value);
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): void {
    const k = this.fullKey(key);
    this.mem.delete(k);
    if (this.backing) {
      try {
        this.backing.removeItem(k);
      } catch {
        // ignore
      }
    }
    this.notify(key, null);
  }

  clear(): void {
    const memKeys = Array.from(this.mem.keys());
    this.mem.clear();
    // We also have to wipe backing keys that were already evicted from mem
    // (mem is bounded by `capacity`; backing isn't). Scan ALL keys in the
    // backing store for our namespace prefix and remove them.
    const backingKeys = new Set<string>(memKeys);
    if (this.backing) {
      const prefix = `${this.namespace}:`;
      try {
        for (let i = 0; i < this.backing.length; i++) {
          const k = this.backing.key(i);
          if (k && k.startsWith(prefix)) backingKeys.add(k);
        }
      } catch {
        // ignore: some Storage impls throw on length access in private mode
      }
      for (const k of backingKeys) {
        try {
          this.backing.removeItem(k);
        } catch {
          // ignore
        }
      }
    }
    for (const k of backingKeys) this.notify(this.stripNamespace(k), null);
  }

  size(): number {
    return this.mem.size;
  }

  /** Subscribe to changes. Returns unsubscribe. */
  subscribe(handler: Listener): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  // ─── private ──────────────────────────────────────────────────────

  private fullKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  private stripNamespace(fullKey: string): string {
    const prefix = `${this.namespace}:`;
    return fullKey.startsWith(prefix) ? fullKey.slice(prefix.length) : fullKey;
  }

  private resolveBacking(tier: CacheTier): Storage | undefined {
    if (typeof window === 'undefined') return undefined;
    if (tier === 'session') return window.sessionStorage;
    if (tier === 'local') return window.localStorage;
    return undefined;
  }

  private evictIfOverflow(): void {
    while (this.mem.size > this.capacity) {
      const oldest = this.mem.keys().next().value;
      if (oldest === undefined) break;
      this.mem.delete(oldest);
      if (this.backing) {
        try {
          this.backing.removeItem(oldest);
        } catch {
          // ignore
        }
      }
    }
  }

  private notify(key: string, value: string | null): void {
    for (const h of this.listeners) {
      try {
        h(key, value);
      } catch (err) {
        console.error('[Cache] listener error:', err);
      }
    }
  }
}
