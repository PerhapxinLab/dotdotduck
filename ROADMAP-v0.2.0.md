# dddk v0.2.0 — roadmap

Status: **planning**. Nothing shipped. v0.1.2 is the current published release.

## Why 0.2.0 (not 0.1.x patches)

Most items below are structural — public-API additions, new adapter
interfaces, prompt-level changes to the agent loop, new bundled skills.
Patch releases (0.1.x) stay limited to bug fixes and copy. The whole
batch ships together as 0.2.0 once verified end-to-end against the
demo site.

## How to read this doc

Each item lists **current state**, **problem**, **proposal**. Items
are grouped by theme, not by priority. Priority + sequencing decided
separately before implementation.

This doc grows as more is decided. New items land here, not a future
roadmap.

---

## 1 · Foundation polish

Items inherited from the v0.1.x review — small structural fixes that
don't change product behavior but clean up the surface.

### 1.1 Memory: unify v1 + DrawerMemory into one subsystem

**Current**: two parallel systems shipped — `Memory v1` (3-tier hybrid
core / episodic / semantic with PII filter, retention, consent) and
`DrawerMemory` (legacy BM25 store). Users don't know which to use.

**Problem**: cognitive load on every host integrating dddk. Docs side
them next to each other, but their use cases differ entirely.

**Proposal**: collapse into **one `Memory` system** with pluggable
storage backends and tier strategies:

```
Memory
  ├── tiers: { core, episodic, semantic }   ← always present
  ├── storage: MemoryStorage                ← pluggable (in-memory / BM25 / vector / server)
  └── policy: { piiFilter, retention, consent }
```

`DrawerMemory` becomes a storage backend (`bm25` strategy) inside the
unified Memory. Migration: hosts using legacy DrawerMemory drop one
line, Memory inherits the BM25 store. Docs collapse to one section.

### 1.2 Action category grouping in the prompt catalog

**Current**: 14 built-in actions + host-registered actions all listed
flat in the tool catalog given to the LLM. Adding 20 custom actions
makes the prompt page grow with no structure.

**Problem**: LLM picks slower and worse from a flat list as it grows.
Past 30-40 tools the agent starts misrouting between similar names
(e.g. `find_customer` vs `find_order`).

**Proposal**: introduce action **categories** declared at registration:

```ts
dddk.tools.register({
  name: 'find_product',
  category: 'data',                       // ← new field
  description: '...',
  ...
});
```

Built-in categories: `navigation` / `input` / `visual` / `dialog` /
`data` / `presentation`. Catalog rendered grouped, with category
headers in the system prompt. LLM scoping improves at scale.

### 1.3 SDK i18n stub strings

**Current**: SDK ships hardcoded EN defaults for module-level UI labels
(e.g. `'Listening — release to send'`, `'Voice input not supported'`).
Hosts must override all of them to get zh-TW or any other locale.

**Problem**: minimal locales hosts pay the same override cost as full
i18n hosts. Default EN strings sometimes get shipped to zh-TW users by
accident when the override is missed.

**Proposal**: ship a thin SDK i18n table keyed by locale, used as
fallback when host doesn't supply its own. The host's own i18n
infrastructure still overrides; we just stop forcing every host to
re-translate `'Listening'`.

Scope: voice module labels, subtitle confirmation hints, generic error
copy. NOT: agent persona / sitemap / brand / proactive prompts — those
stay host-owned.

### 1.4 `wait` action: configurable cap

**Current**: hardcoded `maximum: 5000` ms in [actions.ts](src/agent/webagent/actions.ts).

**Problem**: 5s is too short for any server-side async task (PDF
export, report generation, batched email send). Agent stalls.

**Proposal**: per-call `maxWaitMs` config on `WebAgentConfig`. Runtime
default stays 5s for safety; hosts whose backend operates on a longer
timeline bump it explicitly. Higher caps gated behind a `confirmLong`
gesture so the agent can't silently camp on a 5-minute wait.

### 1.5 `disableBuiltinActions` semantics rename

**Current**: name implies "the action is gone". But for `pause`,
disabling the tool only stops the LLM from explicitly calling it —
the **runtime auto-pause after every narrate** still fires.

**Problem**: hosts pass `disableBuiltinActions: ['pause']` expecting
no pauses at all. Confusion + bug reports.

**Proposal**: split into two clearly named fields:

- `excludeTools: string[]` — LLM never sees these in the catalog.
- `disableAutoPauseAfterNarrate: boolean` — kills the runtime-level pause.

Old name kept as alias for one minor version with a console warn,
then removed in 0.3.

### 1.6 Action / tool registration race documentation

**Current**: hosts call `dddk.tools.register(...)` while an agent run
is mid-flight. New tools take effect on the *next* turn, by design
(in-flight turn uses the snapshot from when it started).

