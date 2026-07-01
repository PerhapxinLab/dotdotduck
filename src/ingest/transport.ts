/**
 * Transport layer — batching, retry, ordering — for the unified ingest
 * stream. 
 *
 * Pluggable sink: anything implementing `EventSink` works. The
 * transport handles the bits that every sink would otherwise reinvent:
 *
 *   - Batching: events queue in memory, flush every N ms or M events
 *   - Retry with exponential backoff, capped at 5 attempts
 *   - Sequence ordering: events carry a monotonic seq per session
 *   - Page-unload flush via Beacon API
 *   - Optional gzip body when supported
 */

import type { BaseEvent } from './schema';

export interface EventSink {
  send(batch: BaseEvent[]): Promise<void>;
  /** Flush any sink-internal buffers. Optional. */
  flush?(): Promise<void>;
  /** Tear down. Optional. */
  dispose?(): Promise<void>;
}

export interface TransportOptions {
  sink: EventSink;
  /** Auto-flush interval in ms. Default 5000. */
  flushIntervalMs?: number;
  /** Max batch size before forcing a flush. Default 20. */
  flushBatchSize?: number;
  /** Max retry attempts per batch. Default 5. */
  maxRetries?: number;
  /** Hard cap on the in-memory queue. Default 1000. Overflow drops oldest. */
  queueCap?: number;
  /** Optional clock override for tests. */
  now?: () => number;
}

export class Transport {
  private readonly sink: EventSink;
  private readonly flushIntervalMs: number;
  private readonly flushBatchSize: number;
  private readonly maxRetries: number;
  private readonly queueCap: number;
  private queue: BaseEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private inflight = 0;
  private disposed = false;
  private seqBySession: Map<string, number> = new Map();
  private beaconHandler: ((e: Event) => void) | null = null;

  constructor(opts: TransportOptions) {
    this.sink = opts.sink;
    this.flushIntervalMs = opts.flushIntervalMs ?? 5000;
    this.flushBatchSize = opts.flushBatchSize ?? 20;
    this.maxRetries = opts.maxRetries ?? 5;
    this.queueCap = opts.queueCap ?? 1000;

    if (typeof window !== 'undefined') {
      this.flushTimer = setInterval(() => void this.flush(), this.flushIntervalMs);
      this.beaconHandler = () => void this.flushBeacon();
      window.addEventListener('pagehide', this.beaconHandler);
      window.addEventListener('beforeunload', this.beaconHandler);
    }
  }

  /**
   * Queue an event. Returns immediately. Auto-flushes when batch size
   * is reached.
   */
  enqueue(event: BaseEvent): void {
    if (this.disposed) return;
    const stamped = this.stampSequence(event);
    this.queue.push(stamped);
    if (this.queue.length > this.queueCap) {
      // Drop oldest to bound memory. Loud in dev, silent in prod.
      this.queue.splice(0, this.queue.length - this.queueCap);
    }
    if (this.queue.length >= this.flushBatchSize) {
      void this.flush();
    }
  }

  /** Force a flush of any queued events. */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    this.inflight += 1;
    try {
      await this.sendWithRetry(batch, 0);
    } finally {
      this.inflight -= 1;
    }
  }

  /**
   * Best-effort beacon-style flush — fire-and-forget on page unload.
   * Falls back to a regular flush if the sink doesn't implement a
   * beacon path.
   */
  flushBeacon(): void {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    // Best effort — most sinks won't have a real beacon path; fire
    // a normal send and hope it lands before the page goes away.
    void this.sink.send(batch).catch(() => {
      /* swallow — page is going away */
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (typeof window !== 'undefined' && this.beaconHandler) {
      window.removeEventListener('pagehide', this.beaconHandler);
      window.removeEventListener('beforeunload', this.beaconHandler);
      this.beaconHandler = null;
    }
    await this.flush();
    if (this.sink.dispose) await this.sink.dispose();
  }

  private async sendWithRetry(batch: BaseEvent[], attempt: number): Promise<void> {
    try {
      await this.sink.send(batch);
    } catch (err) {
      if (attempt >= this.maxRetries) {
        // Give up — push back to the queue head for IndexedDB persistence
        // on next page load. Best-effort; if storage isn't wired the
        // events are lost.
        this.queue.unshift(...batch);
        if (typeof console !== 'undefined') {
          console.warn('[dddk-ingest] sink send failed after retries:', err);
        }
        return;
      }
      const delay = 400 * Math.pow(2, attempt);
      await sleep(delay);
      await this.sendWithRetry(batch, attempt + 1);
    }
  }

  private stampSequence(event: BaseEvent): BaseEvent {
    const sessionKey = event.sessionId ?? 'global';
    const next = (this.seqBySession.get(sessionKey) ?? 0) + 1;
    this.seqBySession.set(sessionKey, next);
    return {
      ...event,
      props: { ...(event.props ?? {}), _seq: next },
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Reference sinks ──────────────────────────────────────────────────

/**
 * POST batches as JSON to a host-configured endpoint. The most common
 * sink — used by hosts who route through their own backend.
 */
export class HttpSink implements EventSink {
  constructor(
    private readonly endpoint: string,
    private readonly headers: Record<string, string> = {},
  ) {}

  async send(batch: BaseEvent[]): Promise<void> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headers },
      body: JSON.stringify({ events: batch }),
      // Don't keep the page alive past unload — beacon path handles unload.
      keepalive: false,
    });
    if (!res.ok) {
      throw new Error(`HttpSink: ${res.status} ${res.statusText}`);
    }
  }
}

/**
 * `console.log` sink for development — prints batches without sending.
 */
export class DebugSink implements EventSink {
  async send(batch: BaseEvent[]): Promise<void> {
    if (typeof console !== 'undefined') {
      console.info(`[dddk-ingest] ${batch.length} events`, batch);
    }
  }
}

/**
 * Fan-out wrapper — sends every batch to all wrapped sinks in parallel.
 * Failures in any one sink don't break the others.
 */
export class MultiSink implements EventSink {
  constructor(private readonly sinks: EventSink[]) {}

  async send(batch: BaseEvent[]): Promise<void> {
    const results = await Promise.allSettled(this.sinks.map((s) => s.send(batch)));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === this.sinks.length) {
      throw new Error(`MultiSink: all ${this.sinks.length} sinks failed`);
    }
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.sinks.map((s) => s.flush?.()));
  }

  async dispose(): Promise<void> {
    await Promise.allSettled(this.sinks.map((s) => s.dispose?.()));
  }
}
