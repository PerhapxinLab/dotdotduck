# Analytics

Anonymous event collector. Track signals fire-and-forget; they're
batched in memory (optionally mirrored to IndexedDB for offline),
flushed on a timer / size threshold, and POSTed as JSON to an
endpoint the host controls.

## Quick start

```ts
import { createAnalytics } from '@perhapxin/dddk/modules/analytics';

const analytics = createAnalytics({
  endpoint: '/api/dddk/events',
  identity: () => ({
    session_id,           // generated + persisted by host
    visitor_id,
    locale: 'zh-TW',
    device: 'desktop',
  }),
  batchSize: 20,
  flushIntervalMs: 5000,
});
await analytics.init();

analytics.track('session.start');
analytics.track('page.view', { path: location.pathname });
analytics.track('voice.result', { status: 'attempt' });
```

The endpoint receives an array of `AnalyticsEvent`:

```json
[
  {
    "ts": 1716543210000,
    "event": "page.view",
    "session_id": "...",
    "visitor_id": "...",
    "locale": "zh-TW",
    "device": "desktop",
    "payload": { "path": "/commercial" }
  }
]
```

## API

- `createAnalytics({ endpoint, identity, batchSize, flushIntervalMs, offlineBuffer, transport })`
- `await analytics.init()` — start the flush timer, drain any offline buffer
- `analytics.track(event, payload?, { identity? }?)`
- `analytics.identify(values)` — merge persistent identity fields into every subsequent event
- `analytics.reset()` — clear persistent identity (e.g. on logout)
- `await analytics.flush()` — force-flush the buffer
- `await analytics.dispose()` — stop timer, final flush, close storage

## Options

| Option | Default | Purpose |
|---|---|---|
| `endpoint` | — | POST URL. Receives a JSON array of events. |
| `identity` | — | `() => Record<string, unknown>` — called per event for dynamic fields. |
| `batchSize` | `20` | Flush as soon as buffer hits this many events. |
| `flushIntervalMs` | `5000` | Timer-driven flush cadence. |
| `offlineBuffer` | — | `'indexeddb'` to mirror events; drained on next `init()`. |
| `transport` | — | Replace fetch with your own `(events) => Promise<void>`. Takes precedence over `endpoint`. |

## The `identity` callback

Identity fields are merged into EVERY event at fire time. Two
mechanisms:

| Source | When |
|---|---|
| `identity()` option | Called per event. Use for values that can change mid-session (locale, device). |
| `analytics.identify({ ... })` | Sticky. Use after login when a stable user id appears. |
| `track(event, payload, { identity })` | Per-call override. |

Merge order (later wins): `staticIdentity` → `identity()` → per-call
override. The host owns id generation and persistence — the toolbox
deliberately doesn't fingerprint:

```ts
function uuid(): string {
  if (crypto?.randomUUID) return crypto.randomUUID();
  /* fallback ... */
}
const visitor_id = localStorage.getItem('app:visitor_id')
  ?? (localStorage.setItem('app:visitor_id', uuid()), localStorage.getItem('app:visitor_id')!);
const session_id = sessionStorage.getItem('app:session_id')
  ?? (sessionStorage.setItem('app:session_id', uuid()), sessionStorage.getItem('app:session_id')!);
```

## Event shape

```ts
type AnalyticsEvent = {
  ts: number;                              // ms epoch, set at track() call
  event: string;                           // dotted name, e.g. 'page.view'
  payload?: Record<string, unknown>;       // call-site payload
} & Record<string, unknown>;               // identity fields merged in
```

`track` signature:

```ts
analytics.track('voice.result', { status: 'error', via: 'network' });
```

Convention: keep `payload` to small primitives — strings (ids,
status codes), numbers (durations, counts), booleans. Anything
free-form gets sanitized by the host before track (see below).

## Connecting dddk intents

dddk emits typed `IntentEvent`s (`palette_activated`, `agent_asked`,
`agent_answered`, `voice_captured`, `selection_used`, `skill_*`,
`agent_feedback`, `agent_mode_changed`, `agent_tool_failed`, …).
Sanitize each one before tracking — content fields (questions, answers,
transcripts, selection text) should NOT leave the device:

```ts
import { intentToTrack } from '$lib/analytics-sanitize';

dddk.on('intent', (i) => {
  const safe = intentToTrack(i);
  if (safe) analytics.track(safe.event, safe.payload as Record<string, unknown>);
});
```

## `agent_feedback` — the labelled training signal

When the host sets `webAgent.onLoopEnd: { kind: 'feedback', text: ... }`, the
end-of-loop closure asks the visitor to mark the run satisfied or not. The
gesture (Space = yes, double-tap = no) becomes an `agent_feedback` IntentEvent:

```ts
{ kind: 'agent_feedback'
  runId?: string         // ties back to the agent_run_started this run came from
  skillId?: string       // set when a skill triggered the run
  satisfied: boolean | null  // true / false from gestures; null from ask_user picker
  summary: string        // closure text or the picked option value
  timestamp: number
}
```

Why this matters more than clickstream:

- **Labelled.** Every row carries an explicit yes / no — no inferring intent from
  scroll depth or page dwell.
