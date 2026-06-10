# v0.1.1 release notes

Internal refactor + bug fix release. **No breaking changes for hosts on v0.1.0** — every API shape on 0.1.0 still resolves. New surfaces are additive; behavioural changes are tightened defaults.

## TL;DR

- Memory v1 — three-tier hybrid (`core` / `episodic` / `semantic`) wired into the agent loop
- WebAgent envelope tightened — `turn_planning` collapsed to 2 fields, `task_finish` action retired in favour of turn-level `is_final`
- LLM router collapsed from 5 axes to 4 (`webagent` / `vision` / `utility` / `plan`)
- New `WebAgentConfig.disableConfirmations` for non-destructive sites
- New `navigate.note` arg for host-voiced confirm copy
- 14 P0 bug fixes + 6 security tightens + a dozen oversized files split for maintainability
- `Memory` (verbatim drawer + BM25) is now `DrawerMemory`; old name kept as a deprecated alias

## Memory v1

Opt-in three-tier hybrid attached at construction:

```ts
import { DotDotDuck } from '@perhapxin/dddk';

const dddk = new DotDotDuck({
  memory: {
    core: { schema: { language: 'string', tone: 'string' } },
    episodic: { enabled: true, replayTopK: 3 },
    semantic: { provider: myVectorStore }, // host wires
    privacy: { requireConsent: true, retentionDays: 90 },
  },
});
```

- **core** — structured user profile, always in context. Byte cap + schema enforcement + PII filter.
- **episodic** — ring buffer of past session summaries. Replays top-K on each new run.
- **semantic** — host wires a `MemoryProvider` (vector store, KG, whatever). SDK does not embed or persist.

When attached, `dddk.memory.buildContext(task)` runs on every `startAgent` and prepends the resolved context to the task. Disabled by default.

The legacy `Memory` class (verbatim drawer store with BM25) is now `DrawerMemory` — the old name still exports as an alias for 0.1.0 hosts.

## WebAgent envelope

The CoT envelope is tighter:

```diff
 {
   memory: string,
   turn_planning: {
-    last_turn_outcome: string,
-    current_page_observation: string,
-    this_turn_does: string,
-    will_finish_this_turn: boolean,
+    evaluation_previous_goal: string,
+    next_goal: string,
   },
   todo_adjust?: { remove?, replace? },
   actions: [
     { narrate, about } | { tool, args }
-    | { task_finish: true }
   ],
+  is_final?: boolean,
 }
```

**What changed**
- `current_page_observation` removed — duplicated the DOM dump that already sits in the user message
- `will_finish_this_turn` removed — duplicated the actions[] end signal
- `task_finish` action removed — moved to turn-level `is_final` boolean, schema-ordered AFTER actions so the model commits to its work plan before declaring done

**Back-compat**
- Parser folds legacy `{task_finish: true}` and `will_finish_this_turn: true` into the parsed `is_final`
- Legacy field names `last_turn_outcome` / `this_turn_does` still parse — promoted to new names internally
- Existing hosts on 0.1.0 see no behavioural difference unless they read the parsed envelope shape directly

**Reaction-requiring tools**
A new safety net: when a turn runs `navigate` / `ask_user` / `ask_user_choice`, `is_final` is automatically dropped on that turn. The result has to be observed before the run can claim done. Logged as a warning.

## LLM router 4-axis

```diff
 {
   webagent: provider,
-  webagentWithSelection?: provider,
-  inline?: provider,
-  voiceCleanup?: provider,
+  vision?: provider,
+  utility?: provider,
   plan?: provider,
 }
```

`vision` is now a capability fallback (image messages route here, else fall back to `webagent`). `utility` covers everything short-and-single-shot — inline AI rewrites, voice transcript cleanup, immersive translate.

Old field names still work via fallback chain. New hosts should write the new names.

## New WebAgentConfig flags

### `disableConfirmations: boolean`

