# TaskAgent

Third agent class alongside [`WebAgent`](./overview.md) (DOM operator) and [`InlineAgent`](../modules/inline-agent.md) (selection-anchored). **New in v0.2.0.**

## What it is

Conversation + host-defined tool calling. **No DOM read.** **Plain protocol** (standard chat messages + OpenAI tool-calls, not the CoT envelope WebAgent uses).

Use when:

- You want a chat-style AI that answers questions and calls tools you provide.
- The tools are your own domain APIs (order lookups, KB retrieval, RAG queries) — not page manipulation.
- The user's surface is a chat panel / support widget / voice assistant, not the page itself.

Do NOT use when:

- The agent needs to click things on the page → use WebAgent.
- The interaction is text-editing inside an input → use InlineAgent.

## Minimum example

```ts
import { TaskAgent, OpenAIProvider } from '@perhapxin/dddk';

const support = new TaskAgent({
  llm: new OpenAIProvider({ apiKey: KEY, model: 'gpt-5.4-nano' }),
  systemPrompt: 'Answer Acme Co. support questions in the user\'s language.',
  tools: [{
    name: 'lookup_order',
    description: 'Order status by id.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: async ({ id }) => fetch(`/api/orders/${id}`).then(r => r.json()),
  }],
});

const reply = await support.ask('Where is order #12345?');
```

`.ask()` returns the final text after the tool-call loop settles. The LLM can invoke `lookup_order` multiple times before producing a text-only reply — the loop handles the ping-pong.

## Streaming variant

For typewriter UIs:

```ts
for await (const chunk of support.streamAsk('How do I cancel?')) {
  if (chunk.toolCallStart) showSpinner(chunk.toolCallStart.name);
  if (chunk.toolCallEnd)   hideSpinner();
  if (chunk.delta)         append(chunk.delta);
  if (chunk.done)          flush(chunk.text);
}
```

`TaskAgentStreamChunk` shape:

```ts
interface TaskAgentStreamChunk {
  delta: string;            // new text since last chunk
  text: string;             // snapshot of accumulated text
  done: boolean;            // true on the last chunk
  toolCallStart?: { name: string };
  toolCallEnd?:   { name: string; ok: boolean };
}
```

## Config

```ts
new TaskAgent({
  llm,                       // LLMSource — provider or router
  systemPrompt,              // required
  tools?,                    // TaskTool[] (same shape as WebAgent's ActionDefinition)
  session?,                  // AgentSession — inject a shared session
  maxToolRounds?,            // default 4 — cap on tool-call loops per ask
  enableSubtitle?,           // false — narrate progress to subtitle bar between tool calls
  locale?,                   // 'en' — subtitle narration language
  llmTimeoutMs?,             // 30_000 — per-LLM-call timeout
});
```

## Shared session across TaskAgents

Same `AgentSession` shape as WebAgent. Two TaskAgents that share a session see each other's turns:

```ts
const session = dddk.sessions.get('support-thread');
const sales   = new TaskAgent({ llm, systemPrompt: 'sales tone', session });
const billing = new TaskAgent({ llm, systemPrompt: 'billing tone', session });
```

Cross-type session sharing (TaskAgent reading a WebAgent-authored session, or vice versa) partially works: TaskAgent silently skips WebAgent's CoT `agent_step` turns and reads user + assistant text. Full re-serialization in both directions ships in v0.3.

## Live tool registry

Handle-based, matches WebAgent's shape:

```ts
const handle = taskAgent.registerTool({ name, description, parameters, handler });
handle.remove();
```

Registering / removing between `ask()` calls is fine. An in-flight `ask()` completes with its snapshot.

## Attaching to `DotDotDuck`

Optional. Enables subtitle narration between tool calls when `enableSubtitle: true` is set:

```ts
taskAgent.attachTo(dddk);
```

Attach also picks up the SDK's locale-aware "Looking up …" narration copy.

## What TaskAgent does NOT do (v0.2.1)

- **Cross-tab session sync** — WebAgent has it, TaskAgent doesn't yet.
- **Tool-args incremental streaming** — text streams token by token, tool arguments arrive as a whole. Streaming per-token args is on the v0.3 roadmap.
- **Delegating to WebAgent** — a TaskAgent tool that internally spawns a WebAgent run isn't in-box. Doable but orchestrator-heavy; wants use-case validation first.
