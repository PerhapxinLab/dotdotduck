# Memory

Two coexisting memory systems for the agent. Pick the one that matches your shape:

| System | When | Storage |
|---|---|---|
| **Memory v1** — 3-tier hybrid (core / episodic / semantic) | You want the agent to remember user profile + past sessions + retrievable facts automatically across runs | `localStorage` by default; semantic tier is host-wired |
| **DrawerMemory** — verbatim drawer store + BM25 | You want a queryable note store the host explicitly writes into | `memory` (default) / `localStorage` / `indexeddb` |

Both opt-in. Default `new DotDotDuck({})` has no memory active.

## Memory v1

Three tiers, each independently opt-in.

```ts
import { DotDotDuck } from '@perhapxin/dddk';

const dddk = new DotDotDuck({
  memory: {
    core: {
      schema: { language: 'string', tone: 'string', recent_pages: 'array' },
      storage: 'localStorage',
      maxBytes: 2048,
    },
    episodic: {
      enabled: true,
      maxEntries: 50,
      replayTopK: 3,
      relevance: 'recency', // or 'keyword'
    },
    semantic: {
      provider: myVectorProvider, // host wires
      writeMode: 'explicit',
    },
    privacy: {
      requireConsent: true,
      retentionDays: 90,
      excludePatterns: [/myCustomPattern/],
    },
  },
});
```

### Tier 1 — core

Structured user profile. Always-in-context. Hard byte cap. Schema enforces field shapes:

```ts
dddk.memory.core?.set('language', 'zh-TW');
dddk.memory.core?.set('tone', 'concise');
dddk.memory.core?.get('language'); // 'zh-TW'
```

Renders as `# About this user` system-prompt block on every run.

### Tier 2 — episodic

Ring buffer of past session summaries:

```ts
// Host calls when a session ends — usually after agent_run_completed
dddk.memory.endSession({
  summary: 'Helped user navigate commercial tier comparison',
  taskSummary: 'Explain commercial license tiers',
  turnCount: 4,
});
```

Renders as `# Past relevant sessions` system-prompt block. `relevance: 'recency'` takes last N; `'keyword'` does token overlap against the new query.

### Tier 3 — semantic

Host implements `MemoryProvider`:

```ts
interface MemoryProvider {
  remember(entry: Omit<SemanticMemoryEntry, 'id' | 'timestamp'>): Promise<string>;
  recall(query: string, opts?: { topK?: number; tags?: string[] }): Promise<SemanticMemoryEntry[]>;
  forget(id: string): Promise<void>;
  list?(opts?: { tags?: string[]; limit?: number }): Promise<SemanticMemoryEntry[]>;
}
```

dddk calls `recall(userQuery, { topK: 5 })` on every run start. Returned entries render as `# Recalled facts` system-prompt block.

dddk does NOT embed, does NOT persist — the provider owns infra.

### Privacy

| Field | Effect |
|---|---|
| `requireConsent: true` | First-write triggers a host consent hook |
| `retentionDays` | Episodic entries past this age are dropped on read |
| `excludePatterns` | Regex set; matching text is dropped before write. Defaults block credit-card / API-key / private-key shapes |

### Auto-injection

When any tier is attached, `dddk.startAgent(task)` automatically runs `memory.buildContext(task)` and prepends the result to the task. No manual wiring needed.

## DrawerMemory

The verbatim note store (renamed from `Memory` in 0.1.0).

```ts
import { DrawerMemory, createDrawerMemory } from '@perhapxin/dddk/agent';

const memory = new DrawerMemory({
  storage: 'memory',         // 'memory' (default) / 'localStorage' / 'indexeddb'
  customerId: 'cust_4823',
});

memory.addDrawer({ text: 'user said: my item is broken', ts: Date.now() });
memory.addDrawer({ wing: 'orders', room: 'ORD-1002', text: 'order ORD-1002 → $990 charged on 2026-05-20', ts: Date.now() });

const recent = await memory.recent({ limit: 20 });
const hits   = await memory.search('broken', { topK: 5 });
```

### wing / room scope

Drawers tag with optional `wing` (major category) + `room` (sub-category). Search can scope:

```ts
await memory.search('refund', { scope: { wing: 'orders' } });
await memory.wing('orders').room('ORD-1002').search('paid');
```

### Not a webagent tool by design

DrawerMemory is for host code — a skill, a sidebar, a debug panel that wants to query session state. It is NOT exposed as a tool the LLM can call. Long-term facts that the LLM should see go via Memory v1 (semantic tier).

## When to use which

- "Agent should know user prefers Chinese" → **Memory v1 core**
- "Agent should remember what we talked about last week" → **Memory v1 episodic** + **semantic** if you have vector recall
- "I want to log customer service notes the agent can search later" → **DrawerMemory** (host code drives the writes)
- "I want a typed key-value session state for skills" → use SDK preferences, not memory

## Coexistence

Both can be active in the same `DotDotDuck` instance — `dddk.memory` is the 3-tier instance, `new DrawerMemory(...)` lives wherever the host wants it.

## Backwards compatibility

The old `Memory` / `createMemory` exports still resolve as aliases for `DrawerMemory` / `createDrawerMemory`. They will log a deprecation warning in 0.2.
