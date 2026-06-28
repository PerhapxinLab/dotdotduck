# v0.2.0 release notes

Big release on top of v0.1.3. Adds a third agent kind, flips the action catalogue from opt-out to opt-in, takes the synthetic cursor from a click-only nicety to every interactive action, gives the planner eyes, and ships a self-hosted analytics stack.

**One breaking change**: the WebAgent's default action set shrinks from 12 to 5 (`coreActions`). Pass `customActions: builtinActions` to restore v0.1 behaviour exactly.

## TL;DR

- **TaskAgent** — third agent kind alongside WebAgent and InlineAgent. Conversation + host-defined tools, no DOM, plain protocol. `ask()` returns a string; `streamAsk()` yields chunks. Same `AgentSession` so multiple TaskAgents can share history.
- **WebAgent multi-instance + shared sessions** — `dddk.sessions` named-session registry + `dddk.agents` named-agent registry. Different agents (one persona per route) can ride the same conversation history.
- **Opt-in action bundles** — default install is `coreActions` (5: narrate / navigate / click / border / scroll_to). Pass `formActions` / `flowActions` / `extraActions` into `customActions` to opt in. Empirically every host previously trimmed half the bundled actions; opt-in surfaces the cost up front.
- **Cursor on every interactive action** — `cursorTrail: true` now covers click / border / highlight / fill_input / scroll_to / narrate-with-about. `scroll_to` swaps the cursor glyph to a mouse-wheel icon while the page scrolls.
- **Planner sees the DOM** — every planning call now receives a current-page snapshot in `hostContext`, so the planner can spot routes / links visible on the page even when the briefed sitemap missed them.
- **Navigate path validation** — the `navigate` action rejects paths not in the configured sitemap and returns the valid path list to the LLM. Stops the loop from following hallucinated routes onto 404 pages.
- **Live registry** — `webagent.registerTool` and `webagent.registerContextProvider` are now first-class, return handles with `remove()` cleanup.
- **Self-hosted analytics + mini dashboard** — `@perhapxin/dddk/analytics` (IndexedDB EventStore + CSV / NDJSON / SQL exporters + function-based schema mapper) and `@perhapxin/dddk/analytics/dashboard` (six SVG charts, EN + zh-TW, no library deps).
- **Streaming envelope dispatches per-action** — each action fires the moment its `{}` balances, not when the outer envelope closes.
- **InlineAgent scoping** — `attachScope(selector, config)` for per-region action sets.
- **`onLoopEnd` hook** — graceful loop closure: `silent` / `text` / `feedback` / `ask_user`.
- **Inline command palette + rich rows** — `palette.mountInline(host)` persistently embeds the palette without a backdrop. New `PaletteItem.lines: string[]` + `image` + `submitButton`.

## Breaking changes

### Default action set shrinks 12 → 5

**Before (v0.1.x)**: the WebAgent installed all 12 builtin actions by default. Hosts trimmed via `excludeTools`.

**After (v0.2.0)**: default install is `coreActions` — `narrate / navigate / click / border / scroll_to`. The form / flow / extra bundles are opt-in.

```ts
import { WebAgent, coreActions, formActions, flowActions, builtinActions } from '@perhapxin/dddk';

// v0.1 behaviour preserved — opt in to the union:
new WebAgent({ ..., customActions: builtinActions });

// Recommended — opt in to what you actually use:
new WebAgent({ ..., customActions: [...formActions] });
new WebAgent({ ..., customActions: [...formActions, ...flowActions] });
```

`excludeTools` still works against whatever ended up installed.

### `sessionContinuityMs` default 5 min → 0

**Before**: a follow-up `runStream()` within 5 minutes appended to the same session.

**After**: each `runStream()` starts a fresh session. Opt in to conversational follow-ups:

```ts
new WebAgent({ ..., sessionContinuityMs: 5 * 60 * 1000 });
```

Reason: most webagent usage is one-shot. Carrying prior turns into the next ask made the LLM conflate unrelated questions.

Cross-PAGE continuity (the loop staying alive across SPA navigation mid-run) is independent and unchanged.

## What changed

### TaskAgent

New `TaskAgent` class — conversational agent with host-defined tools, no DOM dependency, plain protocol (standard chat + OpenAI tool-calls). Lives alongside `WebAgent` (DOM operator) and `InlineAgent` (selection-anchored).

```ts
import { TaskAgent } from '@perhapxin/dddk';

const support = new TaskAgent({
  llm: nano,
  systemPrompt: 'Answer Acme Co. support questions in the user language.',
  tools: [{
    name: 'lookup_order',
    description: 'Order status by id.',
    parameters: { type: 'object', properties: { id: { type: 'string' } } },
    handler: async ({ id }) => fetch(`/api/orders/${id}`).then(r => r.json()),
  }],
});
support.attachTo(dddk);

const reply = await support.ask('Where is order #12345?');
```

Streaming variant for typewriter UIs:

