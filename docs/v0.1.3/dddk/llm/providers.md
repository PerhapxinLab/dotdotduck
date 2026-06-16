# webagent — LLM Providers

## Design principles

- **BYOK (Bring Your Own Key)** — the package does not manage API keys.
- **Provider abstraction** — swapping the provider does not require touching agent logic.
- **v1 supports OpenAI + Google AI Studio only** (a single Google key calls both Gemini and Gemma); other vendors come later.
- **OpenAI's function-calling shape is the internal standard.** Google goes through an adapter.
- **Per-role model routing** — `LLMRouter` lets different roles use different providers / models to save cost. See [router](./router.md) and [prompt-design](../agent/prompt-design.md).

## LLMProvider interface

```ts
interface LLMProvider {
  readonly name: string;

  complete(opts: CompleteOptions): Promise<CompleteResult>;
}

interface CompleteOptions {
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
  /** Reasoning intensity. 'off' suppresses thinking on models that support it. */
  thinking?: 'off' | 'low' | 'medium' | 'high' | 'xhigh';
  /** Force structured JSON output (response_format / responseMimeType). */
  jsonMode?: boolean;
}

interface CompleteResult {
  content: string;
  toolCalls?: ToolCall[];
  usage?: { promptTokens: number; completionTokens: number };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
}

interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  toolCallId?: string;  // when role = 'tool'
  toolCalls?: ToolCall[];  // when role = 'assistant'
}

interface ContentPart {
  type: 'text' | 'image';
  text?: string;
  image?: string;  // URL or base64
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;  // standard JSON Schema
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}
```

## Security usage guide

`@perhapxin/dddk` providers are endpoint-neutral — the package itself doesn't pick a side, but **how you wire it and where the key lives** decides whether you ship safely.

> BYOK modes, why `.env` is not safe, a production backend proxy example (Cloudflare Worker / Next.js / Express), and the four things every server proxy must do — all live in [security](../agent/security.md). Read that page first, then come back to pick a provider.

---

## OpenAI Provider

```ts
import { OpenAIProvider } from '@perhapxin/dddk';

const llm = new OpenAIProvider({
  apiKey: 'sk-...',
  model: 'gpt-5.5',         // default 'gpt-5.4-mini'
  baseURL?: 'https://api.openai.com/v1',  // override for self-hosted / reverse proxy
  organization?: string,
  headers?: Record<string, string>,       // extra request headers
  extraBody?: Record<string, unknown>,    // vendor-specific request fields (see below)
});
```

Works with any OpenAI-compatible endpoint — Azure OpenAI, OpenRouter, Cloudflare AI Gateway, and OpenAI-compatible vendors like DeepSeek or Qwen via `baseURL`.

### `extraBody` — vendor-specific knobs

The OpenAI chat-completions JSON shape is the de-facto lingua franca, but each vendor adds proprietary fields. `extraBody` is a flat object spread into every request body **after** the SDK's built-in fields (so it can also override `temperature` / `max_tokens` when needed). Use it for fields no other adapter would understand.

Example — DeepSeek's `thinking` toggle (DeepSeek v4-pro reasons by default; passing `{ type: 'disabled' }` skips reasoning for lower TTFT):

```ts
const llm = new OpenAIProvider({
  apiKey: process.env.DEEPSEEK_KEY!,
  model: 'deepseek-v4-pro',
  baseURL: 'https://api.deepseek.com/v1',
  extraBody: {
    thinking: { type: 'disabled' },
  },
});
```

Other patterns the same hook covers:
- OpenRouter's `transforms` / `route` fields
- Self-hosted vLLM's `chat_template_kwargs`
- Any vendor's experimental flags during a private beta

The SDK doesn't validate `extraBody`; whatever you put in goes upstream verbatim. If the vendor rejects the body, you'll see the 4xx in `OpenAIProvider.complete`'s throw.

### Special handling for gpt-5.x / o-series reasoning models

The new-generation reasoning models (`gpt-5.x`, `o1`, `o3`, `o4`) reject:
- `max_tokens` — use `max_completion_tokens` instead.
- Custom `temperature` — must use the default of `1`.

The provider's internal `isReasoningModel` (in `src/agent/llm/openai.ts`) detects the model prefix and switches automatically:

| Model prefix | token field | temperature |
|---|---|---|
| `gpt-5.x`, `o[1-9]`, `gpt-1[0-9].x` | `max_completion_tokens` | omitted (use default) |
| Anything else | `max_tokens` | applies `opts.temperature ?? 0.7` |

The host doesn't worry about this — change the model string and the rest follows.

### Recommended models (mid 2026)

