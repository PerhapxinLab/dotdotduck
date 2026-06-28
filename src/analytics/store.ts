/**
 * Local event store — persistent, queryable, capped.
 *
 * Hosts who install dddk usually want intent data SOMEWHERE: their
 * own backend, dddk-console, a BI warehouse. EventStore is the
 * "self-hosted by default" answer — the SDK keeps a rolling local
 * copy of every event in the end-user's browser (IndexedDB), capped
 * to a sensible default that the host can lift, query, and export to
 * CSV / NDJSON / SQL whenever they want.
 *
 * Storage is per-end-user (IndexedDB is origin-scoped) — not a
 * central DB. There is no per-store quota *we* enforce beyond the
 * browser's; the cap below is a politeness setting so the SDK
 * doesn't silently consume gigabytes of a visitor's quota.
 *
 * Cap policy:
 *   - Default 50,000 events OR 30 days, whichever fires first.
 *   - `onFull: 'ring'` (default) deletes the oldest events to make
 *     room. The data is lost — by design, ring buffers don't keep
 *     history.
 *   - `onFull: 'drop-new'` rejects incoming events instead. Useful
 *     when the host wants to keep early-session events (e.g. for
 *     RL training) and tolerate gaps later.
 *   - `onFull: { notifyHost }` hands the decision to the host. The
 *     callback can drain to backend, clear locally, raise the cap,
 *     or whatever — return value is ignored, just side-effects.
 *
 * Set `cap: { maxEvents: Infinity, maxDays: Infinity }` to disable
 * the cap entirely.
 */

import type { BaseEvent, EventCategory } from '../ingest/schema';
import type { EventSink } from '../ingest/transport';

const STORE = 'events';
const IDX_TS = 'by_timestamp';
const IDX_CAT_KIND = 'by_category_kind';
const IDX_SESSION = 'by_session';
const IDX_VISITOR = 'by_visitor';
const IDX_RUN = 'by_run';

const DEFAULT_DB_NAME = 'dddk-events';
const DEFAULT_MAX_EVENTS = 50_000;
const DEFAULT_MAX_DAYS = 30;

export interface Cap {
  /** Max events to retain. `Infinity` disables the count cap. */
  maxEvents: number;
  /** Max retention in days. `Infinity` disables the age cap. */
  maxDays: number;
}

export interface CapInfo {
  /** Cap values currently in effect. */
  cap: Cap;
  /** Current store size at the moment the cap triggered. */
  current: { events: number; oldestTs: number | null };
  /** The event we were about to write when the cap hit. */
  pendingEvent: BaseEvent;
}

/**
 * Host callback for the `notify-host` policy. The store does NOT auto-
 * evict before calling — the host gets to decide. After the callback
 * resolves, the store does NOT retry the failing write; if the host
 * wants the event kept, they must explicitly do so (e.g. by calling
 * `store.clear()` first to make room, then re-emit). This is the
 * "loud" mode — chosen by hosts that hate silent data loss.
 */
export type NotifyHostHandler = (info: CapInfo) => void | Promise<void>;

export type OnFullPolicy =
  | 'ring'
  | 'drop-new'
  | { notifyHost: NotifyHostHandler };

export interface EventStoreOpts {
  /** IndexedDB database name. Default `'dddk-events'`. Hosts wiring
   *  multiple isolated stores (e.g. one per tenant inside the same
   *  browser) should pass distinct names. */
  dbName?: string;
  /** Retention cap. Both bounds are optional and default to 50k / 30d.
   *  `Infinity` on either disables that bound. */
  cap?: Partial<Cap>;
  /** Behavior when the cap is exceeded. Default `'ring'`. */
  onFull?: OnFullPolicy;
}

export interface EventQuery {
  /** Filter by category. Single value or array (OR). */
  category?: EventCategory | EventCategory[];
  /** Filter by kind. Single value or array (OR). */
  kind?: string | string[];
  /** Timestamp lower bound (inclusive, ms-epoch). */
  from?: number;
  /** Timestamp upper bound (inclusive, ms-epoch). */
  to?: number;
  /** Per-id filters. */
  sessionId?: string;
  visitorId?: string;
  runId?: string;
  /** Pagination. */
  limit?: number;
  offset?: number;
  /** Sort by timestamp. Default `'desc'` (newest first). */
  order?: 'asc' | 'desc';
}

