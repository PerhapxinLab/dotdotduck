# webagent — Public API

## Install

```bash
npm install @perhapxin/dddk
```

## Minimum example

```ts
import { WebAgent, OpenAIProvider } from '@perhapxin/dddk';

const agent = new WebAgent({
  llm: new OpenAIProvider({ apiKey: 'sk-...' }),
  locale: 'zh-TW',
});

agent.on('subtitle', (text) => console.log('Agent:', text));
agent.on('done', () => console.log('Done'));

await agent.run('Change the title to "Annual Report"');
```

## Main class

### `WebAgent`

```ts
class WebAgent {
  constructor(config: WebAgentConfig);

  // Control
  run(task: string, options?: RunOptions): Promise<void>;
  resume(): Promise<void>;          // pick up a persisted session
  stop(): void;
  destroy(): void;                  // unmount everything (call on host teardown)
  isRunning(): boolean;

  // Session
  getSession(): AgentSession | null;
  clearSession(): void;

  // Tool registry (lets the host add an action after construction)
  registerAction(action: ActionDefinition): void;

  // Host-interaction reply — call after the agent emits `ask_user`
  // or `ask_user_choice` to deliver the answer back to the loop.
  respond(answer: string | Record<string, unknown>): void;

  // Events (EventEmitter API)
  on<E extends AgentEventName>(event: E, handler: AgentEventHandler<E>): void;
  off<E extends AgentEventName>(event: E, handler: AgentEventHandler<E>): void;
}
```

### Config

