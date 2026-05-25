# proactive

Proactive prompt engine — decides when to ask the user, picks A/B variants via
Thompson sampling, enforces fatigue caps, integrates with dddk's surface system.

## Concept

```
[user behaviour]    ───────►  proactive.tick(ctx)
                                  │
                                  │ evaluate triggers
                                  ▼
                            eligible prompts
                                  │
                                  │ pick highest priority
                                  ▼
                          select variant (Thompson)
                                  │
                                  │ render surface (Space / 2-Space / Esc)
                                  ▼
                              user response
                                  │
                          ┌───────┼───────┐
                          ▼       ▼       ▼
                      fire    write    update
                     analytics  prefs   variant stats
```

## Usage

```typescript
import { createProactive, builtin, createPieceRender } from '@perhapxin/dddk/toolbox/proactive';

const proactive = createProactive({
  storage: 'indexeddb',
  analytics,    // optional — auto-fires proactive.shown / proactive.response
  memory,       // optional — context for triggers
  fatigue: {
    maxPerSession: 3,
    cooldownMs: 60_000,
    dismissPenalty: { sameId: 'session', sameCategory: 5 * 60_000 },
    consecutiveDismissCap: 3,
  },
  identity: () => ({ user_id: currentUser().id }),
  render: createPieceRender({ mount: dddk.mountSurface }),
});
await proactive.init();

proactive.register({
  id: 'budget_filter_after_dwell',
  category: 'recommendation_filter',
  priority: 5,

  triggers: [
    builtin.triggers.dwell({ ms: 30_000 }),
    builtin.triggers.pageMatch({ path: /\/category\// }),
    { id: 'seen_3plus', condition: (ctx) => ctx.memory!.recent({ days: 1 }).length >= 3 },
  ],
  triggerLogic: 'AND',

  surface: { text: '篩到 $300 以下?', yesLabel: '好', noLabel: '不用' },

  onResponse: async (response) => {
    if (response === 'yes') await applyFilter({ max: 300 });
  },

  variants: [
    { id: 'A', surface: { text: '要不要看便宜的?' } },
    { id: 'B', surface: { text: '篩到 $300 以下?' } },
  ],
  variantSelector: 'thompson_sampling',
});

// Host runs this on relevant events (page change, dwell update, scroll, ...)
await proactive.tick({ page: location.pathname, dwellMs: dwellTime });
```

## Built-in triggers

| Trigger | Description |
|---------|-------------|
| `dwell({ ms })`              | Page dwell time threshold |
| `idleTime({ ms })`           | No interaction for N ms |
| `scrollDepth({ percent })`   | Scrolled past N% |
| `pageMatch({ path })`        | URL path matches RegExp or substring |
| `exitIntent()`               | Cursor moving toward close button (host sets `customMeta.exitIntent`) |
| `schedule({ everyN })`       | Every Nth tick |

Host-defined triggers are arbitrary `{ id, condition: (ctx) => boolean | Promise<boolean> }`.

## A/B variant selection

| Selector | Trade-off |
|----------|-----------|
| `random`            | Uniform random. Cleanest A/B but slow to converge. |
| `epsilon_greedy`    | 90% exploit best yes-rate, 10% explore. Simple. |
| `thompson_sampling` | Beta posterior per variant. **Recommended default** — auto-balances explore/exploit. |

Variant stats live in IndexedDB per-user. Host can aggregate via analytics for
global A/B (proactive automatically fires `proactive.shown` and `proactive.response`).

## Fatigue control

4 layers, in order of precedence:
1. `maxPerSession` — hard cap of prompts per session
2. `cooldownMs` — minimum gap between any two prompts
3. `dismissPenalty` — same id / same category suppressed after dismiss
4. `consecutiveDismissCap` — N dismisses in a row → pause for the session

Host can also force-pause: `proactive.pause()` / `proactive.resume()`. Useful for
checkout flows, sensitive forms, etc.

## One-off ask

```typescript
const response = await proactive.ask({
  text: '今天怎麼樣?',
  yesLabel: '不錯',
  noLabel: '普通',
});
```

Bypasses trigger system entirely. Still respects fatigue.

## Surface integration

`createPieceRender({ mount })` produces a render function from any PieceSurface
mount API. The mount function receives a Card with the prompt text and Yes/No/×
buttons bound to Space / double-Space / Escape.

```typescript
const render = createPieceRender({
  mount: async (surface, opts) => {
    return await dddk.mountSurface(surface, opts);
  },
  locale: 'zh-TW',
});
```

## Explain

```typescript
proactive.explain('budget_filter_after_dwell');
// { promptId, lastShownAt, variantStats, fatigue: { sessionShown, ... } }
```