/**
 * One opened EventStore wraps an IndexedDB connection. Hosts open it
 * once and reuse the instance for the page's lifetime. Closing is
 * optional — IndexedDB closes on tab unload automatically — but
 * `close()` exists for hot-reload / test cleanup.
 */
export class EventStore {
  private db: IDBDatabase;
  private cap: Cap;
  private onFull: OnFullPolicy;
  private writeInFlight: Promise<void> = Promise.resolve();

  private constructor(db: IDBDatabase, cap: Cap, onFull: OnFullPolicy) {
    this.db = db;
    this.cap = cap;
    this.onFull = onFull;
  }

  /**
   * Open (creating if needed) the underlying IndexedDB database.
   * Throws if IndexedDB is unavailable (SSR / Node / locked-down
   * iframes). Hosts evaluating dddk in those environments should
   * skip EventStore wiring.
   */
  static async open(opts: EventStoreOpts = {}): Promise<EventStore> {
    if (typeof indexedDB === 'undefined') {
      throw new Error('EventStore.open: IndexedDB unavailable in this environment');
    }
    const dbName = opts.dbName ?? DEFAULT_DB_NAME;
    const cap: Cap = {
      maxEvents: opts.cap?.maxEvents ?? DEFAULT_MAX_EVENTS,
      maxDays:   opts.cap?.maxDays   ?? DEFAULT_MAX_DAYS,
    };
    const onFull: OnFullPolicy = opts.onFull ?? 'ring';

    const db = await openDb(dbName);
    return new EventStore(db, cap, onFull);
  }

  /**
   * Persist one event. Cap policy fires here. Resolves to:
   *   `{ stored: true }`              — written
   *   `{ stored: false, reason: 'full' }`         — cap rejected (drop-new)
   *   `{ stored: false, reason: 'host-rejected' }` — host's notify callback ran,
   *                                                 store didn't auto-evict
   */
  write(event: BaseEvent): Promise<{ stored: boolean; reason?: 'full' | 'host-rejected' }> {
    // Serialize writes so cap math is correct under concurrent emits.
    const prev = this.writeInFlight;
    let resolveOuter!: (v: { stored: boolean; reason?: 'full' | 'host-rejected' }) => void;
    const next = new Promise<void>((res) => {
      prev.finally(async () => {
        try {
          const result = await this.doWrite(event);
          resolveOuter(result);
        } catch (err) {
          resolveOuter({ stored: false, reason: 'full' });
          // Surface the underlying error to the console — silent
          // IndexedDB failures are the classic "events vanished" trap.
          // eslint-disable-next-line no-console
          console.error('[dddk EventStore] write failed:', err);
        } finally {
          res();
        }
      });
    });
    this.writeInFlight = next;
    return new Promise((res) => { resolveOuter = res; });
  }

  private async doWrite(event: BaseEvent): Promise<{ stored: boolean; reason?: 'full' | 'host-rejected' }> {
    // Age cap: evict events older than the cutoff before doing any
    // capacity math. Cheap — uses the timestamp index.
    if (Number.isFinite(this.cap.maxDays)) {
      const cutoff = Date.now() - this.cap.maxDays * 86_400_000;
      await this.evictOlderThan(cutoff);
    }

    // Count cap: would adding this event push us over?
    if (Number.isFinite(this.cap.maxEvents)) {
      const current = await this.countAll();
      if (current + 1 > this.cap.maxEvents) {
        const oldestTs = await this.oldestTimestamp();
        const info: CapInfo = {
          cap: this.cap,
          current: { events: current, oldestTs },
          pendingEvent: event,
        };
        const decision = await this.handleFull(info);
        if (decision === 'reject') {
          return { stored: false, reason: 'host-rejected' };
        }
        if (decision === 'drop') {
          return { stored: false, reason: 'full' };
        }
        // 'ring' — evict oldest until we have room for the new event.
        const need = current + 1 - this.cap.maxEvents;
        await this.evictOldestN(need);
      }
    }

    await this.put(event);
    return { stored: true };
  }

