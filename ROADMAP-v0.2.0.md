# dddk v0.2.0 — roadmap

Status: **planning**. Nothing shipped. v0.1.3 is the current
published release.

## Why 0.2.0 (not 0.1.x patches)

0.2.0 is the structural release. It bundles every substantive
direction the project commits to:

- The SDK gets its foundation cleanup, new workflow capabilities,
  vertical adapters for Ecommerce / SaaS / Manual flows.
- The agent loop gets a streaming envelope so each turn's narration
  starts as the LLM types it, not after the LLM finishes.
- Image generation is out of scope (deferred).
- The SDK absorbs a **unified data ingest + telemetry layer** plus
  **first-party reference implementations of search, recommendation,
  training-dataset export, and audit-log infrastructure**.
- A pluggable **storage adapter interface** lets any host wire the
  ingest pipeline into whatever backend they run.
- Multi-model switching + native notes close the gap with consumer
  AI extension expectations.

Patch releases (0.1.x) stay limited to bug fixes and copy. The whole
0.2.0 batch ships together once verified end-to-end against the demo
site at `dddk.perhapxin.com` and the new extension test bed.

## Strategy: data + algorithms open in the SDK; hosting is the
service

Every piece of the data architecture — schemas, capture APIs,
ranking algorithms, recommendation models, training export formats,
audit chain structure — ships in the SDK under AGPL-3.0. Anyone can
read the code, implement the storage adapter interface, point it at
their own ClickHouse / Postgres / object store, and run the entire
BI stack themselves.

`@perhapxin/dddk-frontend` ships a reference hosted implementation
on a Cloudflare-native stack. Paying for the hosted SaaS at
`dddk.perhapxin.com` is paying for operational convenience —
multi-tenant management, single sign-on, automated rollouts, vault
sync, premium skills bundle, extension subscription management —
not for the BI capability itself.

Practical reasons this matters:

- Enterprise customers can audit the analytics pipeline before
  letting it touch their users.
- Self-host stays viable for cost / compliance / data-sovereignty
  cases that hosted SaaS can't serve.
- Community contributions land back in the SDK (new sink adapters,
  new ranking strategies, new storage backends) and benefit
  everyone.
- The commercial license that already covers SDK adoption for
  closed-source products extends naturally to the BI capability.

## How to read this doc

Each item lists **current state**, **problem**, **proposal**. Items
are grouped by theme. Internal paths are repo-relative to this SDK
package. Cross-references to sibling packages
(`@perhapxin/dddk-frontend`, `@perhapxin/dddk-extension`) are by
package name to keep this doc self-contained when read on its own.

This doc grows as more is decided. New items land here, not a future
roadmap.

---

## 1 · Foundation polish

Items inherited from the v0.1.x review — structural fixes that
don't change product behavior but clean up the surface — plus the
single highest-impact UX fix on the runtime (1.9).

### 1.1 Memory: unify v1 + DrawerMemory into one subsystem

**Current**: two parallel systems shipped — `Memory v1` (3-tier
hybrid core / episodic / semantic with PII filter, retention,
consent) and `DrawerMemory` (legacy BM25 store). Hosts don't know
which to use.

**Problem**: cognitive load on every integration. Docs side them
next to each other, but use cases differ entirely.

**Proposal**: collapse into one `Memory` system with pluggable
storage backends and tier strategies:

```
Memory
  ├── tiers: { core, episodic, semantic }
  ├── storage: MemoryStorage           ← pluggable (in-memory / BM25 / vector / server)
  └── policy: { piiFilter, retention, consent }
```

`DrawerMemory` becomes a storage backend (`bm25` strategy) inside
the unified Memory. Migration: hosts using legacy `DrawerMemory`
drop one line, Memory inherits the BM25 store. Docs collapse to one
section.

### 1.2 Action category grouping in the prompt catalog

**Current**: 14 built-in actions + host-registered actions all
listed flat in the tool catalog given to the LLM.

**Problem**: LLM picks slower and worse from a flat list as it
grows. Past 30-40 tools the agent starts misrouting between similar
names (e.g. `find_customer` vs `find_order`).

**Proposal**: introduce action **categories** at registration:

```ts
dddk.tools.register({
  name: 'find_product',
  category: 'data',
  description: '...',
});
```

Built-in categories: `navigation` / `input` / `visual` / `dialog` /
`data` / `presentation`. Catalog rendered grouped, category headers
in the system prompt. LLM scoping improves at scale.

### 1.3 SDK i18n stub strings

**Current**: SDK ships hardcoded EN defaults for module-level UI
labels (e.g. `'Listening — release to send'`, `'Voice input not
supported'`). Hosts must override all of them to get any other
locale.

**Problem**: minimal-locale hosts pay the same override cost as
full-i18n hosts.

