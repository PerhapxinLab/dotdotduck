# memory

Conversation memory with Wings / Rooms / Drawers namespacing. Verbatim storage,
BM25 retrieval, sync hooks.

## Concept

```
Palace (per customer)
├── Wing            (person / project / topic)
│   ├── Room        (day / session / sub-topic)
│   │   ├── Drawer  (one verbatim text chunk, never summarised)
│   │   └── Drawer
│   └── Room
└── Wing
```

## Why verbatim

Summarisation loses information. Hierarchy + indexing handles capacity.

If you remember verbatim that the user said "my wife is allergic to peanuts" three
months ago, you can recommend snacks that exclude peanuts forever. Summaries forget
this detail by week two.

## Usage

```typescript
import { createMemory } from '@perhapxin/dddk/toolbox/memory';

const memory = createMemory({
  customerId: 'cust_4823',
  storage: 'indexeddb',
  sync: {
    bootstrap:  async () => fetch(`/api/dddk/memory/cust_4823`).then(r => r.json()),
    pushChange: async (c) => fetch('/api/dddk/memory/log', { method: 'POST', body: JSON.stringify(c) }),
  },
});
await memory.init();

// Add (either via scope or direct)
memory.wing('alice').room('2026-04-12').addDrawer({
  text: '我老婆對花生過敏,推薦零食不要選花生口味',
});

// Search (global or scoped)
const all     = await memory.search('過敏');
const wingOnly = await memory.wing('alice').search('過敏');

// Recent
const recent = memory.wing('alice').recent({ days: 30 });
```

## Search semantics

Same BM25 as `search` module, scoped by wing/room. Includes mild recency boost
(`halfLife = 365 days`) so older facts are still retrievable but newer ones rank
slightly higher.

## Session-only by default

The default `storage: 'memory'` makes memory **session-only** — drawers are
cleared when the page reloads. This is intentional:

- Host owns long-term persistence (their CRM / customer DB / GDPR-compliant store)
- Toolbox provides session context for the current interaction
- `contextProvider` hook on chat / webagent skills pulls relevant facts from
  the host's persistent store at each turn

If a host wants browser-local persistent memory, they can opt in:

```typescript
const memory = createMemory({
  customerId: 'cust_4823',
  storage: 'indexeddb',        // explicit opt-in for cross-session
  sync: {
    bootstrap:  async () => fetch('/api/dddk/memory').then(r => r.json()),
    pushChange: async (c) => fetch('/api/dddk/memory', { method:'POST', body: JSON.stringify(c) }),
  },
});
```

But the recommended pattern is: keep toolbox memory session-only, store
persistent facts in host backend, inject via context provider.