  private async handleFull(info: CapInfo): Promise<'ring' | 'drop' | 'reject'> {
    if (this.onFull === 'ring')     return 'ring';
    if (this.onFull === 'drop-new') return 'drop';
    try {
      await this.onFull.notifyHost(info);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[dddk EventStore] notifyHost threw:', err);
    }
    return 'reject';
  }

  /**
   * Query events. Filters that have a matching IDB index are applied
   * server-side; the rest run as in-memory filters on the retrieved
   * subset. For 50k-cap stores even a full scan is sub-50ms.
   */
  async query(q: EventQuery = {}): Promise<BaseEvent[]> {
    const order = q.order ?? 'desc';
    const tx = this.db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);

    // Pick the most selective index available.
    let source: IDBIndex | IDBObjectStore;
    let range: IDBKeyRange | null = null;
    if (q.sessionId) {
      source = store.index(IDX_SESSION);
      range = IDBKeyRange.only(q.sessionId);
    } else if (q.visitorId) {
      source = store.index(IDX_VISITOR);
      range = IDBKeyRange.only(q.visitorId);
    } else if (q.runId) {
      source = store.index(IDX_RUN);
      range = IDBKeyRange.only(q.runId);
    } else {
      source = store.index(IDX_TS);
      const lo = q.from;
      const hi = q.to;
      if (lo !== undefined && hi !== undefined)      range = IDBKeyRange.bound(lo, hi);
      else if (lo !== undefined)                     range = IDBKeyRange.lowerBound(lo);
      else if (hi !== undefined)                     range = IDBKeyRange.upperBound(hi);
    }

    const categories = q.category ? toSet(q.category) : null;
    const kinds      = q.kind     ? toSet(q.kind)     : null;
    const fromTs = q.from;
    const toTs   = q.to;

    const direction: IDBCursorDirection = order === 'asc' ? 'next' : 'prev';
    const collected: BaseEvent[] = [];
    const skip = q.offset ?? 0;
    const limit = q.limit ?? Infinity;
    let skipped = 0;