**Problem**: undocumented. Hosts hit it once, debug for 30 min.

**Proposal**: document in [agent overview docs](dddk/docs/v0.1.1/dddk/agent/overview.md).
Optional: expose `dddk.tools.flush()` to await mid-flight completion
so the very next turn picks up.

### 1.7 `/docs/latest/` redirect route

**Current**: README and external links hardcode `/docs/v0.1.1/...`.
Each version bump requires editing every URL.

**Proposal**: add `/docs/latest/...` redirect route in dddk-frontend
that resolves to `BUNDLED_VERSION` at runtime. README + external
references switch to `latest/`. Versioned URLs stay valid for
permalinks.

### 1.8 Proactive empty-registry skip

**Status**: done (working tree, not deployed). Tick early-returns when
0 prompts registered.

### 1.9 Multi-vendor + self-hosted LLM adapters

**Current**: SDK ships `OpenAIProvider`, `GoogleProvider`, `ProxyProvider`.
Any OpenAI-compatible vendor (DeepSeek, Qwen, OpenRouter, Groq, Together,
vLLM, llama.cpp server, LM Studio, Ollama) works via `OpenAIProvider`
with a custom `baseURL`. Non-compatible vendors (Anthropic, Cohere,
Bedrock, Vertex, Azure OpenAI) currently have no first-party adapter.

**Problem**: enterprise hosts running on AWS Bedrock / Google Vertex
/ Azure OpenAI either have to write their own adapter or route through
their own proxy. Self-hosted hosts (Ollama / vLLM in their VPC) have
no recipe to follow.

**Proposal**:
- ship `AnthropicProvider` (Claude 4.x messages API)
- ship `BedrockProvider` (AWS SDK wrapper, IAM-auth)
- ship `VertexProvider` (Google Vertex AI, ADC-auth)
- ship `AzureOpenAIProvider` (deployment-name routing)
- add a self-hosted recipe page: Ollama, vLLM, LM Studio, llama.cpp
  with concrete `baseURL` + headers config

All slot into the same `LLMRouter` 4-axis interface — host swaps
provider per role without changing agent code.

---

## 2 · Workflow capabilities

Items addressing real-world flows the agent currently can't handle
(or handles poorly).

### 2.1 Popup window support

**Current**: agent operates within the main tab's DOM. `window.open()`
spawns a popup the agent doesn't see.

**Problem**: OAuth login, social login, "open in new tab" links — all
break the loop.

**Proposal**: detect `window.open` from agent-driven click, hold the
main loop, listen for popup close, read result (URL params, postMessage,
or window.name handoff per host). Resume main loop with result.

Scope: same-origin popups + standard OAuth `postMessage` callback
pattern. Cross-origin opaque popups → emit `popup_unobservable` event,
agent hands off to user.

### 2.2 Same-origin iframe support

**Current**: agent's DOM index ignores iframes. `[id]` references are
main-document only.

**Proposal**: walk same-origin iframes into the same id-map. Cross-origin
iframes stay opaque (sandboxed by browser). Element resolution via
selectors works across iframe boundaries when same-origin.

### 2.3 Cross-origin failure mode

**Current**: agent might attempt to operate cross-origin content and
silently fail.

**Proposal**: explicit `out_of_scope` action result with reason
`'cross_origin'`. Agent narrates the boundary to the user, offers to
hand off, doesn't crash the loop.

### 2.4 Built-in form widget adapters

**Current**: `fill_input` works for plain `<input>` / `<textarea>`.
Custom React combobox / date picker / file upload / rich text editor
needs a host-written custom action.

**Problem**: every host writing the same wrappers for the same widgets.

**Proposal**: ship adapter strategies for the common framework patterns:

- `react-aria` (Adobe RAC)
- `headless-ui` (Tailwind Labs)
- `radix-ui` primitives
- `tiptap` / `lexical` / `prosemirror` rich-text
- `react-datepicker` family
- `react-dropzone` style file upload

Hosts opt in via `formAdapters: ['react-aria', 'tiptap']` in
`WebAgentConfig`. `fill_input` runtime tries matching adapters in
order before falling back to the plain input strategy.

### 2.5 Form validation read-back

**Current**: agent submits a form, server returns 422 with field
errors rendered inline. Agent only sees errors next turn after DOM
re-read; sometimes never connects them to the submitted action.

**Proposal**: after submit-class actions, runtime scans for
`[aria-invalid="true"]`, `[data-error]`, `.error`, `.invalid-feedback`,
or matching ARIA descendant patterns, attaches errors to the action
result so the next turn sees them in `action_results` immediately.

### 2.6 Multi-step transaction skill pattern

**Current**: cart → checkout → payment → confirmation — agent
navigates each step linearly. Any failure leaves state dangling.

