# Memory

Session-only conversation memory. Stores recent turns / observations
the host wants to feed back into the LLM for context. Reload wipes it
(by design) — long-term persistence is the host's responsibility.

## Why session-only

The toolbox draws a hard line:

| Layer | Where it lives | Who owns it |
|---|---|---|
| Static catalog / FAQ | build-time JSON → browser memory | host (build pipeline) |
| Conversation context | toolbox `memory` (this module) | toolbox |
| Long-term customer state | host's own backend DB | host |

If your user has a profile, refund history, account preferences — that
belongs in YOUR backend. Inject it per-turn via `WebAgentConfig
.contextProvider`, NOT via this module.

## Quick start

```ts
import { createMemory } from '@perhapxin/dddk/agent';

const memory = createMemory({
  storage: 'memory',         // 'memory' (default) or 'indexeddb' for tab-survival
  customerId: 'cust_4823',
});

memory.addDrawer({ text: 'user said: my item is broken', ts: Date.now() });
memory.addRoom({  text: 'shipped to apartment 4A, Tainan', ts: Date.now() });
memory.addWing({  text: 'order ORD-1002 → $990 charged on 2026-05-20', ts: Date.now() });

const recent = await memory.recent({ limit: 20 });
const hits   = await memory.search('broken', { limit: 5 });
```

## Three storage shapes

Memory exposes three named buckets — wings / rooms / drawers — to
let the host distinguish:

| Bucket | Intent | Example |
|---|---|---|
| `drawer` | Short-term active mention | "user just said X" |
| `room`   | Within-session context | "they're on the checkout page" |
| `wing`   | Verbatim factual snapshot | "order ORD-1002, total $990, paid Visa" |

All three are queryable; the naming just helps debugging.

## Host-managed persistence pattern

```ts
// On session start — restore facts from your backend:
const session = createMemory();
const facts = await myBackend.getLongTermFacts(customerId);
for (const f of facts) session.addWing({ text: f.text, ts: f.ts });

// On session end — promote important entries up to your backend:
panelSkill.onLeave = async () => {
  const drawers = await session.recent({ limit: 100 });
  for (const d of drawers) {
    if (await isImportant(d)) {
      await myBackend.insertLongTermMemory({ customerId, fact: d.text, ts: d.ts });
    }
  }
};
```

The toolbox doesn't decide what's "important" — that's domain
knowledge only the host has.

## NOT a webagent tool (by design)

Unlike `qa` / `search` / `classify` / `recommend`, this module is NOT
exposed via a `dddk.tools.registerMemory()` builder.

The reason: the LLM should not need to "call" memory. Recent
conversation turns should be in the system prompt already (via
`contextProvider` or message history). Long-term facts about the
customer also go through `contextProvider`. Adding a memory tool
would just be a confusing extra hop.

The `memory` module is for HOST code (a skill, a sidebar, a debug
panel) that wants to query session-state.

## API

- `createMemory({ storage, customerId })`
- `memory.addDrawer({ text, ts, meta? })`
- `memory.addRoom({ text, ts, meta? })`
- `memory.addWing({ text, ts, meta? })`
- `await memory.recent({ limit, bucket?, since? })`
- `await memory.search(query, { limit, bucket? })`
- `memory.clear({ bucket? })`
