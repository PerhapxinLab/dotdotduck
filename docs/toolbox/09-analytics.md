# analytics

Browser-side event collector with host identity passthrough, batching, retry,
and offline IndexedDB buffer.

## Usage

```typescript
import { createAnalytics } from '@perhapxin/dddk/toolbox/analytics';

const analytics = createAnalytics({
  endpoint: '/api/dddk/events',

  // Identity callback runs at every track() — merged into payload.
  identity: () => ({
    user_id:     currentUser()?.id,
    customer_id: currentCustomer()?.id,
    org_id:      currentOrg()?.id,
    session_id:  currentSession()?.id,
  }),

  batchSize: 20,
  flushIntervalMs: 5000,
  offlineBuffer: 'indexeddb',
});
await analytics.init();

// Free-form
analytics.track('search.query', { query: 'shirt', latency_ms: 4 });

// Static identity (until reset())
analytics.identify({ user_id: 'u_42', plan: 'pro' });

// Per-event identity override
analytics.track('user.merge', { from, to }, { identity: { user_id: 'admin_1' } });

// On logout
analytics.reset();
```

## Identity is host's domain

The toolbox doesn't define or enforce identity fields. Whatever your CRM /
authentication layer uses (`user_id`, `customer_id`, `org_id`, `tenant_id`,
`session_id`...) — pass it. Server side, you do the joins.

## Custom transport

If you don't want HTTP (e.g., posting via Worker binding, or piping to Segment):

```typescript
const analytics = createAnalytics({
  transport: async (events) => {
    await segment.batch({ events });
  },
  identity: () => ({ user_id: ... }),
});
```

`endpoint` is only used when `transport` is not provided.

## Offline buffer

Events accumulated while offline are persisted to IndexedDB and drained on next `init()`.

## Server reference impl

See [`examples/cf-worker-analytics/`](../../examples/cf-worker-analytics/) — a complete
Cloudflare Worker with D1 schema, daily aggregation cron, and metric query endpoints.
Deploy with `wrangler deploy`.