```ts
interface WebAgentConfig {
  llm: LLMSource;            // LLMProvider OR LLMRouter — see llm/providers
  locale?: string;           // BCP-47 (e.g. 'en', 'zh-TW', 'ja-JP'). Used as a
                             // DEFAULT reply language for ambiguous user input
                             // (greetings, URLs, single emoji). When the user
                             // writes a clear sentence, the model replies in
                             // that language regardless of this hint. Defaults
                             // to navigator.language.
  maxSteps?: number;         // default 30 — hard cap on tool-call iterations per task
  maxErrors?: number;        // default 3 — consecutive LLM-call failures before bailing
  llmTimeoutMs?: number;     // default 60_000 — single LLM call hard timeout

  // Reasoning budget for the per-step LLM call. Default 'off' — action
  // selection on a fixed registry doesn't benefit from reasoning, and
  // skipping it saves 5-8s per turn on reasoning-capable models
  // (gpt-5 / o-series / Gemini 3.x). Models without a reasoning mode
  // ignore the flag. Set 'low' / 'medium' / 'high' for custom actions
  // that need the model to think harder before picking one.
  thinking?: 'off' | 'low' | 'medium' | 'high';

  // Prompt layering — see prompt-design
  brand?: BrandPrompt;                 // structured product context (recommended)
  persona?: string | PersonaConfig;    // first-person identity ("you ARE X, speak as 'we'")
  appendSystemPrompt?: string;         // free-form paragraph appended after default
  systemPrompt?: SystemPromptOverride; // string (hard replace) or fn(ctx, default) => string

  sitemap?: SitemapConfig;             // SitemapEntry[] OR SitemapNode tree
  agentName?: string;                  // display name (defaults to 'Agent')
  siteName?: string;
  customActions?: ActionDefinition[];  // host-registered actions

  // Pre-loop planning callback — when set, the webagent makes a single
  // planning call BEFORE the turn loop, stores the returned TaskPlan on
  // the session, and switches the per-turn envelope to the planned
  // variant (turn_planning + todo_adjust + actions, no todos_remaining).
  // Typical wiring is `(input) => plan.makeTodos(input)` where `plan` is
  // a `Plan` instance — see the [Plan module doc](./plan.md).
  planner?: (input: PlanInput) => Promise<TaskPlan>;

  // When true (and `planner` is set), the planner's `task_summary` is
  // streamed to the subtitle bar BEFORE turn 1, then the runtime waits
  // for the user to press Space before proceeding. Default false.
  announcePlan?: boolean;
  // Per-action description overrides — applied at tool-build time.
  // Keys are action names; `description` replaces, `appendDescription`
  // is appended after the SDK default with a newline. See prompt-design.
  actionOverrides?: Record<string, { description?: string; appendDescription?: string }>;
  sessionStorageKey?: string;          // default 'webagent.session'
  toolDefinitions?: ToolDefinition[];  // advanced: override the tool list
  crossTabSync?: boolean;              // default false — see session-continuity

  // Session continuity — multi-turn follow-ups append to the existing
  // session within this window (ms). Pass `0` to disable continuity so
  // each `runStream()` starts fresh. Default 5 * 60 * 1000.
  sessionContinuityMs?: number;
  // `'time'` honours `sessionContinuityMs`; `'palette'` ends continuity
  // when the palette closes (host signals via `dddk.endAgentContinuity()`).
  sessionScope?: 'time' | 'palette';

  // History capping — drop oldest turns when the prompt grows. Both
  // optional; combine for layered safety. See dom-format / prompt-design.
  maxTurnsInPrompt?: number;           // hard count cap
  maxPromptTokens?: number;            // estimated-tokens cap (chars / 3.5)

  // DOM dump shaping — see dom-format for the indexed `[N]<tag>` format.
  // domFilter: drop matching elements + their subtree from the dump.
  // domMaxLength: char cap on the dump before truncation (default ~12000).
  domFilter?: (el: Element) => boolean;
  domMaxLength?: number;

  // Custom destructive-action patterns. Names matching these regexes
  // auto-gate on `confirm`. Empty array disables the built-in pattern
  // list and relies solely on per-action `requireConfirmation`.
  destructivePatterns?: RegExp[];

  // Subtitle-bar fallback when the `pause` tool is called with no `note`.
  // SDK default is English ('Press space to continue'). Hosts pass their
  // own string here for a localised UX.
  defaultPauseNote?: string;

  // Optional visual snapshot attached to every LLM turn. Disabled by
  // default. `true` is shorthand for `{ mode: 'viewport' }`. See
  // ./screenshot.md for full options (modes, segment height, custom
  // capture function).
  screenshot?: boolean | ScreenshotConfig;

  // What happens when the agent loop ends (CoT `actions: []` / classic-
  // mode no-tool-call turn / maxSteps cap). Without this the subtitle
  // bar just disappears, which reads as broken. See OnLoopEnd below.
  // SDK default is `{ kind: 'text', text: '✓ Done', autoHide: 3000 }`.
  onLoopEnd?: OnLoopEnd;

  // Names of built-in actions to NOT expose to the agent. Default set
  // is broad (navigate / scroll_to / wait / click / fill_input /
  // select_option / clear_input / border / pause / ask_user /
  // ask_user_choice) so any host works out of the box; sites with a
  // narrow surface trim the list here to shrink the schema the LLM
  // sees and remove "wrong tool" failure modes. See actions/catalog.
  disableBuiltinActions?: string[];
}

type OnLoopEnd =
  // Legacy "subtitle disappears" behaviour.
  | { kind: 'silent' }
  // Stream a final closing line (e.g. "✓ Done") then dismiss after autoHide ms.
  | { kind: 'text'; text: string; autoHide?: number }
  // Closing line + Space (satisfied) / double-tap (not satisfied) gestures.
  // Bar is `persistent: true` — no auto-dismiss, no Esc, no outside-click
  // close. User must accept or reject. Either choice fires `agent_feedback`
  // on the intent stream with `satisfied: true | false`.
  | { kind: 'feedback'; text: string }
  // Option picker (e.g. 1-5 rating). The picked value goes into
  // `agent_feedback.summary`. Same persistent behaviour as feedback.
  | { kind: 'ask_user'; question: string; options: Array<{ value: string; label: string }> };

interface SitemapEntry {
  path: string;
  description: string;
  aliases?: string[];        // optional natural-language synonyms ("settings page" → /preferences)
}
```

`SitemapConfig` accepts either a flat `SitemapEntry[]` (simple sites) or a `SitemapNode` tree (recommended once you have more than ~8 pages — see [sitemap/tree](./sitemap/tree.md)).

## RunOptions

```ts
interface RunOptions {
  /** What the user had selected when they invoked the agent. */
  selection?: SelectionContext;
}

interface SelectionContext {
  /** Selected text content (if any). */
  text?: string;
  /** Selected images as base64 / URL (if any). */
  images?: string[];
  /** Bounding box of the selection on the page. */
  bbox?: { x: number; y: number; width: number; height: number };
  /** CSS selectors / DOM paths the user clicked or multi-selected. */
  elements?: string[];
}
```

When the host invokes the agent in response to a user gesture that involved a target (long-press on a paragraph, lasso over a chart region, click on a row), populate `selection` so the LLM has the context.

| Field | When the host should fill it |
|---|---|
| `text` | User had a text selection (`getSelection().toString()`), or long-pressed an element — pass its visible text. |
| `images` | User selected / dropped an image. base64 data-URLs or fetchable URLs both work — the LLM provider handles upload. |
| `bbox` | Drag-to-lasso, screenshot crop, or "ask about this region of the page" gestures. Coordinates are page-relative. |
| `elements` | User clicked one or more elements (Dwell long-press, Spotter ring, multi-select). Pass CSS selectors that resolve on the current page. |