**Proposal**: ship a thin SDK i18n table keyed by locale, used as
fallback when host doesn't supply its own. Scope: voice module
labels, subtitle confirmation hints, generic error copy. NOT: agent
persona / sitemap / brand / proactive prompts — those stay
host-owned.

### 1.4 `wait` action: configurable cap

**Current**: hardcoded `maximum: 5000` ms in
[src/agent/webagent/actions.ts](src/agent/webagent/actions.ts).

**Problem**: 5s is too short for any server-side async task (PDF
export, report generation, batched email send). Agent stalls.

**Proposal**: per-call `maxWaitMs` config on `WebAgentConfig`.
Runtime default stays 5s for safety; hosts whose backend operates
on a longer timeline bump it explicitly. Caps over 30s gated behind
a `confirmLong` gesture so the agent can't silently camp.

### 1.5 `disableBuiltinActions` semantics rename

**Current**: name implies "the action is gone". But for `pause`,
disabling the tool only stops the LLM from explicitly calling it —
the runtime auto-pause after every narrate still fires.

**Problem**: hosts pass `disableBuiltinActions: ['pause']`
expecting no pauses at all. Confusion + bug reports.

**Proposal**: split into two clearly named fields:

- `excludeTools: string[]` — LLM never sees these in the catalog.
- `disableAutoPauseAfterNarrate: boolean` — kills the runtime-level
  pause.

Old name kept as alias for one minor version with a console warn,
then removed in 0.3.

### 1.6 Action / tool registration race documentation

**Current**: hosts call `dddk.tools.register(...)` while an agent
run is mid-flight. New tools take effect on the *next* turn, by
design (in-flight turn uses the snapshot from when it started).

**Problem**: undocumented. Hosts hit it once, debug for 30 min.

**Proposal**: document in the agent overview docs. Optional: expose
`dddk.tools.flush()` to await mid-flight completion so the very next
turn picks up.

### 1.7 `/docs/latest/` redirect route

**Frontend item — see `@perhapxin/dddk-frontend` ROADMAP**. The
README's hardcoded doc URLs currently pin to a specific version;
the fix is a redirect route in the hosted package. Listed here for
cross-reference.

### 1.8 Proactive empty-registry skip

**Status**: shipped in v0.1.3. Tick early-returns when 0 prompts
registered.

### 1.9 Streaming agent envelope — actions execute as the LLM streams