- **Joinable.** `runId` and `skillId` let you slice by which skill or run
  produced the rating, so a regression after a prompt change shows up as a
  yes-rate drop in that one skill row instead of a noise floor across
  everything.
- **RL-ready.** The pair (state at run start, satisfied) is exactly the input
  shape a reward model needs. Pipe it into an offline trainer; you don't need to
  manually label anything.

The bundled dashboard renders `agent_feedback` as the hero satisfaction section
(`/dashboard`): headline yes-rate, per-day stacked bars, per-skill yes-rate
table with a `low_confidence` flag once samples drop under 30. The same rows
are in the CSV / JSON export so an external pipeline can consume them as-is.

`intentToTrack` whitelists per-kind: it keeps `itemId`, `via`,
`status`, `response`, lengths, counts; it drops `question`, `answer`,
`text`, `selectionText`. The pattern matters more than the exact
sanitizer — your domain may have different sensitive fields.

A typical event map:

| dddk intent | Tracked event | Payload kept |
|---|---|---|
| `palette_activated` | `intent.palette_activated` | `item_id`, `size_chars`, `attachments_count` |
| `agent_asked` | `intent.agent_asked` | (none — question text dropped) |
| `agent_answered` | `intent.agent_answered` | `via`, `size_chars`, `latency_ms` (ms from ask → answer) |
| `agent_llm_call` | `intent.agent_llm_call` | `item_id` (= runId), `variant_id` (= role), `via` (= model), `ttft_ms`, `duration_ms`, `output_tokens` |
| `voice_captured` | `intent.voice_captured` | `size_chars` |
| `confirm_action` | `intent.confirm_action` | `item_id` (= action name), `status` (`approved` / `rejected`) |
| `skill_started` / `skill_finished` | `intent.skill_*` | `item_id` |
| `agent_run_started` | `intent.agent_run_started` | `item_id` (= runId), `size_chars` (= task length) |
| `agent_run_completed` | `intent.agent_run_completed` | `item_id` (= runId), `size_chars` (= turn count) |
| `agent_run_stopped` | `intent.agent_run_stopped` | `item_id` (= runId), `status` (`close` / `esc` / `reject` / `palette` / `voice`) |
| `agent_pause_decision` | `intent.agent_pause_decision` | `item_id` (= runId), `status` (`continue` / `stop`) |
| `agent_feedback` | `intent.agent_feedback` | `response` (`yes` / `no` / `dismiss`), `size_chars` |

### Per-run reconstruction via `runId`

Agent-run intents (`started` / `completed` / `stopped` / `pause_decision`) all carry the same `runId` in `item_id`. Group by it on the dashboard to reconstruct one user query end-to-end — every `agent_answered`, `confirm_action`, `agent_pause_decision` that fired between `agent_run_started` and `agent_run_(completed|stopped)` belongs to that run.

## Exporting a single run as JSON

The orchestrator buffers every intent emitted during the current agent run alongside the session log. After a run ends, call `dddk.exportAgentRun()` to get a single JSON object:

```ts
dddk.on('agent_final', () => {
  const run = dddk.exportAgentRun();
  if (!run) return;
  // run.runId, run.sessionId, run.session.turns, run.intents, run.exportedAt
  void fetch('/api/my-runs', { method: 'POST', body: JSON.stringify(run) });
});
```

Useful for shipping a complete query record (memory + per-turn tool calls + user decisions) to a host-side DB or dashboard without joining two streams. `session` is a deep clone so later turns don't mutate the export.

[Proactive](../proactive/overview.md) wires itself in via the `analytics`
option and emits `proactive.shown` / `proactive.response` for free.

## Lifecycle hooks

Flush before the page unloads — the timer may not fire in time on
hard refresh:

```ts
window.addEventListener('beforeunload', () => { void analytics.flush(); });
```

If a flush fails (network error, 5xx, offline), the batch is
re-queued at the front of the buffer for the next attempt. With
`offlineBuffer: 'indexeddb'`, events also persist to IndexedDB and
drain on the next `init()` — survives tab close.

## Privacy

The toolbox itself stores no PII and never enriches identity. What
goes out is entirely what the host puts in:

- `identity()` is YOUR code — don't return emails / phone / IP.
- `payload` is YOUR code — sanitize before `track`. Use the
  intent-to-track whitelist pattern above.
- The endpoint is YOUR server — apply schema validation there too
  (the dddk-frontend reference whitelists columns at the D1
  ingestion endpoint as a second line of defense).

If a regulator asks "what does this collect" the answer is "exactly
what the host writes in `identity()` and `payload` — read those
two functions". Keep them short.

## Transport override

For non-HTTP transports (Beacon, Worker postMessage, native bridge):

```ts
const analytics = createAnalytics({
  identity: () => ({ session_id, visitor_id }),
  transport: async (events) => {
    navigator.sendBeacon('/api/dddk/events', new Blob(
      [JSON.stringify(events)],
      { type: 'application/json' },
    ));
  },
});
```

`transport` takes precedence over `endpoint` — set one or the other.

## Through the webagent

Analytics is NOT exposed as an LLM tool. Telemetry is a side-effect
of host code (page navigation, dddk intents, proactive responses)
— not something the agent decides to do. Pass the analytics instance
to other toolbox modules (`createProactive({ analytics })`) so they
auto-track their own lifecycle.