```ts
for await (const c of support.streamAsk('Where is order #12345?')) {
  if (c.toolCallStart) showSpinner(c.toolCallStart.name);
  if (c.toolCallEnd)   hideSpinner();
  if (c.delta)         append(c.delta);
  if (c.done)          flush(c.text);
}
```

Shared `AgentSession`:

```ts
const session = dddk.sessions.get('support-thread');
const sales   = new TaskAgent({ llm, systemPrompt: 'sales', session });
const billing = new TaskAgent({ llm, systemPrompt: 'billing', session });
```

### WebAgent multi-instance + shared sessions

`dddk.sessions` is a named session registry; `dddk.agents` is a named agent registry. Register multiple `WebAgent` instances (one persona per route), inject a shared `AgentSession`, flip the active agent on route change.

```ts
const sharedSession = dddk.sessions.get('demo');

const homeAgent = new WebAgent({ ..., session: sharedSession });
const docsAgent = new WebAgent({ ..., session: sharedSession, persona: docsPersona });

dddk.agents.register('home', homeAgent, { active: true });
dddk.agents.register('docs', docsAgent);

afterNavigate(({ to }) => {
  if (to.url.pathname.startsWith('/docs')) dddk.agents.setActive('docs');
  else                                      dddk.agents.setActive('home');
});
```

`dddk.getAgent()` returns the active one; existing single-agent host code keeps working.

### Action bundles + new actions

| Bundle | Members | Default? |
|---|---|---|
| `coreActions` | `narrate`, `navigate`, `click`, `border`, `scroll_to` | ✅ on |
| `formActions` | `fill_input`, `select_option`, `clear_input`, `press_key`, `hold_key`, `double_click`, `long_press`, `drag` | opt-in |
| `flowActions` | `wait`, `pause`, `ask_user`, `ask_user_choice` | opt-in |
| `extraActions` | `highlight`, `track_intent`, `escalate_to_human` | opt-in |
| `workflowActions` | `validate_form`, `wait_until` | opt-in |

New actions:

- **`narrate({text, about?})`** — first-class action in `coreActions`. CoT runtime still intercepts the envelope shape; plain-protocol callers hit the handler.
- **`hold_key({key, ms, selector?, modifiers?})`** — push-to-talk, hold-Ctrl-multi-select, hold-to-zoom. Caps at 5s.
- **`double_click({selector})`** — fires `dblclick` (not two `click`s).
- **`long_press({selector, ms?})`** — mousedown + touchstart → wait → mouseup + touchend. Default 600ms.
- **`drag({from, to, steps?})`** — mousedown on `from`, interpolated `mousemove` events, mouseup on `to`. Also fires HTML5 drag events.
- **`press_key` extended** — new `modifiers: ('ctrl' | 'shift' | 'alt' | 'meta')[]` for chord dispatch (Ctrl+S, Cmd+K, Shift+Tab).

### Cursor on every interactive action

Synthetic cursor (`cursorTrail: true`) now covers:

- `click` / `border` / `highlight` / `fill_input` — cursor glides onto target, plays arrival pulse, action fires.
- `scroll_to` — cursor switches to a mouse-wheel glyph (`setCursorMode('scroll')`), travels along the scroll, lands on the destination, reverts to pointer.
- `narrate({about})` — synthesizes a `border` call, cursor glide piggybacks.

New runtime API:

- `moveCursorTo(el)` — glide without tapping.
- `cursorPulse()` — standalone arrival flash.
- `setCursorMode('pointer' | 'scroll' | 'reading')` — swap the SVG glyph.

`prefers-reduced-motion` honoured.

### Planner sees the DOM

The planner runs once per agent ask, before the loop starts. v0.2 also passes the current page DOM via `PlanInput.hostContext` so the planner can spot routes / links visible on the page even when the briefed sitemap missed them.

```ts
new WebAgent({ ..., plannerDomMaxLength: 8000 });
```

The per-turn DOM that the loop consumes (`domMaxLength`, default 40000) is independent.

### Navigate path validation

When the WebAgent is configured with a `sitemap`, the `navigate` action validates the requested path against the sitemap. Unknown paths get rejected with a structured error listing the valid paths; the model retries on the next turn.

```
ok: false
reason: 'navigation'
message: 'Path "/coming-soon" is not in this site\'s sitemap. The valid paths are: "/", "/try", "/docs", "/dashboard", "/platform", "/commercial". Pick one of those and retry.'
```

Without this, small models invent paths from label words and land on 404s.

### Live registry

```ts
const toolHandle = webagent.registerTool({ name, description, parameters, handler });
toolHandle.remove();

const providerHandle = webagent.registerContextProvider('selection', async (req) => {
  return renderUserSelectionAsXml();
});
providerHandle.remove();  // restores the SDK default provider
```

Six provider slots backed by SDK defaults: `url`, `page_summary`, `dom`, `screenshot`, `history`, `selection`.

### Self-hosted analytics

`@perhapxin/dddk/analytics`:

