# LLM adapter registry

> A tiny façade for "which vendor handles this model?" — one stable id per vendor, one `create()` factory per id, one process-wide map. Hosts can register their own (self-hosted vLLM, Bedrock, Vertex, private OpenAI-compatible endpoints) without forking the package.

## The pieces

```ts
import {
  seedDefaultAdapters,
  registerAdapter,
  getAdapter,
  listAdapters,
  unregisterAdapter,
  createProvider,
  openaiAdapter,
  googleAdapter,
  proxyAdapter,
  type LLMAdapter,
  type AdapterConfig,
} from '@perhapxin/dddk';
```

| Symbol | What it does |
|---|---|
| `LLMAdapter` | Interface a vendor adapter implements (`id`, optional `matchesModel`, required `create`). |
| `AdapterConfig` | Free-form config bag passed into `create()` (`apiKey`, `baseURL`, `model`, plus vendor extras). |
| `registerAdapter(a)` | Insert / replace an adapter in the registry by `a.id`. Idempotent. |
| `getAdapter(id)` | Lookup by id, `undefined` if missing. |
| `listAdapters()` | All registered adapters, in insertion order. |
| `unregisterAdapter(id)` | Remove one. Returns whether it existed. |
| `createProvider(spec, extra?)` | Build an `LLMProvider` from `"openai:gpt-5.4-mini"` or `{ adapter: 'openai', model, ... }`. Throws if the adapter isn't registered. |
| `seedDefaultAdapters()` | Register the three built-ins. **You must call this.** See below. |
| `openaiAdapter` / `googleAdapter` / `proxyAdapter` | The three built-ins, also exported directly for selective registration. |

## **CRITICAL: call `seedDefaultAdapters()` at boot**

The registry module **does not** auto-register the built-ins. If it did, a side-effect import would seed them — and tsup tree-shakes side-effect imports out of the bundle. You'd get a working dev build and a broken production build with no error until the first `createProvider('openai:...')` throws.

So the seed is an **explicit function call**:

```ts
import { seedDefaultAdapters } from '@perhapxin/dddk';

seedDefaultAdapters();   // run once at app boot
```

It's idempotent (`registerAdapter` just overwrites by id), so calling it twice is fine. Returns the list of registered ids for diagnostic logging.

Skip this step and `createProvider('openai:gpt-5.4-mini')` throws:

```
No LLM adapter registered for "openai". Did you call seedDefaultAdapters()?
```

The error mentions the function on purpose — it's almost always a boot-order bug.

## Bundled adapters

### `openaiAdapter`

- **`id`**: `'openai'`
- **`matchesModel`**: `/^(gpt-|o[1-9]|text-)/i` — first-party OpenAI model families.
- **`create`**: wraps `OpenAIProvider` with `{ apiKey, model, baseURL, organization, headers }`.
- Quirks (handled inside the provider): `gpt-5+` and `-mini` / `-nano` need `max_completion_tokens` not `max_tokens`; true reasoning models reject custom `temperature`.

### `googleAdapter`

- **`id`**: `'google'`
- **`matchesModel`**: `/^(gemini-|gemma-)/i` — covers both families on the same key.
- **`create`**: wraps `GoogleProvider` with `{ apiKey, model, baseURL }`.
- Quirks (handled inside the provider): Gemini 3.x / Gemma 4 use `thinkingConfig.thinkingLevel` (string), Gemini 2.5 uses `thinkingConfig.thinkingBudget` (number). Sending the wrong field returns HTTP 400.

### `proxyAdapter`

- **`id`**: `'proxy'`
- **`matchesModel`**: omitted on purpose — proxy endpoints don't carry a model-id naming convention.
- **`create`**: wraps `ProxyProvider` with `{ endpoint, method, headers, credentials, buildBody, parseResult, timeoutMs, name }`. Throws if `endpoint` is missing.
- The production-safe shape: client → your `/api/llm` → vendor. Client bundle never sees a vendor key. See [security](../agent/security.md).

## `createProvider` — two call shapes

**String spec** — `"<adapter>:<model>"`:

```ts
const llm = createProvider('openai:gpt-5.4-mini', { apiKey });
const gem = createProvider('google:gemini-3.1-flash-lite-preview', { apiKey: googleKey });
```

**Object form** — explicit `adapter` field, useful when other config is dynamic:

```ts
const llm = createProvider({
  adapter: 'proxy',
  endpoint: '/api/llm',
  credentials: 'include',
  headers: { 'X-CSRF-Token': csrf },
});
```

The string form is just sugar over the object form. Anything after the colon is the model; everything else (`apiKey`, `baseURL`, `headers`, …) goes through the second arg.

## Writing a custom adapter

The `LLMAdapter` interface is intentionally tiny:

```ts
interface LLMAdapter {
  readonly id: string;
  matchesModel?(modelId: string): boolean;
  create(config: AdapterConfig): LLMProvider;
}
```

### Self-hosted vLLM (OpenAI-compatible)

vLLM speaks OpenAI's wire format — so the adapter is a one-liner that points `OpenAIProvider` at your internal URL:

```ts
import { registerAdapter, OpenAIProvider, type LLMAdapter } from '@perhapxin/dddk';

const vllmAdapter: LLMAdapter = {
  id: 'company-vllm',
  matchesModel: (m) => m.startsWith('vllm/'),
  create: (c) => new OpenAIProvider({
    apiKey:  String(c.apiKey ?? 'unused'),
    baseURL: 'https://llm.internal.acme.com/v1',
    model:   c.model as string | undefined,
  }),
};

registerAdapter(vllmAdapter);

const llm = createProvider('company-vllm:vllm/llama-3-70b-instruct');
```

### Bedrock / Vertex / Azure OpenAI

These don't speak vanilla OpenAI on the wire — implement `LLMProvider` directly inside `create`:

```ts
registerAdapter({
  id: 'bedrock',
  matchesModel: (m) => m.startsWith('anthropic.') || m.startsWith('amazon.'),
  create: (c) => ({
    name: 'bedrock',
    async complete(opts) {
      const res = await bedrockClient.converse({
        modelId: opts.model ?? (c.model as string),
        messages: toBedrockMessages(opts.messages),
        toolConfig: opts.tools && { tools: opts.tools.map(toBedrockTool) },
      });
      return {
        content: extractText(res),
        toolCalls: extractToolCalls(res),
        usage: res.usage && {
          promptTokens: res.usage.inputTokens,
          completionTokens: res.usage.outputTokens,
        },
        finishReason: mapStopReason(res.stopReason),
      };
    },
  }),
});
```

Three rules to stay compatible:
1. Return `CompleteResult` shape (`content`, optional `toolCalls`, optional `usage`, `finishReason`).
2. Normalize tool calls to OpenAI shape (`{ id, name, arguments }`). The agent loop expects that contract.
3. Respect `opts.signal` so `agent.stop()` can actually abort.

## Replacing a built-in

Re-register the same `id` and you swap the implementation everywhere:

```ts
seedDefaultAdapters();
registerAdapter({
  id: 'openai',
  create: (c) => new OpenAIProvider({
    ...c,
    apiKey: String(c.apiKey ?? ''),
    baseURL: 'https://gateway.ai.cloudflare.com/v1/acct/gw/openai',  // route via AI Gateway
  }),
});
```

`registerAdapter` silently overwrites — order matters. This is the supported way to wrap the default in your own concerns (logging, retries, header injection).

## See also

- [Providers](./providers.md) — the three built-in provider classes and their config.
- [Router](./router.md) — pair adapters with per-role routing.
- [Security](../agent/security.md) — when to use `proxyAdapter` vs direct `openai` / `google`.
