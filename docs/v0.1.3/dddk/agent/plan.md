# Plan — LLM-mediated structured artifact module

> Standalone module that owns in-memory structured artifacts (todos lists, markdown documents) the LLM can read / create / edit / delete. The webagent uses it for pre-loop task planning; other host surfaces can use it for any LLM-mediated CRUD on structured content.

Opt-in. Attaches to the orchestrator the same way `InlineAgent` / `ImmersiveTranslate` do — construct with an `LLMSource`, call `attachTo(dddk)`, then wire it into whatever consumer needs it. The webagent's `planner` config field is the most common consumer.

## When to use

- **Pre-loop planning for the webagent.** A single planning call before the turn loop lays out the master todos. The webagent reads the plan as context every turn and mutates via `todo_adjust` — no more "edge-of-context wandering" where the model invents new todos mid-loop.
- **LLM-mediated authoring** of structured artifacts that aren't the webagent's job: meeting notes, draft emails, KB articles, anything where the host wants the model to write into a registered artifact rather than dump free text.
- **Cross-flow state**: artifacts persist for the lifetime of the Plan instance, and survive across reloads if you wire a storage adapter.

Don't reach for Plan when:
- You just want one-shot LLM output (a single rewrite, a single translation) — call the provider directly.
- You want the LLM to call arbitrary tools that mutate page state — that's the webagent's job, not Plan's.

## Import

```ts
import { Plan, type PlanConfig, type TaskPlan } from '@perhapxin/dddk';
```

## Minimum setup

```ts
import { Plan } from '@perhapxin/dddk';

const plan = new Plan({
  llm,                 // single LLMProvider or LLMRouter (plan role used)
  agentName: 'YourAgent',
  appendSystemPrompt: `# Sitemap mental model
- /commercial — pricing & licensing
- /try — interactive demo
- /docs — API reference

# Tour playbook
"Introduce X page" = navigate (if needed) + 2-4 narrate todos + finish.
`,
});

plan.attachTo(dddk);   // exposes dddk.plan for host-wide access

// Wire into the webagent so each run starts with a planning pass:
new DotDotDuck({
  // ...
  webAgent: {
    planner: (input) => plan.makeTodos(input),
    announcePlan: true,  // stream task_summary + wait for user Space
  },
});
```

## Why pre-loop planning

Webagent without a planner: the model decides what to do every turn while juggling DOM context, action results, and its memory of what's already been narrated. With small models (nano-class) this drifts — the model "remembers" extra todos it never wrote down, or forgets ones it did. Symptoms: repeat narration, premature `task_finish`, missed turns.

Webagent with a planner: ONE upfront LLM call (no DOM, just task + sitemap context) commits to a `task_summary` + ordered `todos[]`. Subsequent turns see the plan as context and mutate it explicitly via the new envelope:

- `turn_planning` — what THIS turn does (anchored to a todo id), and whether it's the last turn
- `todo_adjust` — `remove` ids done last turn / `replace` ids whose plan diverged from reality
- `actions` — same as before (narrate / tool / task_finish)

The model can't grow the plan mid-loop — only mutate or shrink. The webagent's behaviour stabilises because the upper bound on the run is fixed at planning time.

See the [WebAgent API doc](./api.md) for how `planner` + `announcePlan` slot into `WebAgentConfig`.

## Config

```ts
interface PlanConfig {
  llm: LLMSource;                      // single provider OR router (plan role)
  appendSystemPrompt?: string;         // strategic context — sitemap, route routing, tour playbook
  systemPrompt?: string;               // hard-replace the SDK default (rare)
  agentName?: string;                  // for the planner's self-intro
  storage?: PlanStorageAdapter;        // optional cross-reload persistence
}
```

Strategic context (sitemap mental model, "when user asks X take them to /Y" rules, tour playbook) belongs in `appendSystemPrompt`. This text is sent ONCE per agent run during planning — NOT on every per-turn call. So you can be generous with detail here; the per-turn prompt stays lean.

## Artifacts

A `Plan` instance owns two artifacts. Both expose CRUD; both fire `onChange` when mutated; both can be persisted via the optional storage adapter.

### `plan.todos` — `TodosArtifact`

```ts
interface TodoItem {
  id: string;                          // 't1', 't2', ... — assigned on create
  intent: 'navigate' | 'narrate' | 'click' | 'fill' | 'ask' | 'finish' | string;
  description: string;                 // user-facing — what the user perceives
  expected_turn?: number;              // planner's prediction (1-based)
}

plan.todos.list(): TodoItem[];
plan.todos.get(id: string): TodoItem | null;
plan.todos.create(item: Omit<TodoItem, 'id'>): TodoItem;
plan.todos.createMany(items: Array<Omit<TodoItem, 'id'>>): TodoItem[];
plan.todos.edit(id: string, patch: Partial<TodoItem>): TodoItem | null;
plan.todos.delete(id: string): boolean;
plan.todos.reset(items?: TodoItem[]): void;     // wipe + reseed
```