**Proposal**: new skill type `TransactionSkill`:

```ts
{
  id: 'checkout',
  type: 'transaction',
  steps: [
    { id: 'cart_review', action, onFailure: 'rollback' },
    { id: 'address',      action, onFailure: 'rollback' },
    { id: 'payment',      action, onFailure: 'abort' },     // no rollback
    { id: 'confirm',      action, onFailure: 'ignore' },
  ],
  rollback: [
    { id: 'address',      action: clearAddress },
    { id: 'cart_review',  action: clearCart },
  ],
}
```

Runtime walks forward step by step; on failure walks the rollback
chain backwards from the last successful step.

### 2.7 Long-running task polling

**Current**: `wait` capped + no async-task pattern.

**Proposal**: new action `poll({ checkActionId, intervalMs, timeoutMs })`.
Host registers a `check_action` returning `{ ready: boolean, data? }`.
Runtime polls until ready / timeout. Loop continues processing other
work while polling (background promise).

### 2.8 Login-required signal

**Current**: agent navigates into a 401-redirect; ends up on the
login page operating it as if it were the target page.

**Proposal**: two signals:

- DOM attribute `data-dddk-auth-required` on protected routes — agent
  recognises before navigation
- Backend 401/403 response detection on `fetch_external` calls

Runtime emits `auth_required` intent. Host wires the recovery — login
modal, redirect, hold-and-resume etc.

---

## 3 · New tools

Generic-purpose tool additions and new SDK building blocks.

### 3.1 Generic action additions

- `fetch_external(allowlisted_url, params)` — server-proxied fetch,
  host-allowlist enforced
- `search(adapter_id, query)` — generic search hook, host wires the
  backend (Algolia, vector store, internal DB)
- `summarize_page()` — LLM-only, no DOM walk; uses the current dump
- `extract_structured_data(schema)` — DOM → JSON via host schema
- `track_intent(kind, payload)` — explicit intent emit for the stream
- `escalate_to_human(reason, context)` — standard handoff tool

### 3.2 Surface templates

PieceSurface trees the SDK ships, host renders without writing UI:

- `ProductCardSurface` — image / price / specs / CTA
- `ComparisonSurface` — multi-product side-by-side table
- `ProcedureSurface` — numbered steps with per-step state (done /
  stuck / not-yet), Space-to-advance
- `TimelineSurface` — chronological event chain (order tracking,
  repair progress)
- `ChecklistSurface` — to-do list with checkbox state

### 3.3 Adapter interfaces

Host-implemented contracts, SDK orchestrates against them:

```ts
interface EcommerceAdapter {
  findProducts(query): Promise<ProductCard[]>;
  getProduct(id): Promise<ProductDetail>;
  compareProducts(ids): Promise<ProductComparison>;
  currentPromotions(productIds?): Promise<Promo[]>;
  addToCart(id, qty): Promise<CartState>;
  viewCart(): Promise<CartState>;
  checkInventory(id): Promise<InventoryState>;
}

interface FeatureIndex {
  search(intent: string): Promise<FeatureEntry[]>;
  get(id: string): Promise<FeatureEntry>;
}

interface ManualAdapter {
  search(question: string): Promise<ManualChunk[]>;
  getProcedure(id: string): Promise<Procedure>;
}

interface CustomerProfile {
  recall(userId, key): Promise<unknown>;
  remember(userId, key, value): Promise<void>;
}
```

---

## 4 · Host-experience layer

Items that make adoption faster for application owners (the people
buying this product).

### 4.1 Structured sitemap

**Current**: sitemap is a free-text blob hosts paste into the system
prompt. Token-bound; deep hierarchies don't fit.

**Proposal**: schema-typed sitemap:

```ts
sitemap: {
  routes: Array<{
    path: string;
    semantics: string;
    entities?: string[];
    parents?: string[];
    requires?: { auth?: boolean; role?: string };
  }>;
}
```

Runtime auto-builds the prompt block, prunes irrelevant subtrees by
intent (paired with FeatureIndex search in 3.3).

### 4.2 Action description cookbook

**Current**: hosts write action descriptions; quality varies.
Bad descriptions silently degrade agent quality.

