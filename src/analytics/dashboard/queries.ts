/**
 * Pre-built aggregation queries over an `EventStore`.
 *
 * Each function takes a store + time range and returns a chart-ready
 * shape. Hosts who want a different aggregation just call `store.query`
 * themselves and build their own chart from the raw events.
 *
 * Day buckets: UTC midnight. We deliberately don't try to honor the
 * host's locale here — the dashboard renders both buckets and labels
 * in UTC. Doing local-time bucketing means re-computing on every TZ
 * change which is more code than it saves.
 */

import type { BaseEvent } from '../../ingest/schema';
import type { EventStore } from '../store';

export interface TimeRange {
  from: number;
  to: number;
}

export interface DayBucket {
  /** Unix-epoch ms of the UTC midnight that opens the bucket. */
  x: number;
  /** Aggregated value. */
  y: number;
}

const DAY_MS = 86_400_000;

function utcMidnight(ts: number): number {
  return Math.floor(ts / DAY_MS) * DAY_MS;
}

/** Build an empty day-bucket array covering the full range (inclusive). */
function emptyBuckets(range: TimeRange): DayBucket[] {
  const start = utcMidnight(range.from);
  const end = utcMidnight(range.to);
  const out: DayBucket[] = [];
  for (let d = start; d <= end; d += DAY_MS) out.push({ x: d, y: 0 });
  return out;
}

/** Bucket events by UTC day, optional predicate to filter. */
function bucketByDay(
  events: BaseEvent[],
  range: TimeRange,
  reducer: (acc: number, e: BaseEvent) => number = (acc) => acc + 1,
): DayBucket[] {
  const buckets = emptyBuckets(range);
  if (buckets.length === 0) return buckets;
  const start = buckets[0]!.x;
  for (const ev of events) {
    if (ev.timestamp < range.from || ev.timestamp > range.to) continue;
    const i = (utcMidnight(ev.timestamp) - start) / DAY_MS;
    if (i < 0 || i >= buckets.length) continue;
    const slot = buckets[i]!;
    slot.y = reducer(slot.y, ev);
  }
  return buckets;
}

// ─── 1 · Event volume per day ──────────────────────────────────

/** All events in the range, bucketed per UTC day. */
export async function eventsPerDay(store: EventStore, range: TimeRange): Promise<DayBucket[]> {
  const events = await store.query({ from: range.from, to: range.to, limit: Infinity, order: 'asc' });
  return bucketByDay(events, range);
}

// ─── 2 · Top palette items ─────────────────────────────────────

export interface CountSlice {
  label: string;
  value: number;
}

/**
 * Top N most-activated palette items in the range. Reads `palette_activated`
 * events and groups by `props.itemId` (falling back to `props.id` /
 * `props.command` so we don't drop events from older emit shapes).
 */
export async function topPaletteItems(
  store: EventStore,
  range: TimeRange,
  n = 10,
): Promise<CountSlice[]> {
  const events = await store.query({
    category: 'intent',
    kind: 'palette_activated',
    from: range.from,
    to: range.to,
    limit: Infinity,
  });
  const counts = new Map<string, number>();
  for (const ev of events) {
    const props = ev.props ?? {};
    const id = (props.itemId ?? props.id ?? props.command ?? '(unknown)') as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

// ─── 3 · Agent run completion rate ─────────────────────────────

export interface CompletionRate {
  started: number;
  completed: number;
  stopped: number;
  /** `completed / (completed + stopped)` — runs the agent actually finished. */
  rate: number;
}

export async function agentCompletionRate(store: EventStore, range: TimeRange): Promise<CompletionRate> {
  const events = await store.query({
    category: 'intent',
    kind: ['agent_run_started', 'agent_run_completed', 'agent_run_stopped'],
    from: range.from,
    to: range.to,
    limit: Infinity,
  });
  let started = 0;
  let completed = 0;
  let stopped = 0;
  for (const ev of events) {
    if (ev.kind === 'agent_run_started')   started++;
    if (ev.kind === 'agent_run_completed') completed++;
    if (ev.kind === 'agent_run_stopped')   stopped++;
  }
  const finished = completed + stopped;
  const rate = finished > 0 ? completed / finished : 0;
  return { started, completed, stopped, rate };
}

// ─── 4 · Feedback distribution ─────────────────────────────────

export interface FeedbackDistribution {
  satisfied: number;
  unsatisfied: number;
  /** `satisfied === null` — user pressed Esc, didn't commit either way. */
  skipped: number;
}

export async function feedbackDistribution(store: EventStore, range: TimeRange): Promise<FeedbackDistribution> {
  const events = await store.query({
    category: 'intent',
    kind: 'agent_feedback',
    from: range.from,
    to: range.to,
    limit: Infinity,
  });
  let satisfied = 0;
  let unsatisfied = 0;
  let skipped = 0;
  for (const ev of events) {
    const v = ev.props?.satisfied;
    if (v === true)  satisfied++;
    else if (v === false) unsatisfied++;
    else skipped++;
  }
  return { satisfied, unsatisfied, skipped };
}

// ─── 5 · Voice usage per day ───────────────────────────────────

export async function voiceUsagePerDay(store: EventStore, range: TimeRange): Promise<DayBucket[]> {
  const events = await store.query({
    category: 'intent',
    kind: 'voice_captured',
    from: range.from,
    to: range.to,
    limit: Infinity,
    order: 'asc',
  });
  return bucketByDay(events, range);
}

// ─── 6 · Average LLM latency per day ───────────────────────────

export async function avgLatencyPerDay(store: EventStore, range: TimeRange): Promise<DayBucket[]> {
  const events = await store.query({
    category: 'intent',
    kind: 'agent_llm_call',
    from: range.from,
    to: range.to,
    limit: Infinity,
    order: 'asc',
  });
  // Per-day mean of `props.latencyMs`. We keep a count + sum per bucket
  // and divide once at the end so we don't fight floating-point drift.
  const buckets = emptyBuckets(range);
  const counts = buckets.map(() => 0);
  if (buckets.length === 0) return buckets;
  const start = buckets[0]!.x;
  for (const ev of events) {
    if (ev.timestamp < range.from || ev.timestamp > range.to) continue;
    const latency = ev.props?.latencyMs;
    if (typeof latency !== 'number' || !Number.isFinite(latency)) continue;
    const i = (utcMidnight(ev.timestamp) - start) / DAY_MS;
    if (i < 0 || i >= buckets.length) continue;
    buckets[i]!.y += latency;
    counts[i]! += 1;
  }
  for (let i = 0; i < buckets.length; i++) {
    const slot = buckets[i]!;
    const c = counts[i]!;
    slot.y = c > 0 ? slot.y / c : 0;
  }
  return buckets;
}
