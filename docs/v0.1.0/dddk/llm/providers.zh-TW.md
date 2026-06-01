# webagent — LLM Providers

## 設計原則

- **BYOK（Bring Your Own Key）** — 套件不代管 API key
- **Provider 抽象** — host 換 provider 不用動 agent 邏輯
- **v1 只支援 OpenAI + Google AI Studio 兩家**（Google 同一把 key 可同時打 Gemini 跟 Gemma），其他先不上
- **Function calling 以 OpenAI 格式當內部標準**（Google 用 adapter 轉）
- **Per-role 模型分流** — 透過 `LLMRouter` 讓不同 role 走不同 provider/model，省成本
  - 細節看 [router](./router.md) 跟 [prompt-design](../agent/prompt-design.md)

## LLMProvider 介面

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
  toolCallId?: string;  // role=tool 時
  toolCalls?: ToolCall[];  // role=assistant 時
}

interface ContentPart {
  type: 'text' | 'image';
  text?: string;
  image?: string;  // URL 或 base64
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;  // 標準 JSON Schema
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}
```

## 安全使用指南

`@perhapxin/dddk` 的 provider 對 endpoint 保持中立 — 套件本體不挑邊，但**你怎麼接、key 放哪**會直接決定產品上線會不會爆。

> BYOK 模式、`.env` 為什麼不安全、production backend proxy 的完整實作範例（Cloudflare Worker / Next.js / Express）、server 端必做的 4 件事 — 全部搬到 [security](../agent/security.md) 那一頁。先讀那篇再回來挑 provider。

---

## OpenAI Provider

```ts
import { OpenAIProvider } from '@perhapxin/dddk';

const llm = new OpenAIProvider({
  apiKey: 'sk-...',
  model: 'gpt-5.5',         // 預設 'gpt-5.4-mini'
  baseURL?: 'https://api.openai.com/v1',  // 可改自架 / 反代理
  organization?: string,
  headers?: Record<string, string>,       // 額外 request header
  extraBody?: Record<string, unknown>,    // 廠商專屬 request body 欄位（見下）
});
```

支援所有 OpenAI 相容 endpoint — Azure OpenAI、OpenRouter、Cloudflare AI Gateway、以及 DeepSeek / Qwen 之類透過 `baseURL` 轉接的 OpenAI 相容廠商。

### `extraBody` — 廠商專屬欄位

OpenAI chat-completions 的 JSON shape 已是業界共通語言，但每家廠商會在上面加自己專屬的欄位。`extraBody` 是一個 flat object，在 SDK 內建欄位**之後**併入 request body（所以也能反向覆寫 `temperature` / `max_tokens` 等預設）。給其他 adapter 看不懂的欄位用。

範例 — DeepSeek 的 `thinking` 開關（DeepSeek v4-pro 預設會 reasoning，傳 `{ type: 'disabled' }` 跳過 reasoning 降 TTFT）：

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

同樣這個 hook 也能用來接：
- OpenRouter 的 `transforms` / `route` 欄位
- 自架 vLLM 的 `chat_template_kwargs`
- 任何廠商 private beta 階段的實驗 flag

SDK 不驗證 `extraBody` 內容，直接 verbatim 送上去。廠商不接受就會在 `OpenAIProvider.complete` 的 throw 看到 4xx。

### gpt-5.x / o-series reasoning models 的特殊處理

新一代 reasoning models（`gpt-5.x`、`o1`、`o3`、`o4`）**不收**：
- `max_tokens` — 改成 `max_completion_tokens`
- 自訂 `temperature` — 必須是 default `1`

Provider 內部的 `isReasoningModel`（在 `src/agent/llm/openai.ts`）會偵測 model 前綴自動切：

| Model 前綴 | token field | temperature |
|---|---|---|
| `gpt-5.x`, `o[1-9]`, `gpt-1[0-9].x` | `max_completion_tokens` | 省略（用 default） |
| 其他 | `max_tokens` | 套 `opts.temperature ?? 0.7` |

Host 完全不用管 — 換 model 名稱字串就好。

### 建議 model（2026 年中）

| 用途 | model |
|---|---|
| flagship | `gpt-5.5` |
| 中等便宜 | `gpt-5.4-mini` |
| 最便宜最快 | `gpt-5.4-nano` |

## Google Provider（Gemini + Gemma 共用）

```ts
import { GoogleProvider } from '@perhapxin/dddk';