    await new Promise<void>((resolve, reject) => {
      const req = source.openCursor(range ?? undefined, direction);
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || collected.length >= limit) { resolve(); return; }
        const ev = cur.value as BaseEvent;
        // In-memory filters not covered by the chosen index.
        if (categories && !categories.has(ev.category))                              { cur.continue(); return; }
        if (kinds && !kinds.has(ev.kind))                                             { cur.continue(); return; }
        if (fromTs !== undefined && ev.timestamp < fromTs)                            { cur.continue(); return; }
        if (toTs   !== undefined && ev.timestamp > toTs)                              { cur.continue(); return; }
        if (skipped < skip) { skipped++; cur.continue(); return; }
        collected.push(ev);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });

    return collected;
  }

  /** Total count of matching events. Filter shape mirrors `query`. */
  async count(q: Pick<EventQuery, 'category' | 'kind' | 'from' | 'to' | 'sessionId' | 'visitorId' | 'runId'> = {}): Promise<number> {
    // Falls back to the same logic as query but counts instead of collecting.
    const evs = await this.query({ ...q, limit: Infinity, offset: 0 });
    return evs.length;
  }

  /** Aggregate stats. Cheap — uses the timestamp index. */
  async size(): Promise<{ events: number; oldestTs: number | null; newestTs: number | null }> {
    const events = await this.countAll();
    if (events === 0) return { events: 0, oldestTs: null, newestTs: null };
    const [oldestTs, newestTs] = await Promise.all([
      this.oldestTimestamp(),
      this.newestTimestamp(),
    ]);
    return { events, oldestTs, newestTs };
  }

  /** Delete every event. Cap settings stay. */
  async clear(): Promise<void> {
    await this.tx('readwrite', (store) => promisify(store.clear()));
  }

  /**
   * Delete a subset. Returns the count of deleted events. Useful for
   * "after I've shipped these to the backend, drop them locally".
   */
  async drop(opts: { olderThanMs?: number; keepLast?: number; matching?: Pick<EventQuery, 'category' | 'kind'> }): Promise<number> {
    let deleted = 0;
    if (opts.olderThanMs !== undefined) {
      const cutoff = Date.now() - opts.olderThanMs;
      deleted += await this.evictOlderThan(cutoff);
    }
    if (opts.keepLast !== undefined) {
      const total = await this.countAll();
      if (total > opts.keepLast) {
        deleted += await this.evictOldestN(total - opts.keepLast);
      }
    }
    if (opts.matching) {
      const matches = await this.query({ ...opts.matching, limit: Infinity, order: 'asc' });
      for (const ev of matches) {
        await this.tx('readwrite', (store) => promisify(store.delete(ev.id)));
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Return an `EventSink` view of this store so it can plug straight
   * into `Transport`:
   *
   * ```ts
   * const transport = new Transport({
   *   sinks: [new HttpSink(...), eventStore.sink()],
   * });
   * ```
   *
   * Errors at write time are swallowed (logged) — the transport's
   * other sinks shouldn't fail just because the local store hit a
   * quota or was rejected by `onFull: 'drop-new'`.
   */
  sink(): EventSink {
    return {
      send: async (batch: BaseEvent[]) => {
        for (const ev of batch) {
          await this.write(ev);
        }
      },
    };
  }

  /** Close the IDB connection. Optional; called automatically on tab unload. */
  close(): void {
    this.db.close();
  }

  // ─── internals ──────────────────────────────────────────────

  private async tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const tx = this.db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    // `req.success` resolves when an op succeeded but BEFORE the tx
    // is committed. Subsequent reads on a fresh tx race against the
    // commit. Wait for `tx.oncomplete` so writes are durable before
    // the helper returns.
    const result = await fn(store);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'));
    });
    return result;
  }

  private async put(event: BaseEvent): Promise<void> {
    await this.tx('readwrite', (store) => promisify(store.put(event)));
  }

  private async countAll(): Promise<number> {
    return this.tx('readonly', (store) => promisify(store.count()));
  }

  private async oldestTimestamp(): Promise<number | null> {
    return this.tx('readonly', async (store) => {
      const idx = store.index(IDX_TS);
      const cur = await openCursor(idx, null, 'next');
      return cur ? (cur.value as BaseEvent).timestamp : null;
    });
  }

  private async newestTimestamp(): Promise<number | null> {
    return this.tx('readonly', async (store) => {
      const idx = store.index(IDX_TS);
      const cur = await openCursor(idx, null, 'prev');
      return cur ? (cur.value as BaseEvent).timestamp : null;
    });
  }

  private async evictOlderThan(cutoff: number): Promise<number> {
    let evicted = 0;
    await this.tx('readwrite', async (store) => {
      const idx = store.index(IDX_TS);
      const range = IDBKeyRange.upperBound(cutoff, true);
      await iterateCursor(idx, range, 'next', (cur) => {
        cur.delete();
        evicted++;
      });
    });
    return evicted;
  }

  private async evictOldestN(n: number): Promise<number> {
    if (n <= 0) return 0;
    let evicted = 0;
    await this.tx('readwrite', async (store) => {
      const idx = store.index(IDX_TS);
      await iterateCursor(idx, null, 'next', (cur) => {
        if (evicted >= n) return 'stop';
        cur.delete();
        evicted++;
        return undefined;
      });
    });
    return evicted;
  }
}

// ─── IDB helpers ──────────────────────────────────────────────

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) return;
      const store = db.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex(IDX_TS,       'timestamp');
      store.createIndex(IDX_CAT_KIND, ['category', 'kind']);
      store.createIndex(IDX_SESSION,  'sessionId');
      store.createIndex(IDX_VISITOR,  'visitorId');
      store.createIndex(IDX_RUN,      'runId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openCursor(
  source: IDBIndex | IDBObjectStore,
  range: IDBKeyRange | null,
  direction: IDBCursorDirection,
): Promise<IDBCursorWithValue | null> {
  return new Promise((resolve, reject) => {
    const req = source.openCursor(range ?? undefined, direction);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function iterateCursor(
  source: IDBIndex | IDBObjectStore,
  range: IDBKeyRange | null,
  direction: IDBCursorDirection,
  onEach: (cur: IDBCursorWithValue) => 'stop' | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = source.openCursor(range ?? undefined, direction);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) { resolve(); return; }
      const sig = onEach(cur);
      if (sig === 'stop') { resolve(); return; }
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

function toSet<T extends string>(v: T | T[]): Set<T> {
  return new Set(Array.isArray(v) ? v : [v]);
}