**Current**: in CoT mode, the LLM streams `agent_turn` tool-call
args character by character until the tool call completes
([src/agent/webagent/runtime/loops.ts:357-363](src/agent/webagent/runtime/loops.ts#L357-L363)).
Only THEN does `parseTurnResponse` parse the full envelope, and
only THEN does the runtime iterate `turn.actions` to execute them.

The narrate text on screen comes from
[src/agent/webagent/runtime/loops.ts:554-558](src/agent/webagent/runtime/loops.ts#L554-L558)
— the runtime takes the already-complete `action.narrate` string
and **simulates** typewriter streaming at 8ms / 2 chars from its
own local buffer. That looks like streaming to the user, but the
real streaming (from the LLM) has already finished by then.

**Problem**: the user sees `Thinking…` pip + a full LLM TTFT (1-3s
on `gpt-5.4-nano`, longer on cold cache or bigger envelopes)
**before the first character renders**. Then the typewriter
starts. Then the auto-pause. Then the next narrate after another
full LLM call. The slowest single moment in the loop is the gap
between "user hits Space" and "first character of the next turn
appears".

Live demos hit this every turn. It's the single biggest UX
regression vs a naked streaming chat.

**Proposal**: parse the streaming tool-call args **incrementally**.
As `narrate` strings inside `actions[]` accumulate character by
character, emit `text-delta` events straight to the subtitle bar.
The user sees the real LLM stream as the LLM types it, not a
delayed local replay.

Implementation sketch — a streaming JSON tokenizer that understands
the `agent_turn` schema. As the LLM streams tool-call args, it
yields semantic events instead of raw deltas:

```
{ kind: 'memory_complete', value: '...' }
{ kind: 'planning_complete', value: { evaluation_previous_goal, next_goal } }
{ kind: 'action_start', index: 0 }
{ kind: 'narrate_delta', index: 0, delta: 'Welc' }
{ kind: 'narrate_delta', index: 0, delta: 'ome to dotdotduck' }
{ kind: 'narrate_complete', index: 0, about?: '[e4f3a]' }
{ kind: 'action_start', index: 1 }
{ kind: 'tool_args_complete', index: 1, tool: 'navigate', args: {...} }
{ kind: 'envelope_complete', is_final: false }
```

Runtime consumes the event stream:

- `narrate_delta` → emit AgentEvent `text-delta` immediately. No
  more local typewriter — the LLM IS the typewriter.
- `narrate_complete` → trigger the auto-border (if `about` was
  parsed earlier) + auto-pause.
- `tool_args_complete` → execute the tool. If the previous narrate
  is still waiting on user Space, queue the tool start until the
  pause resolves.
- `envelope_complete` → close the turn.

Edge cases:

- LLM emits malformed JSON mid-stream — parser buffers + retries;
  falls back to the current "wait for completion" path if it can't
  recover.
- `is_final` is written LAST per current schema convention; the
  streaming parser observes it after all `actions[]` close, so
  early-finish detection still works.
- Auto-border depends on `about` being parsed BEFORE the narrate
  string streams. Schema order already puts `about` before
  `narrate` in the action object — keep that convention.
- `todo_adjust` / `memory` / `turn_planning` are at envelope level,
  parsed once their keys complete. Effects (todo removal, memory
  recap) fire as soon as parsed.

Provider compatibility: every LLM provider already in the SDK
([src/agent/llm/openai.ts](src/agent/llm/openai.ts) /
[src/agent/llm/google/stream.ts](src/agent/llm/google/stream.ts) /
the proxy lane) streams tool-call args char-by-char. The parser sits
on top of whatever the provider yields — no provider-side change
needed.

Expected impact:

- Time-to-first-character drops from "full LLM call" to "first
  token after tool-call started" — typically 300-700ms vs
  1500-3000ms today.
- Per-turn perceived latency drops by **~1.5-2s on `gpt-5.4-nano`**,
  more on bigger envelopes.
- Long narrate beats feel live instead of pre-canned.

Engineering scope: ~400-600 LOC for the streaming parser + runtime
plumbing, ~1-2 weeks. Highest-ROI UX item in 0.2.0.

### 1.10 Multi-vendor + self-hosted LLM adapters

**Current**: SDK ships `OpenAIProvider`, `GoogleProvider`,
`ProxyProvider`. Any OpenAI-compatible vendor works via the OpenAI
provider with a custom `baseURL`. Non-compatible vendors (Anthropic,
Cohere, Bedrock, Vertex, Azure OpenAI) currently have no first-party
adapter.

**Problem**: enterprise hosts running on AWS Bedrock / Google Vertex
/ Azure OpenAI either write their own adapter or route through their
own proxy. Self-hosted hosts (Ollama / vLLM in their VPC) have no
recipe.

**Proposal**:

- ship `AnthropicProvider` (Claude messages API)
- ship `BedrockProvider` (AWS SDK wrapper, IAM-auth)
- ship `VertexProvider` (Google Vertex AI, ADC-auth)
- ship `AzureOpenAIProvider` (deployment-name routing)
- self-hosted recipe page: Ollama, vLLM, LM Studio, llama.cpp with
  concrete `baseURL` + headers config

All slot into the same `LLMRouter` 4-axis interface — host swaps
provider per role without changing agent code.

---

## 2 · Workflow capabilities

Items addressing real-world flows the agent currently can't handle
(or handles poorly).

### 2.1 Popup window support

**Current**: agent operates within the main tab's DOM.
`window.open()` spawns a popup the agent doesn't see.

**Problem**: OAuth login, social login, "open in new tab" links —
all break the loop.

**Proposal**: detect `window.open` from agent-driven click, hold
the main loop, listen for popup close, read result (URL params,
`postMessage`, or `window.name` handoff per host). Resume main
loop with result.

Scope: same-origin popups + standard OAuth `postMessage` callback
pattern. Cross-origin opaque popups → emit `popup_unobservable`
event, agent hands off to user.

### 2.2 Same-origin iframe support

**Current**: agent's DOM index ignores iframes. `[id]` references
are main-document only.

**Proposal**: walk same-origin iframes into the same id-map.
Cross-origin iframes stay opaque (sandboxed by browser). Element
resolution via selectors works across iframe boundaries when
same-origin.

### 2.3 Cross-origin failure mode

**Current**: agent might attempt to operate cross-origin content
and silently fail.

**Proposal**: explicit `out_of_scope` action result with reason
`'cross_origin'`. Agent narrates the boundary to the user, offers
to hand off, doesn't crash the loop.

### 2.4 Built-in form widget adapters

**Current**: `fill_input` works for plain `<input>` / `<textarea>`.
Custom React combobox / date picker / file upload / rich text
editor needs a host-written custom action.

**Problem**: every host writes the same wrappers for the same
widgets.

**Proposal**: ship adapter strategies for the common framework
patterns:

- `react-aria` primitives
- `headless-ui` primitives
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
`[aria-invalid="true"]`, `[data-error]`, `.error`,
`.invalid-feedback`, or matching ARIA descendant patterns, attaches
errors to the action result so the next turn sees them in
`action_results` immediately.

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
    { id: 'address',     action, onFailure: 'rollback' },
    { id: 'payment',     action, onFailure: 'abort' },     // no rollback
    { id: 'confirm',     action, onFailure: 'ignore' },
  ],
  rollback: [
    { id: 'address',     action: clearAddress },
    { id: 'cart_review', action: clearCart },
  ],
}
```

Runtime walks forward step by step; on failure walks the rollback
chain backwards from the last successful step.

### 2.7 Long-running task polling

**Current**: `wait` capped + no async-task pattern.

**Proposal**: new action `poll({ checkActionId, intervalMs,
timeoutMs })`. Host registers a `check_action` returning
`{ ready: boolean, data? }`. Runtime polls until ready / timeout.
Loop continues processing other work while polling.

### 2.8 Login-required signal

**Current**: agent navigates into a 401-redirect; ends up on the
login page operating it as if it were the target page.

**Proposal**: two signals:

- DOM attribute `data-dddk-auth-required` on protected routes —
  agent recognises before navigation.
- Backend 401/403 response detection on `fetch_external` calls.

Runtime emits `auth_required` intent. Host wires the recovery —
login modal, redirect, hold-and-resume etc.

---

## 3 · New tools

### 3.1 Generic action additions

- `fetch_external(allowlisted_url, params)` — server-proxied fetch,
  host-allowlist enforced
- `search(adapter_id, query)` — generic search hook; default
  reference implementation in 8.x
- `summarize_page()` — LLM-only, no DOM walk; uses the current dump
- `extract_structured_data(schema)` — DOM → JSON via host schema
- `track_intent(kind, payload)` — explicit intent emit for the
  ingest stream (7.x)
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

Items that make adoption faster for application owners.

### 4.1 Structured sitemap

**Current**: sitemap is a free-text blob hosts paste into the
system prompt. Token-bound; deep hierarchies don't fit.

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
intent (paired with `FeatureIndex` search in 3.3).

### 4.2 Action description cookbook

**Current**: hosts write action descriptions; quality varies. Bad
descriptions silently degrade agent quality.

**Proposal**: docs page with positive / negative examples, a
description linter (yes/no checks: "does it say WHEN to call?",
"does it say WHAT args?", "does it say WHAT it returns?"), and
bundled high-quality descriptions for the built-in actions as
reference.

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
- `data-dddk-pii="redact"` — element value redacted in the DOM
  dump the LLM sees, even if visually present
- Audit log entry (see 10.x) for every action touching a `pii`
  element

### 4.5 Budget guard

**Current**: no per-user / per-org LLM cost ceiling.

**Proposal**: middleware in the LLM router; host configures budget
per identity. Once exceeded, agent falls back to handoff or denial.

### 4.6 A/B testing prompts

**Current**: hosts swap prompts manually; no measurement
framework.

**Proposal**: bundle a tiny experiment system — host registers
variants, SDK picks one per session (sticky by `visitor_id`),
variant id flows through the intent stream (7.x) so the host's
analytics see which won.

### 4.7 Escalate-to-human handoff

**Current**: no standard tool / event.

**Proposal**: ship `escalate_to_human(reason, context)` action +
`agent_escalated` intent + docs for wiring into the host's
live-chat surface.

### 4.8 No-code skill builder — format spec + runtime support

**Current**: skills are TypeScript objects. Non-developers can't
author skills without engineer help.

**Problem**: every product update that needs a tour / procedure /
proactive prompt change blocks on a developer.

**Proposal — SDK side**: define a JSON config format (`SkillConfig`
type) that the SDK runtime consumes alongside code-authored skills.
Scope kept small: Script + Prompt skill types only. Action / Surface
/ Panel skills still require code.

**Proposal — frontend side**: visual editor that produces
`SkillConfig` JSON lives in `@perhapxin/dddk-frontend` — see its
ROADMAP for the UI plan.

---

## 5 · Vertical adapters

The three high-value vertical patterns. Each ships as: an Adapter
interface, one or more SurfaceTemplates, a bundled Skill that
orchestrates the flow.

### 5.1 Ecommerce shopping plan

**Use case**: "I want to buy a laptop — help me with price /
quality / brand / promo / event analysis, plan the best purchase,
suggest related items."

**Components**:

- `EcommerceAdapter` (interface, host implements against their
  catalog API)
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

**Use case**: "Help me set up custom email signatures for my team"
— on a SaaS with 200+ settings pages 5 levels deep.

**Components**:

- `FeatureIndex` (interface, host implements)
- Builder tool that takes a route table → semi-auto-generates the
  `FeatureIndex`
- `find_feature(intent)` tool (SDK ships)
- `findFeatureSkill` (SDK ships) — navigates to the feature,
  narrates the prerequisites, walks the user to the right control

**Host integration cost target**: registry config for each feature
(path + semantics + keywords + prerequisites). 200 features = 200
lines of config.

### 5.3 Manual / procedure walkthrough

**Use case**: "My printer won't connect to WiFi" — RAG over the
support corpus + step-by-step state-aware walkthrough.

**Components**:

- `ManualAdapter` (interface, host implements against their docs
  CMS)
- `ProcedureSurface` (SDK ships) with state: done / stuck / not-yet
- `walkThroughSkill` (SDK ships):
  - Step renders + waits for user
  - Done → next step
  - Stuck → sub-procedure or `escalate_to_human(...)` if no fallback
- Optional RAG layer the SDK can stub (host plugs in vector store
  via 8.x adapter)

**Host integration cost target**: implement `search` +
`getProcedure` against their docs backend. Procedures themselves
authored in CMS, not in code.

---

## 6 · Multi-model + Notes

Two consumer-feature additions that fill in expected functionality
when the SDK runs as a generic browser-side assistant.

Image generation is **out of scope** for 0.2.0 — usage data on
consumer browser extensions shows it's rarely a daily-driver
feature, and hosts that genuinely need image gen can wire their own
provider through the existing proxy pattern that the demo site
already implements. If demand surfaces post-launch, image gen is a
0.2.x or 0.3.0 candidate.

### 6.1 Multi-model palette + agent switching

**Current**: 4-axis LLM router (`webagent` / `vision` / `utility` /
`plan`). Host configures one model per role; visitors don't choose
at runtime.

**Problem**: when the SDK runs in a generic browser-assistant
context, visitors expect to pick a model per query — different
models behave differently and they want to compare.

**Proposal**:

- New `/model` palette command surfaces every model the host's
  `LLMRouter` has registered. Picking one overrides the next agent
  run / next inline action / next palette query.
- Optional `/compare <question>` runs the same prompt against 2-3
  selected models in parallel, renders side-by-side answers via a
  new `ComparisonSurface` variant.
- Skills can declare `preferredModel?: 'webagent' | 'plan' |
  'utility'` to opt out of user overrides (e.g. plan step always
  uses the cheap planner).
- Per-org / per-user budget guard (4.5) applies to whichever model
  is picked.

### 6.2 Native notes capture

**Current**: SDK has no note-taking. Selecting text and saving it
elsewhere requires a separate extension. Every consumer skill that
needs a place to write its output to has nowhere to send it.

**Proposal**:

- New `NotesAdapter` interface:

  ```ts
  interface NotesAdapter {
    save(note: { content: string; tags?: string[]; sourceUrl?: string; sourceTitle?: string }): Promise<{ id: string }>;
    list(query?: { tags?: string[]; since?: number; limit?: number }): Promise<NoteRow[]>;
    get(id: string): Promise<NoteRow>;
    delete(id: string): Promise<void>;
    update(id: string, patch: Partial<Note>): Promise<void>;
  }
  ```
- SDK ships a default IndexedDB-backed adapter so hosts (and the
  extension) get notes out of the box.
- Host can swap to a backend adapter (host's notes service, hosted
  SaaS cloud sync, or third-party integration).
- New `note_save(content, tags?, source?)` SDK tool — agent
  callable.
- New `/save` palette command — captures current selection or
  current page summary into notes.
- New `/notes` palette command opens a `NotesPanelSkill` showing
  recent notes, search, tag filters.
- Notes flow into the ingest stream (7.x) as `note_saved` /
  `note_opened` events for analytics.

---

## 7 · Unified data ingest + telemetry

Foundation for everything downstream (search / recommendation /
training export / audit log). The SDK becomes the **single canonical
ingest pipeline** for everything happening in a host's product —
from high-level agent decisions down to raw mouse clicks, with
schemas, transport, and sink adapters all defined here.

### 7.1 Unified event schema

**Current**: SDK already emits typed `IntentEvent` types for
palette / voice / agent / Dwell / etc. But there's no formal
schema definition, no JSON Schema, no consistency contract for
hosts who want to validate or extend.

**Proposal**:

- Publish event schemas as machine-readable JSON Schema /
  TypeScript types in `dist/schema/events.json` so downstream tools
  can validate.
- Versioned: `schema_version` field on every event. Schema
  evolution rules (additive only within a minor) documented.
- Event categories standardised: `intent`, `interaction`,
  `lifecycle`, `audit`, `experiment`, `custom`. Every category has
  required core fields (`session_id`, `visitor_id`, `org_id`,
  `timestamp`, `kind`, `category`) plus category-specific shape.
- Host-defined custom event types extend cleanly via
  `dddk.events.defineEventType(name, schema)`.

### 7.2 Raw interaction telemetry

**Current**: SDK only emits high-level intent events.
Browser-level interaction (clicks, scrolls, hovers, focus changes)
is invisible.

**Problem**: hosts want product-analytics-grade visibility — what
elements get hovered, scroll depth on long pages, focus-blur on
form fields. Without this they need a second product-analytics
SDK alongside dddk.

**Proposal**: add an opt-in `Telemetry` module that captures raw
browser interactions:

```ts
new dddk.Telemetry({
  captureClicks: true,                   // every DOM click
  captureScrolls: { sampleHz: 4 },       // 4 samples/sec while scrolling
  captureFocus: true,                    // input focus + blur, time-on-field
  captureHovers: { minDwellMs: 500 },    // long hovers only, not every mouse move
  captureRouting: true,                  // SPA route changes
  capturePerformance: true,              // navigation timing, LCP, INP
  piiFilter: defaultPiiFilter,           // strip values in password / payment fields
  consent: () => userConsentState(),     // host gates with their consent infra
}).attachTo(dddk);
```

Events stream through the same ingest pipeline as intents — same
sinks, same storage adapter, same export tooling.

PII safety:

- Form field VALUES never captured by default — only field type,
  field name, validation state.
- `data-dddk-pii` markers (4.4) propagate: elements tagged
  `redact` never emit telemetry at all.
- Consent gate is host-supplied — SDK doesn't ship a consent
  surface, hosts wire their existing one. No consent = no
  telemetry (silent no-op, not error).

### 7.3 Capture API + opt-in consent

**Current**: hosts add tracking ad-hoc via the `onIntent` hook.

**Proposal**: unified `dddk.track(name, props?)` API — same
canonical schema, same sinks, same downstream tooling. Hosts who
already have a consent system gate the entire pipeline through a
predicate.

```ts
dddk.track('order_completed', { order_id, value, items });
```

Mirrors the standard product-analytics `track(name, props)` surface
that engineers recognise from existing tooling. Goes through the
same transport layer as the intent + telemetry streams — there's
only one pipe.

### 7.4 Transport layer

**Current**: events are sent to a single host-configured endpoint,
fire-and-forget, no batching or retry.

**Proposal**:

- **Batching**: events queue in memory, flush every N ms or M
  events (configurable, defaults aimed at 5s / 20 events).
- **Retry with backoff**: exponential, capped at 5 attempts, then
  to disk via IndexedDB for retry on next page load.
- **Ordering**: events carry monotonic sequence number per
  session. Sink dedupes / re-orders on receipt.
- **Compression**: gzip the batch body if > 4 KB.
- **Pluggable transports**: HTTP (default), WebSocket (for
  real-time pipelines), beacon API (for page-unload flushes).

### 7.5 Sink adapter interface

Host implements where events go. SDK ships reference adapters.

```ts
interface EventSink {
  send(batch: Event[]): Promise<void>;
  flush(): Promise<void>;
  dispose(): Promise<void>;
}
```

Bundled reference sinks (SDK ships, hosts opt in):

- `HttpSink` — POST batches to a host-configured endpoint (most
  common, used by the hosted package).
- `BigQuerySink` — direct stream to BigQuery.
- `SnowflakeSink` — Snowpipe-style.
- `RedshiftSink` — Kinesis Firehose.
- `WebhookSink` — opinionated POST format for arbitrary webhook
  destinations.
- `DebugSink` — `console.log` for development.
- `MultiSink` — fan-out wrapper for sending to multiple sinks
  simultaneously (e.g. host's own warehouse + the dddk-frontend
  hosted analytics).

Host can ship their own sink — just implement the interface.

---

## 8 · Search engine

The SDK ships a reference search engine — schema definitions,
ranking algorithms, indexing pipeline, retrieval interface. The
backend storage layer is pluggable via the storage adapter
interface (11.x). The hosted package implements the storage layer
against Cloudflare Vectorize + D1 FTS5.

### 8.1 Search adapter interface

The `search(adapter_id, query)` action from 3.1 dispatches to one
of the host's registered search adapters. The interface:

```ts
interface SearchAdapter {
  index(documents: SearchDocument[]): Promise<void>;
  query(query: SearchQuery): Promise<SearchResult[]>;
  delete(ids: string[]): Promise<void>;
  reindex(): Promise<void>;
}

interface SearchDocument {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  locale?: string;
}

interface SearchQuery {
  text: string;
  filters?: Record<string, unknown>;
  topK?: number;
  locale?: string;
}
```

Hosts register adapters per `adapter_id`:

```ts
dddk.search.registerAdapter('docs', new BM25Adapter(...));
dddk.search.registerAdapter('products', new HybridAdapter(...));
```

### 8.2 Hybrid reference implementation

SDK ships a reference implementation of hybrid retrieval (vector +
keyword + fusion ranking). Hosts can use it directly via the
storage adapter or copy + adapt for their own backend.

Algorithm:

1. **Vector retrieval**: query embedding via the configured `LLMRouter.utility` (or a host-supplied embedder) → vector store
   lookup → top N by cosine similarity.
2. **Keyword retrieval**: BM25 over the same documents → top N by
   BM25 score.
3. **Fusion**: reciprocal rank fusion (RRF) merges the two lists.
   Weight tunable per adapter.
4. **Re-rank**: optional cross-encoder re-rank on the top K from
   fusion. Host can plug a re-ranker; SDK ships a default
   embedding-similarity re-ranker as fallback.

All algorithm code lives in `src/search/`. Hosts inspect it, fork
it, contribute back.

### 8.3 Index builder pattern

Building the index from a structured sitemap (4.1):

```ts
const builder = new dddk.search.IndexBuilder({
  sitemap: hostSitemap,
  fetchPage: async (path) => await fetch(path).then(r => r.text()),
  extractContent: (html) => readableMainContent(html),
  embed: hostEmbedder,
  store: storageAdapter,
});
await builder.run();
```

Pattern: crawl → extract → embed → index. Re-runnable on schedule
or webhook trigger.

### 8.4 Multi-locale indexing

Documents tagged with `locale`. Query routes by user's current
locale by default. Hosts can override the routing per query
(`searchAdapter.query({ ..., locale: 'all' })` for cross-locale
search).

---

## 9 · Recommendation engine

Reference recommendation engine — collaborative filtering +
content-based fallback — that learns from the ingest stream (7.x)
and serves real-time recommendations.

### 9.1 Recommendation adapter interface

```ts
interface RecommendationAdapter {
  ingest(signals: ImplicitSignal[]): Promise<void>;
  recommend(query: RecommendationQuery): Promise<Recommendation[]>;
  retrain(): Promise<void>;
}

interface ImplicitSignal {
  userId: string;
  itemId: string;
  signalKind: string;   // 'view' | 'click' | 'confirm' | 'add_to_cart' | ...
  weight: number;
  timestamp: number;
}

interface RecommendationQuery {
  contextUserId?: string;
  contextItemId?: string;
  topK?: number;
  filters?: Record<string, unknown>;
}
```

### 9.2 Reference impl — collaborative filter + content-based
fallback

Algorithm:

- **Item-item co-occurrence**: precomputed item-item similarity
  matrix from session-level co-occurrence in the ingest stream,
  weighted by signal kind (`confirm` ≫ `click` ≫ `view`). Computed
  in batch (cron / scheduled job), stored in the storage adapter.
- **User profile vector**: aggregate of recent positive signals
  per user; near-realtime updates.
- **Inference**: for `contextItemId` queries, return top-K from the
  item-item matrix; for `contextUserId` queries, retrieve user
  profile vector → cosine similarity vs item embeddings.
- **Content-based fallback for cold-start**: use the same vector
  index from 8.x to find items similar in content to seed items.
- **Diversity re-rank**: optional MMR-style diversity step to
  avoid recommending 10 near-duplicates.

All algorithm code lives in `src/rec/`. Same posture as search —
open and inspectable.

### 9.3 Implicit signal extraction from the ingest stream

The recommendation pipeline subscribes to the ingest stream (7.x)
and extracts signals automatically:

- `agent_asked(entityId)` → view, weight 0.3
- `selection_used(elementHash)` → view, weight 0.4
- `palette_activated(itemId)` → click, weight 0.6
- `confirm_action(target)` → confirm, weight 1.0
- `agent_feedback({satisfied: true, contextItemId})` → confirm, weight 1.0
- `agent_feedback({satisfied: false, ...})` → negative, weight -0.5
- Custom signal mapping registrable per host.

### 9.4 Eval harness

Reference eval harness for offline measurement:

- Replay historical signal stream against a held-out window.
- Compute NDCG@K, MAP, recall@K, conversion lift (where
  conversion event is host-defined, often `confirm_action` of a
  specific type).
- A/B variant tracking — paired with 4.6 — so hosts compare
  algorithm versions in production.

Eval code lives in `src/rec/eval/`. Reproducible against a
checked-in synthetic dataset for CI testing.

---

## 10 · Training data export + Audit log

### 10.1 Training dataset export — format definitions

The SDK defines the export formats; the hosted package (and any
self-host implementation) runs the actual SQL → file generation
against their storage backend.

Formats:

- **SFT pairs** — `(user_prompt, system_prompt + history, agent_response)`
  rows. Filterable by intent kind, project, date range, feedback
  signal.
- **DPO triples** — `(prompt, chosen_response, rejected_response)`
  pairs derived from feedback decisions. `chosen` = Space-accepted
  branch, `rejected` = double-tap-rejected branch on the same
  prompt.
- **Tool-use traces** — `(prompt, action_sequence)` with success /
  failure label from tool result events.
- **RAG eval set** — every `search → narrate` pair from the ingest
  stream becomes a retrieval+gen eval row.

Output formats: JSONL (HuggingFace-compatible), Parquet (warehouse
ingest), CSV (spreadsheet-friendly).

PII filter (4.4) applied at export time — `redact` fields stripped,
`high` fields hash-replaced.

### 10.2 Audit log schema + emission

Audit log isn't a separate stream — it's a category within the
unified ingest schema (7.1). Audit-category events have stricter
guarantees:

- Every action result emits an `audit_entry` event with: actor
  (`session_id`, `visitor_id`, `org_id`), action (`tool_name`,
  `arguments_summary` — PII-filtered), target (resolved entity
  refs), outcome (`ok` / `reason` / error class), confirm decision
  if confirm-gated, timestamp + run_id linkage.
- Audit-category events bypass the regular batching layer (7.4) —
  flushed individually for stronger durability.
- Retention defaults: 90 days; configurable per org through the
  hosted console.

### 10.3 Hash chain tamper-evidence

Each audit entry includes a `prev_hash` field — SHA-256 of the
previous audit entry in the org's chain. Detection of retroactive
edits / deletions is then a chain walk: any broken hash =
tampered.

The chain root is anchored periodically (per day, per week) to a
publicly-verifiable timestamp service so retroactive head
replacement can be detected too.

---

## 11 · Storage adapter interface

The single pluggable seam between SDK and any backend. Search
engine (8.x), recommendation engine (9.x), training export
(10.1), audit log (10.2), telemetry sinks (7.5) all read/write
through this.

### 11.1 Pluggable storage backend

```ts
interface StorageBackend {
  events: EventStore;
  documents: DocumentStore;
  vectors: VectorStore;
  rollups: RollupStore;
  audit: AuditStore;
}

interface EventStore {
  append(events: Event[]): Promise<void>;
  query(criteria: EventQuery): Promise<Event[]>;
  scan(opts: ScanOptions): AsyncIterable<Event>;
}

interface DocumentStore {
  upsert(docs: SearchDocument[]): Promise<void>;
  search(query: KeywordQuery): Promise<SearchResult[]>;
  delete(ids: string[]): Promise<void>;
}

interface VectorStore {
  upsert(vectors: Vector[]): Promise<void>;
  similarity(query: number[], topK: number, filter?: Record<string, unknown>): Promise<VectorMatch[]>;
}

interface RollupStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  increment(key: string, by?: number): Promise<number>;
}