- **`EventStore`** — IndexedDB-backed local store. Default cap 50k events / 30 days. Configurable `{ cap, onFull: 'ring' | 'drop-new' | { notifyHost } }`.
- **Exporters** — `toCSV`, `toNDJSON`, `toSQL` (with `SqlSchemaMapper` for custom row shapes).
- **Canonical `dddk_events` DDL** shipped for SQLite / Postgres / MySQL.

`@perhapxin/dddk/analytics/dashboard`:

- **`renderDashboard(container, store)`** — six vanilla-SVG charts: event volume, top palette items, agent completion rate, feedback distribution, voice usage, average LLM latency.
- Inherits `--dddk-*` theme tokens; EN + zh-TW labels; optional auto-refresh.
- Hosts compose custom tiles with `lineChart` / `barChart` / `donut` / `numberTile` primitives.

New intent event: **`agent_tool_failed`** — emitted when a tool returns `{ ok: false }` or throws.

### Streaming envelope dispatches per-action

The CoT envelope is `{memory, turn_planning, actions: [a1, a2, …], is_final}`. v0.2 dispatches each action the moment its `{}` balances inside the LLM's incremental output.

```ts
new DotDotDuck({
  webAgent: { enableStreamingEnvelope: true },
});
```

Practical impact: in a multi-action turn, the first narrate streams to the subtitle while the LLM is still typing the navigate's JSON.

### InlineAgent scoping

```ts
const handle = inlineAgent.attachScope('article.editor textarea.comment', {
  actions: commentActions,
  systemPrompt: 'Be brief; this is a comment thread.',
});
handle.remove();
```

`appendActions` / `appendSystemPrompt` extend the root config; `actions` / `systemPrompt` / `llm` / `layout` / `tools` replace it. Innermost matching scope wins on the selection's anchor element. Callback fallback via `setScopeResolver` for the cases CSS selectors can't express.

### `onLoopEnd` hook

```ts
new WebAgent({
  ...,
  onLoopEnd: {
    kind: 'feedback',
    text: 'Was this helpful?',
  },
});
```

Variants: `silent`, `text` (notice that auto-hides), `feedback` (binary signal — space accepts, double-tap rejects, esc nulls), `ask_user` (closing multi-choice question).

### Inline palette + rich rows

```ts
const inline = dddk.palette.mountInline(document.getElementById('palette-host'), {
  placeholder: 'Search…',
  focus: false,
});
// Ctrl/⌘+K still works — raises the modal ON TOP of the inline surface.
inline();  // cleanup
```

`PaletteItem` gained:

- `lines: string[]` — multi-line metadata column.
- `image: string` — thumbnail URL.
- `submitButton: boolean` — circular send button at the right edge of the input.

Section ordering fix: HeatRank-promoted items no longer drag their section header to the top. Section order follows the host's registration order.

### Subtitle: click / tap = space

Touch users have had single-tap-accept / double-tap-reject since v0.1. v0.2 extends to mouse + pen pointers — clicking the subtitle surface = pressing space; double-click = double space.

### Session lifecycle hardening

- **Hard reload clears session.** `performance.getEntriesByType('navigation')[0].type === 'reload'` short-circuits the continuity check regardless of `sessionContinuityMs`.
- **`sessionContinuityMs` default 0** (see Breaking changes above).
- **Navigate path validation** rejects unknown paths.

## What's next (v0.3 roadmap)

Items consciously deferred from v0.2:

- **Cross-type session sharing with full re-serialization** — TaskAgent reading WebAgent's session already works (CoT `agent_step` turns are silently skipped); the reverse (WebAgent reading TaskAgent's plain-chat turns and re-wrapping them as CoT) is more work.
- **Multi-agent delegation** — a TaskAgent calling a WebAgent (or vice versa) via a tool. Wants real use-case validation first.
- **buildMessages migration through provider registry** — `url` / `page_summary` / `history` / `selection` / `screenshot` are consulted via providers; `dom` is still inline because `currentIndexMap` for selector resolution is coupled to the call site.
- **TaskAgent tool-args incremental streaming** — `streamAsk` already streams text deltas and toolCallStart / toolCallEnd markers; streaming the tool arguments AS the LLM types them is on the roadmap.
- **Cross-tab session share for TaskAgent** — WebAgent already crosstabs; TaskAgent currently doesn't.

## Migration cheat-sheet (v0.1 → v0.2)

```diff
- import { builtinActions } from '@perhapxin/dddk';
- new WebAgent({ ..., excludeTools: ['pause', 'wait', 'ask_user_choice'] });
+ import { coreActions, formActions } from '@perhapxin/dddk';
+ new WebAgent({ ..., customActions: [...formActions.filter(a => a.name !== 'select_option')] });

- new WebAgent({ ... });
+ new WebAgent({ ..., sessionContinuityMs: 5 * 60 * 1000 });
```

`builtinActions` still exists as the union — passing it preserves v0.1 behaviour exactly.
