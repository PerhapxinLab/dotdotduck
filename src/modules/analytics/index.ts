import { resolveStorage } from '../../utils/storage/index.js';
import type { StorageAdapter, StorageKind } from '../../utils/storage/types.js';
import type { IdentityProvider } from '../../toolbox/common/types.js';

export type AnalyticsEvent = {
  ts: number;
  event: string;
  payload?: Record<string, unknown>;
} & Record<string, unknown>; // identity keys merged at fire time

export type AnalyticsOpts = {
  endpoint?: string;
  identity?: IdentityProvider;
  batchSize?: number;
  flushIntervalMs?: number;
  offlineBuffer?: StorageKind;
  transport?: (events: AnalyticsEvent[]) => Promise<void>;
};

export class Analytics {
  private endpoint?: string;
  private identity?: IdentityProvider;
  private batchSize: number;
  private flushIntervalMs: number;
  private buffer: AnalyticsEvent[] = [];
  private storage?: StorageAdapter;
  private staticIdentity: Record<string, unknown> = {};
  private flushTimer?: ReturnType<typeof setInterval>;
  private transport?: (events: AnalyticsEvent[]) => Promise<void>;

  constructor(opts: AnalyticsOpts) {
    this.endpoint = opts.endpoint;
    this.identity = opts.identity;
    this.batchSize = opts.batchSize ?? 20;
    this.flushIntervalMs = opts.flushIntervalMs ?? 5000;
    this.transport = opts.transport;
    if (opts.offlineBuffer) this.storage = resolveStorage(opts.offlineBuffer);
  }

  async init(): Promise<void> {
    if (this.storage) {
      await this.storage.open('dddk-analytics');
      // Drain any offline buffer
      const queued: AnalyticsEvent[] = [];
      for await (const [_, v] of this.storage.iterate('event:')) queued.push(v as AnalyticsEvent);
      if (queued.length > 0) {
        this.buffer.push(...queued);
        await this.flush();
      }
    }
    this.flushTimer = setInterval(() => this.flush().catch(() => {}), this.flushIntervalMs);
  }

  identify(values: Record<string, unknown>): void {
    this.staticIdentity = { ...this.staticIdentity, ...values };
  }

  reset(): void {
    this.staticIdentity = {};
  }

  track(event: string, payload?: Record<string, unknown>, overrides?: { identity?: Record<string, unknown> }): void {
    const dyn = this.identity?.() ?? {};
    const ts = Date.now();
    const storageKey = `event:${ts}-${Math.random().toString(36).slice(2, 6)}`;
    const e: AnalyticsEvent = {
      ts,
      event,
      ...this.staticIdentity,
      ...dyn,
      ...(overrides?.identity ?? {}),
      payload,
      _storageKey: storageKey,
    };
    this.buffer.push(e);
    if (this.storage) {
      void this.storage.set(storageKey, e);
    }
    if (this.buffer.length >= this.batchSize) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      if (this.transport) {
        await this.transport(batch);
      } else if (this.endpoint) {
        await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(batch),
        });
      }
      if (this.storage) {
        for (const e of batch) {
          const key = (e as AnalyticsEvent)._storageKey;
          if (typeof key === 'string') void this.storage.delete(key);
        }
      }
    } catch {
      this.buffer.unshift(...batch);
    }
  }

  async dispose(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
    if (this.storage) await this.storage.close();
  }
}

export function createAnalytics(opts: AnalyticsOpts): Analytics {
  return new Analytics(opts);
}