const llm = new GoogleProvider({
  apiKey: '...',                         // Google AI Studio key
  model: 'gemini-3.1-pro-preview',       // 預設
});
```

同一把 Google AI Studio key 可以打 Gemini 跟 Gemma 兩個 model family（只差在 model id）。內部會把 OpenAI 格式的 tool definitions 轉成 Google function declarations；把 Google 回應的 function call 轉回 OpenAI ToolCall。

### 建議 model（2026 年中）

| 用途 | model |
|---|---|
| flagship | `gemini-3.1-pro-preview` |
| 中等 | `gemini-2.5-pro` |
| 快 / 便宜 | `gemini-3.1-flash-lite-preview` |
| Open-weight (Gemma) | `gemma-4-31b-it` 或 `gemma-4-26b-a4b-it` |

## Thinking / Reasoning 控制

新一代 reasoning models（OpenAI gpt-5.x、o-series；Google gemini-2.5+）能自訂思考量。短任務（inline translate、improve、summarize 一句話）根本不用思考，省 latency 跟 token；長任務（webagent 主迴圈）開大一點品質會穩很多。

```ts
await llm.complete({
  messages,
  thinking: 'off',     // 不思考
  // thinking: 'low' | 'medium' | 'high' | 'xhigh'
});
```

Provider 內部的對應：

| Level | OpenAI（`reasoning_effort`） | Google（`thinkingBudget` tokens） |
|---|---|---|
| `off`    | 整個參數**省略**（server default = 不思考） | `0` |
| `low`    | `low`    | `512` |
| `medium` | `medium` | `1024` |
| `high`   | `high`   | `4096` |
| `xhigh`  | `xhigh`  | （max） |

- **OpenAI**：只有在 `thinking !== 'off'` **且**沒有 `tools` 時才會送 `reasoning_effort`。兩個原因：
  - `'minimal'` 已經在 2026 被淘汰 — 送出去會被回 HTTP 400 `Unsupported value`。目前合法的值是 `'none' | 'low' | 'medium' | 'high' | 'xhigh'`。
  - `/v1/chat/completions` 上的 `reasoning_effort` 跟 `tools` **不相容** — API 會回 `Function tools with reasoning_effort are not supported`。WebAgent 主迴圈一定有帶 tools，所以乾脆省略這個參數（用 server default），功能上等同 "off"，也不會衝突。
- **Google**：寫進 `generationConfig.thinkingConfig.thinkingBudget`（Gemini 2.5）或 `thinkingLevel`（Gemini 3.x / Gemma 4）；不支援的 model 會自動忽略。

## JSON 模式

```ts
await llm.complete({
  messages,
  jsonMode: true,
});
```

- OpenAI → `response_format: { type: 'json_object' }`
- Google → `generationConfig.responseMimeType: 'application/json'`

system / user prompt 要自己明講「output JSON」，不然 OpenAI 會擋。搭配 `thinking: 'off'` 跟 `temperature: 0` 用在「短任務要穩定的結構化輸出」場景剛好（inline-agent、immersive-translate 就是這樣用的）。

## Per-role 模型分流

> 不一定要全部用同一個 model — 用 `LLMRouter` 可以**每個 role 配不同的 provider/model**（agent 主迴圈用大 model、inline 短任務用便宜的）。完整 role 列表、resolution 規則、production wiring 範例見 [LLM router](./router.md)。

## Image 支援

兩家都吃 vision，介面統一：

```ts
const messages: LLMMessage[] = [{
  role: 'user',
  content: [
    { type: 'text', text: '這張圖是什麼？' },
    { type: 'image', image: 'data:image/png;base64,...' },
  ],
}];

await llm.complete({ messages });
```

Provider 內部會處理掉格式差異。

## Streaming

v1 **不做** streaming（agent 是 turn-based，每一步要完整的 tool call 才能執行）。

v2 會考慮把 streaming 用在 `show_subtitle` 場景（讓 subtitle 邊打邊出）。

## 自己寫 provider

只要把 `complete()` 實作出來就行，agent 完全不在乎你怎麼接。但要把 custom provider 註冊到 process-wide registry（讓 `createProvider('your-id:model')` 找得到）、或包裝 / 取代 built-in（OpenAI / Google / proxy），請走 adapter registry。

> 完整 `LLMAdapter` interface、`registerAdapter` / `seedDefaultAdapters` / `createProvider` API、自架 vLLM / Bedrock / Vertex 範例見 [LLM adapters](./adapters.md)。

## v1 不支援的（先講清楚省得被問）

- ❌ Anthropic Claude（v2 加）
- ❌ Ollama / 本機模型（v2 加）
- ❌ Embedding（不在 webagent 範圍）
- ❌ Fine-tune API（不在範圍）
- ❌ Streaming（v2 看情況）