interface AuditStore {
  append(entry: AuditEntry): Promise<{ chainHash: string }>;
  verify(orgId: string): Promise<AuditVerificationResult>;
}
```

### 11.2 Default in-browser implementation

For hosts running SDK without any backend (demo, prototype,
local-only extension mode):

- `IndexedDBEventStore` — events buffered in IndexedDB
- `IndexedDBDocumentStore` — small-scale FTS via FlexSearch.js
- `InMemoryVectorStore` — for ≤ 10K vectors at prototype scale
- `InMemoryRollupStore` — in-memory key-value
- `IndexedDBAuditStore` — local audit chain

Hosts ship the bundled defaults and graduate to a server adapter
when they need scale.

### 11.3 Server-side adapter interface

Server-side reference adapters live in `@perhapxin/dddk-frontend`
(Cloudflare D1 / R2 / Vectorize) — see its ROADMAP for the
implementation plan. Other reference adapters that may ship as
separate packages or community contributions:

- `@perhapxin/dddk-postgres` — Postgres + pgvector
- `@perhapxin/dddk-clickhouse` — ClickHouse for OLAP scale
- `@perhapxin/dddk-pinecone` — Pinecone vector store

Self-hosting recipe: implement the storage adapter interface
against your stack of choice; the SDK runtime + all downstream
features (search, rec, training export, audit) work unchanged.

---

## Sequencing (rough)

Not a commitment. Suggested order:

1. **Foundation polish (1.x)** first. **1.9 (streaming agent
   envelope)** is the single highest-ROI UX item in 0.2.0 —
   schedule it early so all subsequent demo recordings benefit.
2. **Workflow capabilities (2.x)** parallel with foundation. Each
   independent; ship as they're ready.
3. **Storage adapter interface (11.x)** before search /
   recommendation work — those depend on it.
4. **Unified ingest + telemetry (7.x)** — foundation for everything
   downstream.
5. **Search engine (8.x)** and **recommendation engine (9.x)** can
   ship independently once 11.x + 7.x land.
6. **Training export + audit (10.x)** depends on 7.x + 11.x.
7. **New tools (3.x)** + **host-experience layer (4.x)** in
   parallel throughout.
8. **Vertical adapters (5.x)** last — build on top of everything.
9. **Multi-model + Notes (6.x)** can ship anytime; small scope.

---

## Tracking

Issues / PRs related to SDK v0.2.0 work should reference this doc
and use the `v0.2.0` GitHub milestone (to be created).