The webagent doesn't call these methods directly — the runtime translates `todo_adjust.remove` to `delete(id)` and `todo_adjust.replace` to `edit(id, patch)`. Host code can call them too if it needs to inspect or seed todos for non-webagent flows.

### `plan.markdown` — `MarkdownArtifact`

```ts
interface MarkdownDoc {
  id: string;                          // 'm1', 'm2', ... — assigned on create
  title: string;
  content: string;
  updatedAt: number;                   // ms epoch — set on create + every edit
}

plan.markdown.list(): MarkdownDoc[];
plan.markdown.read(id: string): MarkdownDoc | null;
plan.markdown.create(input: { title; content }): MarkdownDoc;
plan.markdown.edit(id: string, patch: { title?; content? }): MarkdownDoc | null;
plan.markdown.editWithInstruction(id: string, instruction: string): Promise<MarkdownDoc | null>;
plan.markdown.delete(id: string): boolean;
```

`edit` is a direct overwrite (host knows the new content). `editWithInstruction` is the LLM-mediated path — pass an instruction like "shorten the third paragraph to one sentence", the model rewrites against the current content and returns the new doc. Uses the same Plan-level `llm` source (`plan` role).

Not used by the webagent. Built for host surfaces that want LLM-mediated authoring (a notes editor, a draft composer) without re-implementing the prompt-edit loop.

## `makeTodos(input)` — the planning call

```ts
interface PlanInput {
  task: string;                        // user's original ask
  sitemap?: SitemapConfig;
  brand?: BrandPrompt;
  persona?: PersonaInput;
  locale?: string;                     // BCP-47 — controls task_summary language
  selection?: SelectionContext;        // user's Dwell / drag selection at invocation
  hostContext?: string;                // free-form extra context
}

const plan: TaskPlan = await plan.makeTodos(input);

interface TaskPlan {
  task_summary: string;                // one short sentence in user's language
  todos: TodoItem[];                   // ordered, ids assigned
}
```

The returned `todos` are also seeded into `plan.todos` (calling `reset(todos)`), so the artifact is up-to-date the moment the call returns.

Failure mode: if the planner returns unparseable JSON (small models occasionally do), `makeTodos` throws. When wired as the webagent's `planner`, the webagent emits an `error` AgentEvent and the run halts — fail-loud, no silent degradation. The host decides whether to retry or fall back to non-planned mode.

## Storage adapter — cross-reload persistence

Same shape as ImmersiveTranslate's `cache` option:

```ts
interface PlanStorageAdapter {
  load(): Promise<PlanSnapshot | null> | PlanSnapshot | null;
  save(snapshot: PlanSnapshot): Promise<void> | void;
}

interface PlanSnapshot {
  todos: TodoItem[];
  markdownDocs: MarkdownDoc[];
}
```

Hydration happens lazily on the first `attachTo(dddk)` call. Persistence happens after every artifact mutation (debouncing is on the host).

```ts
new Plan({
  llm,
  storage: {
    load: () => {
      const raw = localStorage.getItem('plan-snapshot');
      return raw ? JSON.parse(raw) : null;
    },
    save: (snap) => localStorage.setItem('plan-snapshot', JSON.stringify(snap)),
  },
});
```

## Failure handling

- **Planning LLM call fails (timeout, network, parse)**: `makeTodos` throws. The webagent surfaces an `AgentEvent { kind: 'error' }` and halts. No automatic fallback — host decides next step. (The SDK position: fallback policy is a host concern, not a module concern; see also the `onLoopEnd` design philosophy.)
- **`todo_adjust.remove` references an id that no longer exists**: silently ignored (the runtime filters by predicate).
- **`todo_adjust.replace` references an id that no longer exists**: silently ignored.
- **No `todo_adjust.insert`**: deliberately absent. The master plan is locked at run start; mid-loop the model can only `remove` (mark done) or `replace` (rewrite a wrong todo in place). If the original plan was wildly wrong, the model chains `replace` calls to morph existing entries. This forces accountability at planning time and prevents the "plan grows forever" pathology.

## See also

- [WebAgent API — `planner` + `announcePlan`](./api.md#config)
- [LLM router — `plan` role](../llm/router.md)
- [Agent overview](./overview.md)
