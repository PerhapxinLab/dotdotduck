# Migrating to v0.2.x

This page covers upgrading from any v0.1.x to v0.2.x. The 0.1 → 0.2 jump has **one breaking change** (the WebAgent action catalogue flips from opt-out to opt-in) and one **default value change** (session continuity now defaults to 0). Everything else is additive.

**Estimated migration time**: 15 minutes if your host uses the default action set unchanged. 30 minutes if you were passing `disableBuiltinActions`.

## 1. Update the package

```bash
pnpm add @perhapxin/dddk@0.2.1
```

## 2. Breaking — WebAgent action catalogue is opt-in now

**Before (v0.1.x)**: the WebAgent installed all 12 builtin actions by default. Hosts trimmed the set with `excludeTools` / `disableBuiltinActions`.

**After (v0.2.x)**: default install is `coreActions` (5): `narrate`, `navigate`, `click`, `border`, `scroll_to`. Everything else is opt-in via `customActions`.

### Fast path — restore v0.1 behaviour exactly

Pass `builtinActions` (still exported as the union) to `customActions`:

```diff
-import { WebAgent } from '@perhapxin/dddk';
+import { WebAgent, builtinActions } from '@perhapxin/dddk';

 new WebAgent({
   ...,
+  customActions: builtinActions,
 });
```

Your existing `excludeTools` / `disableBuiltinActions` still work — they now operate on `builtinActions` post-union.

### Recommended path — opt into what you actually use

The reason v0.2 made this change: hosts empirically trimmed half the bundled catalogue. Opt-in surfaces the cost upfront and shrinks the prompt.

```ts
import {
  WebAgent,
  coreActions,       // narrate · navigate · click · border · scroll_to
  formActions,       // fill_input · select_option · clear_input · press_key · hold_key · double_click · long_press · drag
  flowActions,       // wait · pause · ask_user · ask_user_choice
  extraActions,      // highlight · track_intent · escalate_to_human
} from '@perhapxin/dddk';

new WebAgent({
  ...,
  // A read-only marketing / docs surface — the default is enough.
  // If you need to type into fields, add formActions:
  customActions: [...formActions],
  // Conversational agent that pauses for user input:
  // customActions: [...formActions, ...flowActions],
});
```

### `disableBuiltinActions` → `excludeTools`

`disableBuiltinActions` is deprecated. Rename in place — same shape (`string[]` of action names), same behaviour:

```diff
 new WebAgent({
-  disableBuiltinActions: ['wait', 'pause'],
+  excludeTools: ['wait', 'pause'],
 });
```

A one-line console warning fires when you pass the old name; removed in v0.3.

## 3. Behavioural default change — `sessionContinuityMs`

**Before**: a follow-up `runStream()` within 5 minutes appended to the same session (the LLM saw prior turns).

**After**: default is `0` — each `runStream()` starts a fresh session.

Reason: most webagent usage is one-shot ("how do I X?", answer, done). Carrying prior turns into a new ask made the LLM conflate unrelated questions.

If you're building a conversational agent (chat-style follow-ups) opt back in:

```ts
new WebAgent({
  ...,
  sessionContinuityMs: 5 * 60 * 1000,
});
```

Cross-PAGE continuity (the loop staying alive across SPA navigation mid-run) is independent and unchanged.

## 4. Additive — new agent kinds and APIs

None of this is required, but if you want to use v0.2's new features:

### TaskAgent

Third agent class alongside WebAgent and InlineAgent. Conversation + host-defined tools, no DOM.

```ts
import { TaskAgent } from '@perhapxin/dddk';

const support = new TaskAgent({
  llm: nano,
  systemPrompt: 'Answer support questions.',
  tools: [{ name: 'lookup_order', description: '...', parameters: {...}, handler: ... }],
});
const reply = await support.ask('Where is my order?');
```

### Multi-instance WebAgent + shared sessions

Register multiple WebAgent instances (one persona per route) and flip the active one on route change:

```ts
const shared = dddk.sessions.get('demo');
const home = new WebAgent({ ..., session: shared });
const docs = new WebAgent({ ..., session: shared, persona: docsPersona });
dddk.agents.register('home', home, { active: true });
dddk.agents.register('docs', docs);
afterNavigate(({ to }) => dddk.agents.setActive(to.url.pathname.startsWith('/docs') ? 'docs' : 'home'));
```

### Live tool + provider registry

```ts
const toolHandle = webagent.registerTool({ name, description, parameters, handler });
toolHandle.remove();

const providerHandle = webagent.registerContextProvider('selection', async (req) => renderSelectionXml());
providerHandle.remove();  // restores SDK default provider
```

Six provider slots: `url`, `page_summary`, `dom`, `screenshot`, `history`, `selection`.

### Cursor on every interactive action

`cursorTrail: true` used to fire only on `click`. Now it covers `click` / `border` / `highlight` / `fill_input` / `scroll_to` / `narrate-with-about`. Same config, wider coverage — no changes needed.

### New actions in `formActions`

- `double_click` — real `dblclick` event, for handlers bound to `ondblclick`
- `long_press` — mousedown + touchstart → wait → mouseup + touchend
- `drag` — from element A to element B, HTML5 drag events included
- `hold_key` — keydown → wait → keyup, for push-to-talk / hold-Ctrl-multi-select
- `press_key` extended with `modifiers: ('ctrl' | 'shift' | 'alt' | 'meta')[]` for chord dispatch (Ctrl+S / Cmd+K / Shift+Tab)

### Self-hosted analytics

```ts
import { EventStore, toCSV, toSQL } from '@perhapxin/dddk/analytics';
import { renderDashboard } from '@perhapxin/dddk/analytics/dashboard';
```

IndexedDB-backed local event store + CSV/NDJSON/SQL exporters + a 6-chart mini dashboard.

## 5. v0.2.0 → v0.2.1

Patch release, no code changes required.

If you want to opt OUT of the new inline-diff preview (per v0.2.1's default `displayAs: 'inline-diff'`) and keep the v0.2.0 instant-splice behaviour:

```ts
new InlineAgent({ ..., defaultDisplayAs: 'replace' });
```

Or per-action:

```ts
{ id: 'translate', label: 'Translate', displayAs: 'replace', ... }
```

## 6. Coming from v0.1.2 or earlier

Read the v0.1.2 → v0.1.3 and v0.1.1 → v0.1.2 guides too — each step is small but they're cumulative.
