# LLM adapter registry

> 一個迷你 façade，回答「這個 model 該由哪個 vendor 處理？」— 每家 vendor 一個穩定 id、一個 `create()` factory、整個 process 共用一張 map。Host 可以註冊自己的 adapter（自架 vLLM、Bedrock、Vertex、私有 OpenAI-compatible endpoint），完全不需要 fork 套件。

## 組成

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

| 符號 | 作用 |
|---|---|
| `LLMAdapter` | Vendor adapter 要實作的 interface（`id`、可選的 `matchesModel`、必填的 `create`）。 |
| `AdapterConfig` | 傳給 `create()` 的 free-form config bag（`apiKey`、`baseURL`、`model`，加上 vendor 特有欄位）。 |
| `registerAdapter(a)` | 用 `a.id` 把 adapter 塞進 registry 或覆蓋現有的。Idempotent。 |
| `getAdapter(id)` | 用 id 查，沒註冊回 `undefined`。 |
| `listAdapters()` | 所有已註冊 adapter（按插入順序）。 |
| `unregisterAdapter(id)` | 移除一個。回 boolean 表示原本是否存在。 |
| `createProvider(spec, extra?)` | 用 `"openai:gpt-5.4-mini"` 或 `{ adapter: 'openai', model, ... }` 建 `LLMProvider`。adapter 沒註冊就 throw。 |
| `seedDefaultAdapters()` | 註冊三個內建 adapter。**你必須呼叫這個。** 詳見下節。 |
| `openaiAdapter` / `googleAdapter` / `proxyAdapter` | 三個內建 adapter 本體，另外也直接 export 出來方便你只註冊其中一兩個。 |

## **重點：boot 時一定要呼叫 `seedDefaultAdapters()`**

Registry module **不會**自動註冊內建 adapter。如果它有自動註冊，那就必須靠 side-effect import 觸發 — 而 tsup 會把 side-effect import tree-shake 掉。結果就是 dev build 跑得起來、production build 壞掉、而且要到第一次 `createProvider('openai:...')` 才 throw。

所以 seed 是**明確的函式呼叫**：

```ts
import { seedDefaultAdapters } from '@perhapxin/dddk';

seedDefaultAdapters();   // app boot 時呼叫一次
```

它是 idempotent 的（`registerAdapter` 直接照 id 覆蓋），多呼叫幾次沒事。回傳已註冊的 id list，方便 log。

漏掉這步，`createProvider('openai:gpt-5.4-mini')` 會 throw：

```
No LLM adapter registered for "openai". Did you call seedDefaultAdapters()?
```

錯誤訊息特意把 function 名稱寫出來 — 因為這幾乎一定是 boot-order bug。

## 內建 adapter

### `openaiAdapter`

- **`id`**：`'openai'`
- **`matchesModel`**：`/^(gpt-|o[1-9]|text-)/i` — OpenAI 第一方 model 家族。
- **`create`**：用 `{ apiKey, model, baseURL, organization, headers }` 包出 `OpenAIProvider`。
- 怪癖（provider 內部處理掉）：`gpt-5+` 和 `-mini` / `-nano` 要用 `max_completion_tokens` 而非 `max_tokens`；真正的 reasoning model 不接受自訂 `temperature`。

### `googleAdapter`

- **`id`**：`'google'`
- **`matchesModel`**：`/^(gemini-|gemma-)/i` — 同一把 key 蓋兩個 family。
- **`create`**：用 `{ apiKey, model, baseURL }` 包出 `GoogleProvider`。
- 怪癖（provider 內部處理掉）：Gemini 3.x / Gemma 4 用 `thinkingConfig.thinkingLevel`（字串）、Gemini 2.5 用 `thinkingConfig.thinkingBudget`（數字）。寫錯欄位會回 HTTP 400。

### `proxyAdapter`

- **`id`**：`'proxy'`
- **`matchesModel`**：故意不寫 — proxy endpoint 沒有 model id 命名慣例可比對。
- **`create`**：用 `{ endpoint, method, headers, credentials, buildBody, parseResult, timeoutMs, name }` 包出 `ProxyProvider`。沒給 `endpoint` 會 throw。
- Production-safe 的形狀：client → 你的 `/api/llm` → vendor。Client bundle 完全看不到 vendor key。詳見 [security](../agent/security.md)。

## `createProvider` 的兩種呼叫法

**字串 spec** — `"<adapter>:<model>"`：

```ts
const llm = createProvider('openai:gpt-5.4-mini', { apiKey });
const gem = createProvider('google:gemini-3.1-flash-lite-preview', { apiKey: googleKey });
```

**物件形式** — 直接寫 `adapter` 欄位，其他 config 是動態時很好用：

```ts
const llm = createProvider({
  adapter: 'proxy',
  endpoint: '/api/llm',
  credentials: 'include',
  headers: { 'X-CSRF-Token': csrf },
});
```

字串形式只是物件形式的糖衣語法。冒號後面是 model，其他（`apiKey`、`baseURL`、`headers`、…）走第二參數。

## 寫一個 custom adapter

`LLMAdapter` interface 故意做得很小：

```ts
interface LLMAdapter {
  readonly id: string;
  matchesModel?(modelId: string): boolean;
  create(config: AdapterConfig): LLMProvider;
}
```

### 自架 vLLM（OpenAI-compatible）

vLLM 講的是 OpenAI 的 wire format — 所以 adapter 一行搞定，把 `OpenAIProvider` 指到你內網 URL：

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

這幾家不是純 OpenAI wire format — 直接在 `create` 裡實作 `LLMProvider`：

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

三條保持相容的規則：
1. 回 `CompleteResult` shape（`content`、可選 `toolCalls`、可選 `usage`、`finishReason`）。
2. Tool call 標準化成 OpenAI 形狀（`{ id, name, arguments }`）。Agent loop 是按這個 contract 寫的。
3. 尊重 `opts.signal`，這樣 `agent.stop()` 才能真的中斷。

## 覆蓋內建 adapter

重新註冊同一個 `id` 就把實作整個換掉：

```ts
seedDefaultAdapters();
registerAdapter({
  id: 'openai',
  create: (c) => new OpenAIProvider({
    ...c,
    apiKey: String(c.apiKey ?? ''),
    baseURL: 'https://gateway.ai.cloudflare.com/v1/acct/gw/openai',  // 走 AI Gateway
  }),
});
```

`registerAdapter` 直接覆蓋 — 順序很重要。這就是「在預設行為外面套自己的考量（log、retry、注 header）」的官方做法。

## See also

- [Providers](./providers.md) — 三個內建 provider class 及它們的 config。
- [Router](./router.md) — adapter 配 per-role routing。
- [Security](../agent/security.md) — 什麼時候用 `proxyAdapter`、什麼時候直接 `openai` / `google`。