Global switch — when true, no tool call ever pauses for user confirmation, even ones marked `requireConfirmation: true`. Use on demo / docs / read-only sites where the confirm pause feels like friction:

```ts
new DotDotDuck({
  webAgent: {
    disableConfirmations: true,
  },
});
```

Per-action `requireConfirmation: true` is still respected for the default destructive-pattern auto-gate when this flag is unset.

### `navigate.note` arg

The model can now pass natural-language confirm copy directly with each `navigate` call:

```json
{ "tool": "navigate", "args": { "path": "/commercial", "note": "我帶您看商業合作方案" } }
```

When `note` is present (and trimmed non-empty), it replaces the SDK default confirm message. Fallback chain remains: per-action override → host `buildConfirmMessage` → SDK default.

## Bug fixes (14)

P0 logic bugs that survived 0.1.0:

- `tts-provider` empty-array cache stuck "no voices" forever
- `analytics` flush key mismatch left IndexedDB offline buffer growing without bound
- `immersive-translate` failed block's `pending` attribute never reset → permanent skip on retry
- `dom-utils.walk` was BFS instead of DFS → markdown serialization order didn't match DOM
- `mobile.bindTrigger` listener leak (inline arrow registered, named function removed)
- `command-palette.renderDetailFor` async race on rapid arrow-key cycling
- `orchestrator.startAgent` image-attach branch missed `beginAgentRun()` — all downstream intents dropped silently
- `search.SearchStore.remove` field-stats bookkeeping used wrong length, BM25 `avgFieldLen` drifted
- `search.lowConfHook` threshold check defaulted to 0, so the hook never fired
- `recommend.init` treated empty array as truthy, so bootstrap never ran on legitimate empty state
- `skills.evals.resolvePrompt` missing regex escape on variable name
- `Sidebar.svelte` SSR-unsafe `onDestroy` audio handling
- `proactive` dismiss-penalty checked the wrong field — "shown recently" misread as "dismissed recently"
- `dom-renderer.repaint` blew input focus on every keystroke

## Security

Six API tightens (worker side):

- `metrics/*` endpoints require `ADMIN_TOKEN` when set; `export` requires it unconditionally
- `events` Origin parsing now try/catch — malformed `Origin` header no longer 500s
- `events` rate limit falls back to `cf-connecting-ip` when `visitor_id` is missing
- `llm/image` prompts capped at 4000 chars
- CSV export escapes leading `= + - @` (Excel formula injection)
- `metrics/overview` sparkline moved from JS-side bucket-by-day to SQL `GROUP BY day` — avoids OOM on long ranges

## Internal refactors

These don't change any public API. Listed for contributors:

- `command-palette.ts` (2216 → 7 files in `command-palette/`)
- `orchestrator.ts` (1897 → 7 files in `orchestrator/`)
- `webagent.ts` (1810 → main 444 + 4 files in `webagent/runtime/`)
- `subtitle.ts` (1774 → 9 files in `subtitle/`)
- `ui/pieces/builtin.tsx` + `dom-renderer.ts` (1621 → 18 files in `pieces/builtin/` + `pieces/dom/`)
- `UI_ATTR` deduplicated across 8 sites into `utils/dom.ts`
- `formatElementSignature` deduplicated across 3 sites into `utils/dom.ts`
- `tones` / button variants / base input style deduplicated across React + DOM renderers
- JSON Pointer (`readPointer` / `applyPointer`) deduplicated across both piece renderers
- Frontend: `escapeHtml`, `IMMERSIVE_LANGUAGES`, `tr(loc, en, zh)` helpers centralised

## Deprecated (still exported, will warn in 0.2)

- `LLMRouter.webagentWithSelection` — use `vision`
- `LLMRouter.inline` — use `utility`
- `LLMRouter.voiceCleanup` — use `utility`
- `createMemory()` / `Memory` (verbatim BM25 store) — renamed `DrawerMemory` / `createDrawerMemory`. Old names still resolve.

See [migrating](./migrating.md) for the migration walkthrough.