The agent serialises the selection into a `# User selection at invocation` block in the system prompt — the LLM sees it as primary context for the task. If `llm` is an `LLMRouter` with a `webagentWithSelection` provider, that cheaper model is used for the run (selection-driven tasks tend to be one-shot summaries / clarifications that don't need the top-tier model).

```ts
// Long-press on a paragraph → "summarise this"
await agent.run('Summarise this clause', {
  selection: {
    text: 'Either party may terminate this agreement with 30 days notice…',
    elements: ['#clause-4'],
  },
});

// Lasso a chart region → "what's the anomaly here?"
await agent.run('What is the anomaly in this region?', {
  selection: {
    bbox: { x: 240, y: 480, width: 360, height: 220 },
    images: ['data:image/png;base64,iVBORw0KGgo...'],
  },
});
```

## Events

Every event listed below fires from the live agent loop. Handlers are invoked synchronously in registration order; for events whose payload includes a `resolve` / `decide` callback (`ask_user`, `confirm_action`), the loop pauses until the host invokes that callback.

| Event | Payload | Fires when |
|---|---|---|
| `status` | `AgentStatus` (`'idle' \| 'thinking' \| 'executing' \| 'waiting' \| 'done' \| 'failed'`) | Status transitions. |
| `before_action` | `{ actionName: string; params: Record<string, unknown>; targetSelector?: string }` | After the LLM picks an action but before the handler runs. Lets visual layers (agent cursor, action overlay) preview the target with a beat for user awareness. Informational only — no decision needed. |
| `step` | `AgentStep` | Each completed action (success or failure). |
| `subtitle` | `string` | Agent emitted free-form text between tool calls. There is no `show_subtitle` tool — text the LLM produces between tool calls streams character-by-character into the subtitle bar via this event. |
| `piece_surface` | `{ surface: PieceSurface; placement: PiecePlacement }` | dddk forwards a host-opened Piece surface into the agent context so the loop knows what's on screen. |
| `ask_user` | `{ question: string; resolve: (answer: string) => void }` | Agent calls the built-in `ask_user` action. The loop is in `waiting` until the host calls `resolve` OR calls `agent.respond(...)`. |
| `ask_user_choice` | `{ question: string; options: string[]; allowFreeText?: boolean; resolve: (answer: string) => void }` | Agent calls the built-in `ask_user_choice` action. Host should render a discrete option picker (we recommend [`Subtitle.showChoice`](../modules/subtitle.md#multi-choice-picker-showchoice) from dddk) and call `agent.respond(chosenValue)` with the user's pick — the canonical option string for a listed pick, OR the user's typed string when `allowFreeText` is true and they used the free-text slot. Same `waiting` semantics as `ask_user`. |
| `confirm_action` | `{ actionName: string; params: Record<string, unknown>; message: string; decide: (approved: boolean) => void }` | Before any action when `confirmEachStep: true` is set, OR before an action whose `requireConfirmation` is true. Host MUST call `decide(boolean)` — `decide(false)` stops the loop with a "stopped by user" status. |
| `overlay_update` | `OverlayItem[]` | `border` / `highlight` / `inject` overlay items are added, changed, or removed. Pass the full current list. Calling `border` or `highlight` auto-clears any prior overlay — there is no separate `clear_overlays` action. |
| `navigate` | `{ path: string }` | Agent wants to change page. The host owns navigation — call `router.push(path)` so SPA routing stays intact. |
| `error` | `Error` | Any error in the loop (LLM call, tool execution, parse). Counts toward `maxErrors`. |
| `done` | `AgentSession` | Loop finished (status is `done` OR `failed`). Persisted session is included. |

### `ask_user` / `ask_user_choice` — the events that yield control back to the host

Among all events, only `ask_user`, `ask_user_choice`, and `confirm_action` (when enabled) pause the agent loop and require a host callback. Everything else is fire-and-forget. Both `ask_user` and `ask_user_choice` resolve the same pending promise — call `agent.respond(value)` (or invoke the payload's `resolve(value)` directly) with a string and the loop continues with that string delivered to the LLM as the tool result.

Structured UI is handled by dddk's Pieces system, which forwards mounted surfaces into the agent context via `piece_surface` (informational). When the host submits a form, it calls `agent.respond(data)` to push the submitted payload back to the LLM as a tool result.

## Interaction examples

### 1. ask_user (free-form question)

```ts
agent.on('ask_user', ({ question, resolve }) => {
  const answer = window.prompt(question);
  resolve(answer ?? '');
});
```

Either call `resolve` directly inside the handler (synchronous prompt), OR call `agent.respond(answer)` later (asynchronous UI flow — your custom dialog mounts, user submits, you call `respond`). Both routes resolve the same pending promise.

### 2. Surface (structured form / dialog)

Structured UI is not rendered by the agent itself — the host opens a Surface via dddk's Pieces system (e.g. `dddk.tools.surface(...)`). If webagent is running alongside dddk, dddk forwards the Surface into the agent context as a `piece_surface` event so the loop knows what's on screen:

```ts
agent.on('piece_surface', ({ surface, placement }) => {
  yourRenderer.mount(surface, placement, {
    onSubmit: (data) => agent.respond(data),
    onCancel: ()      => agent.respond(''),
  });
});
```

When integrating via `@perhapxin/dddk`, the host typically subscribes to dddk's `surface` event instead — that path uses `PieceRenderer` and submits via `dddk.submitSurface(data)`. See [dddk's Surface renderer](../surfaces/renderer.md) for the full flow.

### 3. Subtitle / overlay

```ts
agent.on('subtitle', (text) => {
  myUI.showBottomBar(text);
});

agent.on('overlay_update', (items) => {
  myUI.renderHighlights(items);
});
```

### 4. confirm_action (step-by-step mode or destructive actions)

```ts
agent.on('confirm_action', ({ actionName, message, decide }) => {
  // Wire to the subtitle bar: space = accept, double-tap / Esc = reject.
  myUI.showConfirm(message, {
    onAccept: () => decide(true),
    onReject: () => decide(false),
  });
});
```

The agent loop blocks until `decide` is called. Reject (`decide(false)`) stops the loop gracefully with status `done` and a `(stopped by user)` summary — it is not an error.

### 5. before_action (target preview)

```ts
agent.on('before_action', ({ actionName, targetSelector }) => {
  if (targetSelector) {
    myCursor.moveTo(document.querySelector(targetSelector));
  }
});
```

Use this to animate an agent cursor or briefly flash the target element so the user can see what's about to happen.

## Navigation hook

The agent never calls `location.href` directly when it wants to change page — it emits `navigate` and lets the host pick the right router:

```ts
agent.on('navigate', ({ path }) => {
  router.push(path);  // Next.js / SvelteKit / React Router
});
```

This keeps SPA navigation intact (no full page reload) and lets the host gate the navigation if needed (auth, unsaved-changes warning, etc.).

## Custom actions

```ts
agent.registerAction({
  name: 'add_to_cart',
  description: 'Add a product to the shopping cart',
  parameters: {
    type: 'object',
    properties: { productId: { type: 'string' } },
    required: ['productId'],
  },
  handler: async ({ productId }) => {
    await fetch('/api/cart/add', {
      method: 'POST',
      body: JSON.stringify({ productId }),
    });
    return { ok: true };
  },
  requireConfirmation: true,        // prompts the user via confirm_action
  confirmationMessage: (p) => `Add ${p.productId} to cart?`,
});
```

Actions can be registered up-front via `config.customActions` or added later via `agent.registerAction(...)`. Once registered, the LLM sees them in the tool list and may call them on its own.

### `executeAction` — when the host invokes an action directly

Most of the time the LLM drives action execution through the agent loop. There are two cases where the host wants to invoke an action directly:

1. **Deterministic shortcuts** — a hotkey or palette command that should always do the same thing without a round-trip through the LLM.
2. **Replay / scripted tests** — running an action handler with known params for testing.

For these, look up the registered definition and call its handler with a synthetic `ActionContext`:

```ts
// Find the registered action
const def = agent.actions?.get?.('add_to_cart');
if (def) {
  const result = await def.handler(
    { productId: 'SKU-42' },
    {
      session: agent.getSession()!,
      signal: new AbortController().signal,
      emit: (event, payload) => agent.emit?.(event, payload),
    },
  );
}
```

Under the hood, the agent loop also routes through the same `executeAction` helper — see `src/agent/webagent/execute-action.ts`. Note that the built-in `ask_user` and `ask_user_choice` actions have special handling in that helper (they register a pending resolver and wait for `agent.respond(...)`); if the host calls a handler directly outside the loop, those won't have anywhere to resolve to, so prefer letting the loop drive both.

## Type exports

```ts
import type {
  WebAgentConfig,
  RunOptions,
  SelectionContext,
  AgentSession,
  AgentStep,
  AgentAction,
  AgentStatus,
  AgentEventName,
  AgentEventMap,
  AgentEventHandler,
  ActionDefinition,
  ActionResult,
  ActionContext,
  ActionFailureReason,
  SitemapEntry,
  SitemapConfig,
  OverlayItem,
  OverlayType,
  PieceSurface,
  PiecePlacement,
  BrandPrompt,
  SystemPromptOverride,
  LLMProvider,
  LLMRouter,
  LLMSource,
  LLMRole,
  LLMMessage,
} from '@perhapxin/dddk';
```