**Proposal**: docs page with positive / negative examples, a description
linter (yes/no checks: "does it say WHEN to call?", "does it say WHAT
args?", "does it say WHAT it returns?"), and bundled high-quality
descriptions for the built-in actions as reference.

### 4.3 Persistent cross-session memory backend

**Current**: Memory v1 is in-session only.

**Proposal**: server-side memory backend interface; host implements
storage. SDK provides Redis / Postgres adapter examples.

Use case: user returns next week, agent remembers what they were
working on, surfaces resume.

### 4.4 PII boundaries — stronger contract

**Current**: `dddk-skip` class hides element from DOM dump.

**Proposal**:
- `data-dddk-pii="high"` — element visible to agent but any action
  on it triggers extra confirm
- `data-dddk-pii="redact"` — element value redacted in the DOM dump
  the LLM sees, even if visually present
- Audit log entry for every action touching a `pii` element

### 4.5 Budget guard

**Current**: no per-user / per-org LLM cost ceiling.

**Proposal**: middleware in the LLM router; host configures budget
per identity. Once exceeded, agent falls back to handoff or
denial-of-service-style refuse.

### 4.6 A/B testing prompts

**Current**: hosts swap prompts manually; no measurement framework.

**Proposal**: bundle a tiny experiment system — host registers variants,
SDK picks one per session (sticky by `visitor_id`), variant id flows
through intent stream so the host's BI sees which won.

### 4.7 Escalate-to-human handoff

**Current**: no standard tool / event.

**Proposal**: ship `escalate_to_human(reason, context)` action +
`agent_escalated` intent + docs for wiring into Intercom / Crisp /
host's own live-chat.

### 4.8 No-code skill builder

**Current**: skills are TypeScript objects. Non-developers (PMs,
support leads, content writers) can't author skills without engineer
help.

**Problem**: every product update that needs a tour / procedure /
proactive prompt change blocks on a developer.

**Proposal**: ship a separate companion route inside the dddk-frontend
demo (and as an embeddable surface in host apps) — a visual builder
that lets non-devs assemble Script skills, edit prompts, and configure
proactive triggers without writing code. Output: a JSON config the
runtime consumes alongside code-authored skills.

Scope kept small: Script + Prompt skill types only. Action / Surface /
Panel skills still require code.

---

## 5 · Vertical adapters

The three high-value vertical patterns. Each ships as: an Adapter
interface, one or more SurfaceTemplates, a bundled Skill that
orchestrates the flow.

### 5.1 Ecommerce shopping plan

**Use case**: "I want to buy a laptop — help me with price / quality /
brand / promo / event analysis, plan the best purchase, suggest related
items."

**Components**:
- `EcommerceAdapter` (interface, host implements against their catalog API)
- `ProductCardSurface`, `ComparisonSurface` (SDK ships)
- `shoppingPlanSkill` (SDK ships):
  1. `findProducts(criteria)`
  2. `compareProducts(top N)`
  3. `currentPromotions(applicable)`
  4. `present_surface(ComparisonSurface)`
  5. `ask_user_choice("which one to cart?")`
  6. `addToCart(...)`
  7. `findProducts(crossSellRelatedTo)` ← cross-sell beat

**Host integration cost target**: ~5 adapter methods wired to
backend, no UI work, no skill writing.

### 5.2 FeatureIndex + find_feature for large SaaS

**Use case**: "Help me set up custom email signatures for my team" —
on a SaaS with 200+ settings pages 5 levels deep.

**Components**:
- `FeatureIndex` (interface, host implements)
- Builder tool that takes a route table → semi-auto-generates the
  FeatureIndex
- `find_feature(intent)` tool (SDK ships)
- `findFeatureSkill` (SDK ships) — navigates to the feature, narrates
  the prerequisites, walks the user to the right control

**Host integration cost target**: registry config for each feature
(path + semantics + keywords + prerequisites). 200 features = 200
lines of config.

### 5.3 Manual / procedure walkthrough

**Use case**: "My printer won't connect to WiFi" — RAG over the
support corpus + step-by-step state-aware walkthrough.

**Components**:
- `ManualAdapter` (interface, host implements against their docs CMS)
- `ProcedureSurface` (SDK ships) with state: done / stuck / not-yet
- `walkThroughSkill` (SDK ships):
  - Step renders + waits for user
  - Done → next step
  - Stuck → sub-procedure or `escalate_to_human(...)` if no fallback
- Optional RAG layer the SDK can stub (host plugs in vector store)

**Host integration cost target**: implement `search` + `getProcedure`
against their docs backend. Procedures themselves authored in CMS,
not in code.

---

## Sequencing (rough)

Not a commitment, just intent:

1. **Foundation polish** first (1.1–1.8). Smallest changes, cleans
   the surface before structural work lands on top.
2. **Workflow capabilities** next (2.1–2.8). Each independent;
   ship as they're ready, don't block on the slow ones.
3. **New tools + surface templates** parallel with above (3.x).
4. **Host-experience layer** mid-cycle (4.x). Some items (sitemap
   schema, budget guard) need foundation polish first.
5. **Vertical adapters** last (5.x). Built on top of everything
   above; ship one at a time, prove the pattern on Ecommerce
   before doing FeatureIndex.

---

## Tracking

Issues / PRs related to 0.2.0 should reference this doc and use
the `v0.2.0` GitHub milestone (to be created).
