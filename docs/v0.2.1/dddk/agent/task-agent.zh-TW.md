# TaskAgent

第三種 agent class，跟 [`WebAgent`](./overview.md)（操作 DOM）跟 [`InlineAgent`](../modules/inline-agent.md)（錨在 selection 上）並列。**v0.2.0 新增**。

## 是什麼

對話 + host 自定 tool calling。**不讀 DOM**。**Plain protocol**（標準 chat + OpenAI tool-calls，不是 WebAgent 那套 CoT envelope）。

適合：

- 對話式 AI 回答問題、呼叫你提供的 tool。
- Tool 是你自己的 domain API（查訂單、KB retrieval、RAG）— 不是操作頁面。
- 使用者 surface 是 chat panel / 客服 widget / 語音助手，不是頁面本身。

不要用在：

- Agent 要點頁面元素 → 用 WebAgent。
- 輸入框裡的文字編輯 → 用 InlineAgent。

## 最小例子

```ts
import { TaskAgent, OpenAIProvider } from '@perhapxin/dddk';

const support = new TaskAgent({
  llm: new OpenAIProvider({ apiKey: KEY, model: 'gpt-5.4-nano' }),
  systemPrompt: '回答 Acme Co. 客服問題，用使用者的語言回答。',
  tools: [{
    name: 'lookup_order',
    description: '用 id 查訂單狀態',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: async ({ id }) => fetch(`/api/orders/${id}`).then(r => r.json()),
  }],
});

const reply = await support.ask('我的訂單 12345 到哪了？');
```

`.ask()` 回 tool-call loop 結束後的最終文字。LLM 可能會呼叫 `lookup_order` 多次才吐純文字回答 — loop 幫你處理來回。

## Streaming 版本

打字機效果 UI：

```ts
for await (const chunk of support.streamAsk('要怎麼取消？')) {
  if (chunk.toolCallStart) showSpinner(chunk.toolCallStart.name);
  if (chunk.toolCallEnd)   hideSpinner();
  if (chunk.delta)         append(chunk.delta);
  if (chunk.done)          flush(chunk.text);
}
```

`TaskAgentStreamChunk` 形狀：

```ts
interface TaskAgentStreamChunk {
  delta: string;            // 這輪新增的文字
  text: string;             // 累積的完整文字
  done: boolean;            // 最後一輪是 true
  toolCallStart?: { name: string };
  toolCallEnd?:   { name: string; ok: boolean };
}
```

## Config

```ts
new TaskAgent({
  llm,                       // LLMSource — provider 或 router
  systemPrompt,              // 必填
  tools?,                    // TaskTool[]（跟 WebAgent 的 ActionDefinition 同形狀）
  session?,                  // AgentSession — 注入共享 session
  maxToolRounds?,            // 預設 4 — 每次 ask 內 tool-call loop 上限
  enableSubtitle?,           // false — tool call 之間 narrate 到字幕條
  locale?,                   // 'en' — 字幕 narration 語言
  llmTimeoutMs?,             // 30_000 — 每次 LLM 呼叫 timeout
});
```

## 跨 TaskAgent 共享 session

跟 WebAgent 同形狀的 `AgentSession`。兩個 TaskAgent 共用同一個 session 就能互看 turn：

```ts
const session = dddk.sessions.get('support-thread');
const sales   = new TaskAgent({ llm, systemPrompt: 'sales tone', session });
const billing = new TaskAgent({ llm, systemPrompt: 'billing tone', session });
```

跨類型共享（TaskAgent 讀 WebAgent 寫的 session，或反過來）部分可用：TaskAgent 會安靜跳過 WebAgent 的 CoT `agent_step` turn、讀 user + assistant 文字。雙向完整 re-serialization 排在 v0.3。

## Live tool registry

Handle-based，跟 WebAgent 同形狀：

```ts
const handle = taskAgent.registerTool({ name, description, parameters, handler });
handle.remove();
```

在 `ask()` 之間 register / remove 都可以。in-flight 的 `ask()` 用它當下 snapshot 跑完。

## 接上 `DotDotDuck`

可選。設 `enableSubtitle: true` 時 tool call 之間 narrate 到字幕條要靠這個：

```ts
taskAgent.attachTo(dddk);
```

Attach 也會拿到 SDK 內建的 locale-aware「查詢中…」narration 文案。

## TaskAgent v0.2.1 還不會的事

- **跨 tab session 同步** — WebAgent 有，TaskAgent 還沒。
- **Tool 參數逐字 streaming** — 文字 token by token 進來、tool 參數是一整包到位。逐字 stream 排在 v0.3。
- **委派給 WebAgent** — TaskAgent 的 tool 裡面 spawn 一個 WebAgent run 這條沒開箱。可行但 orchestrator 複雜度高，等實際 use case 驗證。
