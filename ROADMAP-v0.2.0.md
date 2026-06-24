# dddk v0.2.0 — roadmap

Last updated: 2026-06-24. Reflects the working-tree state after the
2026-06 push (SDK trim, /platform restructure, Agnes adapter, workflow
2.x actions, Memory unification). **Status: shipped to working tree.
Not yet committed, not yet published.**

The previous draft of this doc enumerated ~60 items across 11 categories
— most were exploratory. This rewrite reflects what actually landed and
what is next.

---

## Why 0.2.0

v0.1.x shipped the surfaces (palette / WebAgent / Inline AI / Voice /
Dwell / Proactive / Intent Stream). v0.2.0 is the productisation
release — it makes those surfaces useful for hosts running real
products, not just demos.

Three thrusts:

1. **Workflow capabilities** — the gaps the agent hits when it tries
   to operate non-trivial product UIs (forms with validation,
   long-running async work, sign-in walls, popups, iframes).
2. **Ingest + audit** — turn the intent stream into a production data
   pipeline with structured events, transport, audit trails.
3. **Authenticated multi-tenant lane** — extension + Console signed-in
   experience with metered LLM proxy, founder-only access.

Patch releases (0.1.x) stay limited to bug fixes. The 0.2.0 batch
ships once verified end-to-end against `dddk.perhapxin.com` and the
extension test bed.

---

## ✅ Shipped — landed in working tree (2026-06)

### Foundation polish
- **1.3 SDK i18n stub** — voice module labels (`listening` /
  `unsupported` / `failed`) added to `sdk-i18n.ts`. `VoiceModule.setLocale()`
  for runtime locale switch.
- **1.5 `disableBuiltinActions` semantics split** — new
  `excludeTools` and `disableAutoPauseAfterNarrate` on `WebAgentConfig`.
  Old name kept as alias with deprecation warn.
- **1.6 `ToolsRegistry.flush()`** — resolves when any in-flight
  agent turn completes, so post-flush registrations land in the next
  turn deterministically.
- **2.3 Cross-origin + auth-required failure reasons** — new
  `'cross_origin'` and `'auth_required'` variants in
  `ActionFailureReason`.

### Workflow capabilities (2.x)
- **2.1 `open_popup` action** — `window.open` + optional `waitForClose`
  polling. Returns `cross_origin` if the popup is blocked.
- **2.2 `enter_iframe` action** — same-origin iframe body-text read.
  Returns `cross_origin` for cross-origin frames so the agent narrates
  the boundary instead of trying to act inside.
- **2.4 Form widget adapter registry** — `registerFormWidget(...)`
  lets hosts plug in matchers + fillers for react-select / antd /
  headless UI widgets that hide the underlying `<input>`. Runtime
  walks adapters in priority order before the default `.value + input
  event` path.
- **2.5 `validate_form` action** — reads back browser `ValidityState`
  + `aria-invalid` + `.error` sibling messages for every input under
  a form selector. Use after `fill_input` to confirm submission will
  be accepted.
