# Bring your own agent

> dddk's UI surfaces — palette, subtitle bar, FAB, gestures, intent stream, voice — are useful by themselves, even if you already run your own agent stack server-side and don't want dddk's built-in webagent / inline agent.

## When this matters

Most teams adopting dddk in 2026 already have an agent. Some have invested years into an in-house RAG pipeline, an internal tool router, a custom LangGraph orchestrator, a proprietary planner — and they want the **UI / interaction layer** dddk gives them without throwing away that backend.

dddk is designed for this. The webagent and inline agent are **default implementations** of the agent role, not hard dependencies. You can disable them entirely and route every user gesture (palette Enter / voice / Dwell selection / FAB tap) to your own agent. The subtitle bar, overlays, intent stream, palette, and mobile chrome stay fully functional.

## The minimum opt-out

```ts
new DotDotDuck({
  // No `llm` field. No `webAgent` config.
  agent: { enabled: false },        // built-in webagent loop is off
  // Don't construct InlineAgent at all — it's already separate from
  // the orchestrator; just skip `new InlineAgent({ ... })`.
});
```

What this changes:

- `dddk.startAgent(task)` becomes a no-op that shows a "Agent is disabled" subtitle (you'll route around it — see below).
- No DOM scraping per turn. No tool registry. No agent prompts in any LLM call originating from dddk.
- Subtitle bar / overlays / palette / gestures / mobile FAB / intent stream all still work.

## The three integration points

After disabling the built-in agent, your job is to glue these three:

### 1. Receive user input

| Event | Payload | When it fires |
|---|---|---|
| `palette_open` | `{ selection?: SelectionContext }` | User opens the palette (Ctrl+K, FAB tap on idle, swipe gesture). Selection text and image attachments come with it. |
| `voice_end` | `{ text: string }` | Voice transcript is ready (Web Speech / your custom `transcribe()` callback finished). |
| `gesture_reject` / `gesture_escape` | — | User cancelled. |

Plus the palette's plain-text "Ask AI" fallback handler — the recommended hook for typed input. Register it the same way dddk-frontend does, but route to **your** agent:

```ts
dddk.palette.addItem({
  id: 'ask-ai-fallback',
  name: 'Ask AI',
  fallback: true,                       // only shows when nothing else matches
  section: 'AI',
  handler: (p, arg) => {
    p.close();
    const text = arg ?? p.input.trim();
    if (text) runMyAgent(text);          // ← your agent entry point
  },
});
```

### 2. Render output

Use the subtitle bar exactly like the built-in agent does:

```ts
function runMyAgent(task: string): Promise<void> {
  const stream = myBackend.run(task);    // your AsyncIterable / EventSource / etc.

  for await (const chunk of stream) {
    if (chunk.kind === 'text') {
      dddk.subtitle.appendStreamed(chunk.delta);
    } else if (chunk.kind === 'tool') {
      dddk.subtitle.appendStreamed(`\n[${chunk.toolName}…]`);
    } else if (chunk.kind === 'final') {
      dddk.subtitle.finalizeStreamed({ autoHide: 8000 });
    }
  }
}
```

For richer structured output (forms / tables / cards / charts), use the Pieces system — same envelope your built-in agent would have emitted:

```ts
dddk.subtitle.show({
  type: 'agent',
  text: 'Here are your invoices:',
});
dddk.surfaces.render(myPiecesEnvelope, { placement: 'inline' });
```

For ask-back interactions:

```ts
const answer = await new Promise<string>((resolve) => {
  dddk.subtitle.showChoice({
    question: 'Which account?',
    options: ['Personal', 'Business', 'Family'],
    allowFreeText: true,
    onPick: resolve,
  });
});
```

### 3. Emit intent events for analytics

So the dashboard (and any downstream listener of `dddk.on('intent', …)`) still tracks your agent's behaviour:

```ts
dddk.emitIntent({
  kind: 'agent_answered',
  answer: 'yes',                         // or 'no' / 'cancel' / a free-text string
  via: 'gesture',                        // or 'voice' / 'click' / 'free_text'
  timestamp: Date.now(),
});

dddk.emitIntent({
  kind: 'confirm_action',
  actionName: 'send_email',
  params: { to: 'a@b.com' },
  approved: true,
  timestamp: Date.now(),
});
```

Every built-in intent kind is documented in `agent/api.md` — match the shape and the analytics page treats your agent as a first-class citizen.

## Replacing inline agent

`InlineAgent` is already opt-in — the orchestrator doesn't auto-construct it; the host explicitly does `new InlineAgent({ llm, locale })`. To use your own selection-popover instead, simply don't instantiate it. Wire your popover directly to text-selection events on inputs / textareas / contentEditables. Use `dddk.subtitle.appendStreamed(...)` for streaming output back into the bar if that's the UX you want, or render directly into the input element.

If you still want dddk's inline-popover shell but with your own backend driving it, file an issue — the popover's tool dispatch is currently tied to the LLM call but could be opened up.

## What you keep for free

After the opt-out, dddk still gives you:

- **Command palette** — Ctrl+K, prefix routing, sub-menus, attachments, image-paste, palette body `showResult()` for any custom UI.
- **Subtitle bar** — streaming, pause, choice picker, free-text picker, autohide, locale-aware copy, touch-tap routing.
- **Gestures** — Space accept / double-Space reject / Esc cancel / hold-Space voice / long-press Dwell.
- **Mobile chrome + FAB** — single tap routes through `triggerAccept()` so your agent advances on a phone tap, same as Space on desktop.
- **Intent stream + analytics** — every gesture, palette activation, voice attempt, and explicit `emitIntent` flows into one event bus.
- **Sitemap-aware navigation** — `dddk.palette.addItem(...)` with paths still drives `goto()`.
- **Theming** — 28 CSS variables, light / dark.
- **Cross-tab sync, session persistence, host helpers, react adapter, …** — orthogonal to the agent.

## Full template

A minimum host file that runs entirely on your own backend:

```ts
import { DotDotDuck } from '@perhapxin/dddk';
import { myBackend } from './my-agent';

const dddk = new DotDotDuck({
  siteName: 'YourSaaS',
  agent: { enabled: false },           // disable built-in webagent
  // No `llm` field — dddk doesn't need an LLM if the built-in agent is off.
});

dddk.mount();

// Receive user input.
dddk.palette.addItem({
  id: 'ask-ai-fallback',
  name: 'Ask AI',
  fallback: true,
  handler: (p, arg) => {
    p.close();
    const text = arg ?? p.input.trim();
    if (text) void runMyAgent(text);
  },
});

dddk.on('voice_end', ({ text }) => {
  if (text) void runMyAgent(text);
});

async function runMyAgent(task: string): Promise<void> {
  dddk.subtitle.showIndicator('processing');
  try {
    const stream = myBackend.run(task);
    for await (const chunk of stream) {
      if (chunk.kind === 'text') {
        dddk.subtitle.appendStreamed(chunk.delta);
      } else if (chunk.kind === 'tool_called') {
        dddk.emitIntent({
          kind: 'confirm_action',
          actionName: chunk.toolName,
          params: chunk.params,
          approved: true,
          timestamp: Date.now(),
        });
      }
    }
    dddk.subtitle.finalizeStreamed({ autoHide: 8000 });
    dddk.emitIntent({ kind: 'agent_answered', answer: 'complete', via: 'free_text', timestamp: Date.now() });
  } catch (err) {
    dddk.subtitle.hideIndicator();
    dddk.subtitle.show({ text: `Error: ${(err as Error).message}`, type: 'info', autoHide: 6000 });
  }
}
```

That's the whole integration. dddk handles the UI; your backend handles the agent.

See also: [agent/api.md](../agent/api.md) for the full event + intent shape, [triggers/palette.md](../triggers/palette.md) for the palette API surface, [modules/voice.md](../modules/voice.md) for the `transcribe(audio)` callback hook if you want to swap Web Speech for Whisper / Deepgram / your own ASR.
