# Toolbox overview

`@perhapxin/dddk/toolbox/*` is a set of zero-LLM, zero-server NLP /
retrieval primitives the host can drop in to build domain features —
**search** and **recommend** — without depending on a backend or a
model. Everything runs in the browser, indexed in memory or IndexedDB,
and each module is designed to plug straight into the host's own
database via a `sync` connector, then keep itself fresh from
dddk-collected telemetry over time.

> Toolbox is still being tuned — the API may move.
>
> Looking for FAQ-style "user types a question, sees the answer"?
> That lives in the palette now: `dddk.palette.addQAItems([...])` adds
> rows whose detail pane auto-expands the answer when the user
> arrow-keys to them. For agent tool use (LLM looks up the answer
> itself), see `dddk.tools.registerQA(...)`.
>
> Looking for agent long-term memory? Use `Memory` from
> `@perhapxin/dddk/agent` — it's the agent's concern, not a toolbox
> module.

## The two modules

| Module | Doc | Solves |
|---|---|---|
| `search`    | [search](./search)       | Site / product search with per-field BM25, pluggable scoring signals, sync-from-DB connector, telemetry-driven re-ranking |
| `recommend` | [recommend](./recommend) | Catalog recommendations (`similarTo` / `forCustomer`), preference-aware re-ranking, pluggable catalog interface |

## Three usage shapes

### A. Direct SDK import — host calls the module directly

```ts
import { createSearch } from '@perhapxin/dddk/toolbox/search';

const search = createSearch({ adapter, scorers, weights, ... });
await search.init();
await search.addDocs(products);
const hits = await search.query('blue shirt', { topK: 10 });
```

Use this when the host needs the result for non-agent UI (a search box,
a recommendation rail, …).

### B. Through `dddk.tools.register*` — the agent uses it as a tool

```ts
dddk.tools.registerSearch({ items: products, toDoc });
dddk.tools.registerQA({ items: faqDataset });   // backed by toolbox/search
```

The LLM sees the registered tools in its tool list and decides on its
own to call them while reasoning. Most demo / consumer-product cases.

### C. Both

A site can register a tool AND use the same module for a manual search
box. The data is the same; the bind point is different.

## Core principles (shared across modules)

- **Library not service** — no server-side dependency.
- **Plug straight into the host DB** — each module takes a `sync`
  config with `bootstrap` (initial pull) plus `subscribe` / `fetchDelta`
  (live changes). The toolbox keeps its in-browser index in step with
  your data without polling at the application layer.
- **Learn from dddk telemetry** — search exposes `learnRankingWeights`
  that ingests click events and updates per-field weights; recommend
  consumes preference signals (`yes` / `no` / `dismiss`) and persists
  them per customer.
- **Pluggable signals** — search / recommend both expose a signal
  pipeline. Built-in BM25 / preference-match / recency-decay /
  saturation are starters. Host writes its own domain signals (return
  rate, completion rate, editor pick, …).
- **Adapter system** — host DB schema is unknown; an adapter maps
  `Row → Doc { id, fields, meta }`.
- **Locale-neutral by default** — a Unicode-aware universal tokeniser
  handles 200+ languages out of the box (whitespace scripts, CJK,
  Thai / Lao / Khmer / Burmese, …). Hosts with a domain tokeniser pass
  their own `extractFeatures(text)` function — no per-language packs
  baked into the SDK.
- **Recommend is catalog-agnostic** — `Recommend` consumes any
  `{ getDoc, allDocs, getFeatures }` shape, not a concrete `Search`
  instance. Host can swap in a vector store / graph backend without
  losing the signal pipeline.
- **No LLM by default** — `onLowConfidence` hook lets host escalate to
  LLM when confidence is low. Adding LLM is opt-in, never required.
- **Explainable** — every module has an `.explain()` method showing
  which signals contributed to which score.

## Pick-a-doc

- New to dddk → start with [search](./search) (most generally
  useful module).
- Suggesting products → [recommend](./recommend).
- FAQ-style UX → use `dddk.palette.addQAItems(...)` in your palette
  setup, no toolbox module needed.