| Use | Model |
|---|---|
| Flagship | `gpt-5.5` |
| Mid / cheap | `gpt-5.4-mini` |
| Cheapest / fastest | `gpt-5.4-nano` |

## Google Provider (Gemini + Gemma share this)

```ts
import { GoogleProvider } from '@perhapxin/dddk';

const llm = new GoogleProvider({
  apiKey: '...',                         // Google AI Studio key
  model: 'gemini-3.1-pro-preview',       // default
});
```

One Google AI Studio key calls both the Gemini and Gemma model families (only the model id differs). Internally we translate OpenAI-format tool definitions into Google function declarations, and translate Google's function-call responses back into OpenAI `ToolCall` shape.

### Recommended models (mid 2026)

| Use | Model |
|---|---|
| Flagship | `gemini-3.1-pro-preview` |
| Mid | `gemini-2.5-pro` |
| Fast / cheap | `gemini-3.1-flash-lite-preview` |
| Open-weight (Gemma) | `gemma-4-31b-it` or `gemma-4-26b-a4b-it` |

## Thinking / Reasoning control

Reasoning models (OpenAI gpt-5.x, o-series; Google gemini-2.5+) let you tune how much they think. Short tasks (inline translate, improve, summarize a sentence) don't need reasoning — save latency and tokens. Long tasks (the main webagent loop) benefit from higher budgets.

```ts
await llm.complete({
  messages,
  thinking: 'off',     // no reasoning
  // thinking: 'low' | 'medium' | 'high' | 'xhigh'
});
```

Internal mapping:

| Level | OpenAI (`reasoning_effort`) | Google (`thinkingBudget` tokens) |
|---|---|---|
| `off`    | param OMITTED (server default = no reasoning) | `0` |
| `low`    | `low`    | `512` |
| `medium` | `medium` | `1024` |
| `high`   | `high`   | `4096` |
| `xhigh`  | `xhigh`  | (max) |

- **OpenAI**: only sends `reasoning_effort` when `thinking !== 'off'` AND the request has no `tools`. Two reasons:
  - `'minimal'` was retired in 2026 — passing it returns HTTP 400 `Unsupported value`. The current valid set is `'none' | 'low' | 'medium' | 'high' | 'xhigh'`.
  - On `/v1/chat/completions`, `reasoning_effort` is INCOMPATIBLE with `tools` — the API rejects with `Function tools with reasoning_effort are not supported`. Since the WebAgent loop always sends tools, omitting the param (server default) is functionally identical to "off" with zero conflict.
- **Google**: writes to `generationConfig.thinkingConfig.thinkingBudget` (Gemini 2.5) or `thinkingLevel` (Gemini 3.x / Gemma 4). Models that don't support it ignore the flag.

## JSON mode

```ts
await llm.complete({
  messages,
  jsonMode: true,
});
```

- OpenAI → `response_format: { type: 'json_object' }`
- Google → `generationConfig.responseMimeType: 'application/json'`

You must say "output JSON" in the system or user prompt, otherwise OpenAI will reject the request. Pair with `thinking: 'off'` and `temperature: 0` for "short task with stable structured output" — that's how inline-agent and immersive-translate use it.

## Per-role model routing

> You don't have to use the same model for everything. `LLMRouter` lets each role pick a different provider/model (flagship for the main agent loop, cheap one for inline short tasks). For the full role list, resolution rules, and production wiring example, see [LLM router](./router.md).

## Image support

Both vendors handle vision; the API surface is the same:

```ts
const messages: LLMMessage[] = [{
  role: 'user',
  content: [
    { type: 'text', text: 'What is this image?' },
    { type: 'image', image: 'data:image/png;base64,...' },
  ],
}];

await llm.complete({ messages });
```

Format differences are handled inside each provider.

## Streaming

v1 does **not** support streaming (the agent is turn-based — every step needs a complete tool call before execution).

v2 will consider streaming for `show_subtitle` (letting the subtitle render character-by-character).

## Writing your own provider

Implement `complete()` and you're done; the agent doesn't care how you get the result. To register a custom provider in the process-wide registry (so `createProvider('your-id:model')` resolves to it), or to wrap / replace one of the built-ins (OpenAI / Google / proxy), go through the adapter registry.

> Full `LLMAdapter` interface, `registerAdapter` / `seedDefaultAdapters` / `createProvider` API, plus examples for self-hosted vLLM / Bedrock / Vertex live in [LLM adapters](./adapters.md).

## Not supported in v1 (stated explicitly to save the question)

- ❌ Anthropic Claude (v2)
- ❌ Ollama / local models (v2)
- ❌ Embeddings (not part of webagent's scope)
- ❌ Fine-tune APIs (out of scope)
- ❌ Streaming (under consideration for v2)
