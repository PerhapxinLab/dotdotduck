# Tools registry — expose capabilities to the agent

> `ToolsRegistry` registers host capabilities (QA, search, classify, recommend, custom domain ops) as webagent tools. The LLM decides when to call them — **not** the user picking from a palette.

## Mental model

```
user natural-language input
  ↓
WebAgent (reasoning)
  ↓ "I should check the FAQ first"
  ↓
agent.callAction('qa_lookup', { question: 'How do I return an item?' })
  ↓
ToolsRegistry → your handler → result back to the agent
  ↓
agent uses the result to continue / answer
```

Exposing QA / search / recommend as standalone palette surfaces is fine — that's the "user actively picks a tool" world. The tools registry is the other path: **host provides capability, the agent decides when to use it.** Both can coexist.

## API overview

```ts
import { ToolsRegistry } from '@perhapxin/dddk';
import type { ToolSpec, RegisterQAOpts, QAToolItem } from '@perhapxin/dddk';

class ToolsRegistry {
  // Low level: full ActionDefinition + optional label
  register(spec: ToolSpec): void;
  unregister(id: string): boolean;
  list(): ToolSpec[];

  // High-level helpers
  registerQA(opts: RegisterQAOpts): void;
  registerSearch<TRow>(opts: RegisterSearchOpts<TRow>): void;
  registerClassifier(opts: RegisterClassifierOpts): void;
  registerRecommend<TRow>(opts: RegisterRecommendOpts<TRow>): void;

  // Used internally by the orchestrator — host rarely touches these
  attachAgent(agent: WebAgent): void;
  detachAgent(): void;
  snapshot(): ActionDefinition[];
}
```

The `ToolsRegistry` instance is owned by the `DotDotDuck` orchestrator. Hosts access it via `dddk.tools.*`.

## Getting the registry from `dddk.tools`

```ts
import { DotDotDuck } from '@perhapxin/dddk';

const dddk = new DotDotDuck({ /* ... */ });

dddk.tools.registerQA({ items: [/* ... */] });
dddk.tools.register({ name: 'create_ticket', /* ... */ });
```

## High-level helper 1: `registerQA`

The most common case — the host has an FAQ and wants the agent to consult it on its own.

```ts
dddk.tools.registerQA({
  items: [
    { id: 'refund',  question: 'How do I return an item?', answer: 'Go to Account Center within 7 days...', category: 'order' },
    { id: 'ship',    question: 'When will it ship?',       answer: 'Same-day on business days...',          category: 'order' },
    { id: 'privacy', question: 'Do you sell my data?',     answer: 'No. Full privacy policy at...',         category: 'privacy' },
  ],
  topK: 3,
});
```

The agent automatically gains a tool called `qa_lookup`. When the user asks "I'd like a return," the agent will:

1. Reason "I should check the FAQ first."
2. Call `qa_lookup({ question: 'I would like a return' })`.
3. Receive the top 3 matched FAQ entries (with confidence / score).
4. Use the results to draft a reply.

| Option | Default | Notes |
| --- | --- | --- |
| `id` | `'qa_lookup'` | Tool name; letters / digits / underscore. |
| `items` | — | FAQ entries (multilingual supported; auto-detected). |
| `description` | Default text saying "company knowledge base" | Override to tell the agent which domain your FAQ covers. |
| `topK` | 3 | How many entries to return. |

## High-level helper 2: `registerSearch`

Full-text search over any catalog (products, articles, records):

```ts
type Product = { sku: string; title: string; body: string; price: number };

dddk.tools.registerSearch<Product>({
  items: allProducts,
  toDoc: (p) => ({
    id: p.sku,
    fields: { title: p.title, body: p.body },
    meta: { price: p.price },
  }),
  fieldWeights: { title: 3.0, body: 1.0 },
  topK: 5,
});
```

The agent sees `search_catalog({ query: string })` returning `{ hits: [{ id, fields, meta, score }] }`. BM25 per-field scoring weighs `title` 3× over `body`.

## High-level helper 3: `registerClassifier`

A Naive Bayes text classifier — give the agent a routing / tagging tool:

```ts
dddk.tools.registerClassifier({
  samples: [
    { text: 'My credit card was double-charged', label: 'billing' },
    { text: "The refund hasn't arrived yet",     label: 'billing' },
    { text: 'The app keeps crashing',            label: 'bug' },
    { text: 'How do I change my password?',      label: 'account' },
  ],
  topK: 3,
});
```