- **2.6 `runTransaction({ steps })` skill helper** — multi-step
  transaction with per-step `assert` predicates and `compensate`
  rollback handlers. On failure, runs compensators of completed
  steps in reverse order. Best-effort rollback (throwing compensator
  doesn't poison the chain).
- **2.7 `wait_until` action** — polls a selector to a `present` /
  `visible` / `absent` state, capped at 30s.
- **2.8 `detect_login_wall` action** — URL pattern + password+email
  inputs + visible OAuth-button text heuristics. Returns
  `auth_required` failure when a sign-in wall is detected so the
  agent surfaces a sign-in request rather than filling credentials.

### New tools (3.x)
- **3.1 `escalate_to_human`, `track_intent`, `summarize_page`** —
  added to `builtinActions`. (`summarize_page` is schema-only for now;
  runtime LLM hand-off lands with 1.9 streaming envelope wiring.)

### Host-experience
- **4.7 `escalate_to_human`** — action + new `agent_escalated`
  intent-stream event.

### Memory (1.1)
- **`UnifiedMemory` facade** — wraps existing `Memory` (3-tier
  structured: Core / Episodic / Semantic) + `DrawerMemory` (free-form
  drawers/wings/rooms) without breaking either. Single API:
  `remember(text, opts)` auto-routes, `recall(query)` merges from
  both backends, `buildContext(query)` returns a system-prompt block.
  Shared PII gate. Backwards compatible — v0.1 hosts using `Memory`
  or `DrawerMemory` directly keep working.

### Streaming envelope parser (1.9 — PARSER ONLY)
- `StreamingEnvelopeParser` written + smoke test passes.
- `WebAgentConfig.enableStreamingEnvelope` config flag is a no-op
  until the loop integration lands. **Next milestone — see below.**

### LLM adapters
- **Agnes AI adapter** — wraps OpenAIProvider against
  apihub.agnes-ai.com. `agnes-2.0-flash` default. Registered into
  `seedDefaultAdapters()`. Backend proxy lane + 18 RPM global throttle
  + `AGNES_API_KEY` secret pushed to live Worker.

### Ingest + Audit
- **7.1 Event schema** — `EVENT_SCHEMA_VERSION = '1.0.0'` + full
  category/props catalog in `src/ingest/schema.ts`. `makeEvent(...)`
  builder.
- **7.3 `dddk.track()` API** — emits a `custom_track` intent event.
- **7.4 Transport** — batching, retry with backoff, ordering, beacon
  on unload, queue cap. `HttpSink` / `DebugSink` / `MultiSink`.
- **10.2 + 10.3 Audit log + SHA-256 hash chain** — server-side
  (`src/lib/server/audit.ts` in dddk-frontend) — `fetchAllAuditInRange`,
  `verifyAuditChain` (recompute head hash from rows ASC), CSV/JSON
  export. `/api/v1/audit/export` + `/api/v1/audit/verify` endpoints.
  `/platform/audit` UI surfaces all three.
- **10.1 Training export** — `/api/v1/exports/{schema}.jsonl`
  endpoint with three schemas: `preferences` (prompt + chosen +
  rejected from agent_feedback), `trajectory` (sessions as event
  sequences), `sft` (prompt → response from asked/answered).

### Platform restructure (dddk-frontend)
- `/console/*` migrated to `/platform/*`. Left sidebar nav replaces
  per-page tab bar.
- 10 menu items: Profile, Dashboard, Funnels, Traces, API Keys,
  Usage, Console (dev), Training Export, Audit, Billing.
- New pages: `/platform/profile`, `/platform/usage`, `/platform/dev`
  (SDK init snippet + ingest snippet + one-click copy).
- Auth.js `signIn` callback hard-rejects non-founder emails →
  Access-denied + coming-soon hero. Defense in depth on
  `/extension/login` token mint.
- Homepage left-sidebar login pill removed (auth state no longer
  surfaces on public pages).

### Extension (dddk-extension)
- Google-OAuth bridge via `/extension/login` → token relay to SW.
- Free / Pro / Team plan + monthly call quota surfaced in popup.
- Model picker (Agnes / GPT-5.4 / DeepSeek) with Pro lock indicator.
- Per-feature toggles (agent / inline / dwell / immersive / voice /
  proactive).
- **First-install onboarding card** in popup with 4-line how-to;
  dismiss persisted in `chrome.storage.local`.
- **Smarter default toggles** — Agent / Immersive / Proactive default
  OFF (user opts in); Inline / Voice / Dwell default ON (all opt-in
  triggers, can't interrupt unannounced).
- **Proactive in extension** — generic dwell-60s prompt ("Want the AI
  to help with this page?"); Yes starts the agent with the page title.

### Misc
- v0.2.0 trim — `src/adapters/`, `src/notes/`, `src/storage/` removed
  (too aggressive abstraction without real host usage).
- Homepage forced first-visit `/introduce` removed (too aggressive
  for first-time visitors).
- Music player removed (Sidebar + palette `/music` + bgm-controller +
  mp3 asset).

---

## 🔧 Remaining for 0.2.0 release

### 1.9 Streaming agent envelope — wire parser into the loop

**This is the headline 0.2.0 UX win.** Parser is written and tested;
provider-side and loop integration are the remaining work.

- Provider: `StreamChunk` needs a `toolArgsDelta` field;
  `OpenAIProvider` (and Agnes / Google adapters) need to forward
  incremental tool-call args from the upstream SSE deltas.
- Loop: wire `StreamingEnvelopeParser` into `loops.ts` behind the
  existing `enableStreamingEnvelope` flag.
- Per-character incremental streaming — make `parseSingleAction` +
  `streamNarrateString` resumable (coroutine-style state) so a single
  string value split across `feed()` calls doesn't bail.

Acceptance: subtitle bar starts narrating Step 1 while the model is
still generating Step 2, no more "wait for full envelope to land
before anything appears".

### 1.10 Multi-vendor LLM adapter validation

Live key testing per provider (Anthropic / Mistral / xAI / Together /
Fireworks). Adapters can be code-complete but each needs at least one
verified curl + streaming round-trip before being shipped.

### Workflow 2.x prompt catalog + cookbook

The 5 new workflow actions (validate / wait_until / detect_login_wall /
open_popup / enter_iframe) are registered as builtins but the agent
prompt catalog + cookbook examples haven't been updated. Without it
the LLM doesn't discover when to use them.

### Memory unification — real-world validation

`UnifiedMemory` facade is shipped but no demo / dogfood usage yet.
Need at least one host (dddk-frontend or a showcase site) using it
end-to-end before declaring 1.1 done.

### Doc + release notes

- `/docs/v0.2.0/dddk/release-notes.md` not written.
- `migrating.md` doesn't cover excludeTools rename, ingest layer,
  workflow actions, UnifiedMemory.

---

## 🧊 Deferred from this round (was on the original draft, cut)

- **5.x Vertical adapters** (Ecommerce / FeatureIndex / Manual) —
  interfaces were prototyped then cut. Re-design when there's a real
  pilot customer in one of the verticals.
- **6.2 Notes capture** — `IndexedDBNotesAdapter` prototyped then
  cut. Quote-to-note use case wasn't crisp enough.
- **8.x Search engine runtime** — storage layer dropped (host runtime
  in dddk-frontend if needed).
- **9.x Recommendation engine runtime** — same.
- **11.x Client-side StorageBackend abstraction** — too heavy for the
  SDK. Storage lives server-side (audit log) or in host adapters.
- **4.1 Structured sitemap, 4.2 Cookbook, 4.3 Persistent memory
  backend, 4.5 Budget guard, 4.6 A/B testing prompts, 4.8 No-code
  skill builder** — all deferred to a focused host-experience
  release (probably 0.3).

---

## Sequencing for 0.2.0 release

Order in which to finish what's left:

1. **1.9 Streaming envelope loop integration** — single biggest UX
   change; do this first so every other demo / video benefits.
2. **Workflow 2.x prompt catalog + cookbook update** — small doc
   patch, makes the new actions actually discoverable to the LLM.
3. **1.10 Multi-vendor LLM live validation** — gate each adapter.
4. **0.2.0 release notes + migration guide.**
5. **Bump SDK to 0.2.0, publish to npm, tag in git, deploy
   dddk-frontend, push extension to Chrome Web Store.**
