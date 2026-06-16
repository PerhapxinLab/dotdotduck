# LLM router

> 傳一個 provider，整個 agent 都用同一個 model。傳一個 `LLMRouter`，就能**按 role 分流** — 短任務（改個 input、清掉語音轉錄的 filler）用便宜小 model，主 agent loop 用 smart 大 model。同 process、不過網路、不增加 config 表面積。

## 為什麼要 router（而不是直接 `llm: provider`）

大部分 webagent 安裝都是從單一 `LLMProvider` 開始：

```ts
new WebAgent({ llm: new OpenAIProvider({ apiKey, model: 'gpt-5.4-mini' }) });
```

這在小場景沒問題，直到你發現 **agent loop**（要看 screenshot、sitemap、action history 連續思考多步）需要 smart model — 但 **inline AI**（「幫我改寫這個 input」、「清掉這段語音轉錄」）希望用最便宜的 model，因為它幾乎每個 keystroke / mic event 都跑一次。

把兩個 provider 寫死、然後每個 call site 都 `if/else` 是錯的形狀。Router 讓你**一次宣告 mapping**，agent 自己按 role 挑對的那個。

## Quick start

```ts
import { WebAgent, OpenAIProvider, GoogleProvider, type LLMRouter } from '@perhapxin/dddk';

const router: LLMRouter = {
  webagent: new OpenAIProvider({ apiKey, model: 'gpt-5.5' }),              // smart, 貴
  webagentWithSelection: new OpenAIProvider({ apiKey, model: 'gpt-5.4-mini' }),
  inline: new GoogleProvider({ apiKey: google, model: 'gemini-3.1-flash-lite-preview' }),
  voiceCleanup: new GoogleProvider({ apiKey: google, model: 'gemini-3.1-flash-lite-preview' }),
};

new WebAgent({ llm: router });
```

`WebAgent` 接受 `LLMProvider | LLMRouter` 兩種都可以 — 內部所有呼叫都過 `resolveLLM(source, role)`。

## Role 列表

完整列表來自 source 的 `LLMRouterRole`。v1 有四個 role：

| Role | 跑什麼 | Fallback |
|---|---|---|
| `webagent` | 主 agent loop（多步規劃 + DOM action）。**必填。** | — |
| `webagentWithSelection` | 一樣的 loop，但是開啟時帶著 user selection（有選文字）。任務範圍通常較窄 → 便宜的 model 通常夠用。 | `webagent` |
| `inline` | Inline AI 的單發呼叫（input rewrite、translate、summarize）。 | `webagent` |
| `voiceCleanup` | 語音轉錄後處理（drop filler、修標點）的迷你 model。 | `webagent` |
| `plan` | [Plan 模組](../agent/plan.md) 的一次性 planning 呼叫 — webagent turn loop 開始前產出 master todos。也用於 markdown LLM 編輯。 | `webagent` |

只有 `webagent` 必填。其他沒設都 fallback 到 `webagent`，所以你只需要宣告**真正想換**的那幾個 role。

## Resolve 怎麼跑

`resolveLLM` 是一行 dispatcher：

```ts
import { resolveLLM, isLLMRouter, type LLMSource } from '@perhapxin/dddk';

function resolveLLM(source: LLMSource, role: LLMRouterRole): LLMProvider {
  if (!isLLMRouter(source)) return source;       // 單一 provider → 全部都用它
  switch (role) {
    case 'webagent':              return source.webagent;
    case 'webagentWithSelection': return source.webagentWithSelection ?? source.webagent;
    case 'inline':                return source.inline ?? source.webagent;
    case 'voiceCleanup':          return source.voiceCleanup ?? source.webagent;
    case 'plan':                  return source.plan ?? source.webagent;
  }
}
```

`isLLMRouter` 用 `{ webagent: { complete } }` 雙重 duck-type 判斷（不是只看 `!complete`），這樣即使 `LLMProvider` 是用 subclass / proxy 包出來、`complete` 掛在 prototype 上，也不會被誤判。

呼叫端長這樣：

```ts
const llm = resolveLLM(this.config.llm, 'inline');
const result = await llm.complete({ messages, ... });
```

沒有 string lookup、沒有 factory dance — `LLMProvider` 是穩定 interface，agent loop / inline tool 完全不在意回來的是哪家 vendor。

## 同一個 provider、不同 model

不一定要跨 vendor 才有用。同一把 OpenAI key、兩個 model：

```ts
const router: LLMRouter = {
  webagent: new OpenAIProvider({ apiKey, model: 'gpt-5.5' }),
  inline:   new OpenAIProvider({ apiKey, model: 'gpt-5.4-nano' }),
};
```

或者用 registry-driven 的寫法（見 [adapters](./adapters.md)）：

```ts
import { seedDefaultAdapters, createProvider } from '@perhapxin/dddk';
seedDefaultAdapters();

const router: LLMRouter = {
  webagent: createProvider('openai:gpt-5.5',     { apiKey }),
  inline:   createProvider('openai:gpt-5.4-nano', { apiKey }),
};
```

## 跨 vendor 混搭

便宜快的 Gemma 處理 inline rewrite + flagship GPT 主跑 agent：

```ts
const router: LLMRouter = {
  webagent:     new OpenAIProvider({ apiKey: openai, model: 'gpt-5.5' }),
  inline:       new GoogleProvider({ apiKey: google, model: 'gemma-4-26b-a4b-it' }),
  voiceCleanup: new GoogleProvider({ apiKey: google, model: 'gemma-4-26b-a4b-it' }),
};
```

Function-calling 格式在 provider 內部已經 normalize 過，agent 完全不在意一個 role 是 OpenAI、另一個是 Google。

## Production 配 ProxyProvider

到 production router 一樣能用 — 每個 role 指到不同的 backend route（或者同一條 route 帶不同 `model`）：

```ts
import { ProxyProvider, type LLMRouter } from '@perhapxin/dddk';

const router: LLMRouter = {
  webagent: new ProxyProvider({ endpoint: '/api/llm', headers: { 'X-Role': 'webagent' } }),
  inline:   new ProxyProvider({ endpoint: '/api/llm', headers: { 'X-Role': 'inline' } }),
};
```

Server 端根據 `X-Role` 決定要打哪個上游 model。Client bundle 看不到任何 vendor key。詳見 [security](../agent/security.md)。

## 什麼時候不需要 router

如果你在做 demo、小型內部工具，或者真的不在乎 per-role cost — 直接傳一個 provider 就好。Router 是 cost-shape 問題的工具，不是必填層。

```ts
new WebAgent({ llm: new OpenAIProvider({ apiKey, model: 'gpt-5.4-mini' }) });
```

這還是會過 `resolveLLM` — `isLLMRouter` 回 `false`，每個 role 都拿到同一個 provider。

## See also

- [Providers](./providers.md) — `OpenAIProvider`、`GoogleProvider`、`ProxyProvider`。
- [Adapters](./adapters.md) — `createProvider` 背後的 registry。
- [Prompt design](../agent/prompt-design.md) — 哪個 role 跑什麼，以及為什麼 inline / voice 用小 model 還是會穩。