The agent sees `classify_text({ text: string })` → `{ predictions: [{ label, score }] }`. Multilingual training data can be mixed; internally it prefixes language to avoid cross-language contamination.

## High-level helper 4: `registerRecommend`

Registers three tools at once: `recommend_for_customer`, `recommend_similar`, `record_preference`.

```ts
dddk.tools.registerRecommend<Product>({
  items: allProducts,
  toDoc: (p) => ({
    id: p.sku,
    fields: { title: p.title, body: p.body },
    meta: { price: p.price },
  }),
  customerId: currentUser.id,
  topK: 5,
});
```

- `recommend_for_customer()` — personalised top-K based on the customer's accumulated preferences.
- `recommend_similar({ productId })` — find similar products.
- `record_preference({ productId, response: 'yes' | 'no' | 'dismiss' })` — feed user ♥ / ✕ back into the recommender.

When the agent receives a user reaction it calls `record_preference` automatically; next recommendation reflects it.

## Low level: `register({...ActionDefinition})`

For custom tools the helpers don't cover, use a raw `ActionDefinition`:

```ts
dddk.tools.register({
  name: 'create_ticket',
  label: 'Create support ticket',
  description: 'Open a new ticket in the support system. Use when the user describes an unresolved issue that the FAQ does not cover.',
  parameters: {
    type: 'object',
    properties: {
      title:    { type: 'string',  description: 'One-line summary of the issue' },
      priority: { type: 'string',  enum: ['low', 'normal', 'high'] },
      body:     { type: 'string',  description: 'Full description' },
    },
    required: ['title', 'body'],
  },
  handler: async (params) => {
    const { title, priority, body } = params as { title: string; priority?: string; body: string };
    try {
      const ticket = await fetch('/api/tickets', {
        method: 'POST',
        body: JSON.stringify({ title, priority: priority ?? 'normal', body }),
      }).then((r) => r.json());
      return { ok: true, data: { id: ticket.id, url: `/tickets/${ticket.id}` } };
    } catch (err) {
      return { ok: false, reason: 'unknown', message: (err as Error).message };
    }
  },
});
```

| ActionDefinition field | Notes |
| --- | --- |
| `name` | Must match `^[a-z][a-z0-9_]*$`. Re-registering an existing name throws. |
| `description` | The agent reads this to decide when to call the tool. Writing this well matters more than anything else. |
| `parameters` | JSON Schema. The agent uses this to produce arguments. |
| `handler` | `(params) => Promise<ActionResult<unknown>>`. Return `{ ok: true, data }` or `{ ok: false, reason, message }`. |

## Live vs build-time registration

Both timings work:

```ts
// Build-time: register before the DotDotDuck constructor.
//   When the orchestrator builds the WebAgent it snapshot()s and injects them once.
dddk.tools.register({ /* ... */ });
const dddk = new DotDotDuck({ /* ... */ });

// Live: agent is already running; register triggers attachAgent → registerAction.
//   Visible on the agent's next turn.
dddk.tools.register({ /* ... */ });
```

`attachAgent(agent)` is called internally by the orchestrator; it replays every registered tool into the live agent. Order doesn't matter.

## Unregister + list

```ts
dddk.tools.unregister('qa_lookup');     // true if removed
dddk.tools.list();                       // ToolSpec[]
```

Caveat: WebAgent does **not** support runtime un-register. `unregister` removes the tool from the registry, but the already-attached agent still remembers it until the agent is rebuilt. Practical guidance: lock down the tool set at boot; don't pull tools at runtime.

## Tools vs palette skill — when to pick which

| Want | Tools registry | Palette skill |
| --- | --- | --- |
| User says one sentence, LLM decides whether to look something up | ✓ | |
| User explicitly opens a specific tool | | ✓ |
| Multiple independent capabilities composing (FAQ + search + ticket) | ✓ | |
| Needs persistent UI (chat, browse) | | ✓ (PanelSkill) |
| Result is "an answer / structured data" returned to the agent | ✓ | |
| Result is "render a form for the user" | | ✓ (SurfaceSkill) |

The two can coexist — the same FAQ can power `registerQA` (so the agent can consult it) AND a PanelSkill (so the user can browse it directly).

## See also

- [SurfaceSkill / PanelSkill](../skills/overview.md) — the user-triggered path.
- [Evals](./evals.md) — test that the agent calls your tools correctly.
- WebAgent `ActionDefinition` — JSON Schema details live in the webagent docs.
