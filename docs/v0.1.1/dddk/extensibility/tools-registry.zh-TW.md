# Tools registry — 把能力暴露給 agent

> `ToolsRegistry` 把 host 的 capability（QA、search、classify、recommend、自家 domain ops）註冊成 webagent 的 tool。LLM 自己決定何時呼叫 — 不是 user 從 palette 挑「我現在要用哪個工具」。

## 心智模型

```
user 自然語言輸入
  ↓
WebAgent（reasoning）
  ↓ 「我應該查一下 FAQ 看有沒有現成答案」
  ↓
agent.callAction('qa_lookup', { question: '退貨怎麼辦？' })
  ↓
ToolsRegistry → 你註冊的 handler → 結果丟回 agent
  ↓
agent 用結果接著推 / 回答
```

把 QA / search / recommend 放進 palette 當獨立 surface 沒錯，但那是「使用者要主動選工具」的世界。tools registry 是另一條路：**host 提供能力，agent 自己選**。兩條路可以共存。

## API 一覽

```ts
import { ToolsRegistry } from '@perhapxin/dddk';
import type { ToolSpec, RegisterQAOpts, QAToolItem } from '@perhapxin/dddk';

class ToolsRegistry {
  // 低階：完整 ActionDefinition + 可選 label
  register(spec: ToolSpec): void;
  unregister(id: string): boolean;
  list(): ToolSpec[];

  // 高階 helper
  registerQA(opts: RegisterQAOpts): void;
  registerSearch<TRow>(opts: RegisterSearchOpts<TRow>): void;
  registerClassifier(opts: RegisterClassifierOpts): void;
  registerRecommend<TRow>(opts: RegisterRecommendOpts<TRow>): void;

  // orchestrator 內部用 — host 通常不直接碰
  attachAgent(agent: WebAgent): void;
  detachAgent(): void;
  snapshot(): ActionDefinition[];
}
```

`ToolsRegistry` 由 `DotDotDuck` orchestrator 持有，host 從 `dddk.tools.*` 用。

## 從 `dddk.tools` 拿到 registry

```ts
import { DotDotDuck } from '@perhapxin/dddk';

const dddk = new DotDotDuck({ /* ... */ });

dddk.tools.registerQA({ items: [/* ... */] });
dddk.tools.register({ name: 'create_ticket', /* ... */ });
```

## 高階 helper 1：`registerQA`

最常見的 use case — host 有一份 FAQ，希望 agent 自己會去查。

```ts
dddk.tools.registerQA({
  items: [
    { id: 'refund',  question: '怎麼退貨？',       answer: '7 天內到帳號中心點...', category: 'order' },
    { id: 'ship',    question: '什麼時候會出貨？', answer: '工作日下單後 24 小時內...', category: 'order' },
    { id: 'privacy', question: '你們有賣資料給第三方嗎？', answer: '沒有。隱私政策見...', category: 'privacy' },
  ],
  topK: 3,
});
```

agent 自動看到一個叫 `qa_lookup` 的工具。當使用者問「我要退貨」，agent 會：
1. reason 出「應該先查 FAQ」
2. 呼叫 `qa_lookup({ question: '我要退貨' })`
3. 拿到 top 3 matched FAQ entries（含 confidence、score）
4. 用結果生成回應

| 選項 | 預設 | 說明 |
| --- | --- | --- |
| `id` | `'qa_lookup'` | tool name；字母數字 + 底線 |
| `items` | — | FAQ entries（支援雙語、auto-detect） |
| `description` | 預設文字告訴 agent「這是公司知識庫」 | 重寫讓 agent 知道你的 FAQ 是什麼領域 |
| `topK` | 3 | 回幾筆 |

## 高階 helper 2：`registerSearch`

任何 catalog 全文檢索（產品、文章、紀錄）：

```ts
type Product = { sku: string; title: string; body: string; price: number };

dddk.tools.registerSearch<Product>({
  items: allProducts,
  toDoc: (p) => ({
    id: p.sku,
    fields: { title: p.title, body: p.body },
    meta: { price: p.price },
  }),
  fieldWeights: { title: 3.0, body: 1.0 },
  topK: 5,
});
```

agent 看到 `search_catalog({ query: string })`，回 `{ hits: [{ id, fields, meta, score }] }`。BM25 per-field 評分，title 權重比 body 重。

## 高階 helper 3：`registerClassifier`

Naive Bayes 文字分類，給 agent 一個 routing / tagging 工具：

```ts
dddk.tools.registerClassifier({
  samples: [
    { text: '我的信用卡被多扣了',   label: 'billing' },
    { text: '退款還沒到',           label: 'billing' },
    { text: 'app 一直閃退',         label: 'bug' },
    { text: '怎麼改密碼',           label: 'account' },
  ],
  topK: 3,
});
```

agent 看到 `classify_text({ text: string })` → `{ predictions: [{ label, score }] }`。雙語訓練資料可以混在一起，內部會 prefix-language 避免 cross-language 污染。

## 高階 helper 4：`registerRecommend`

一次註冊三個 tool：`recommend_for_customer`、`recommend_similar`、`record_preference`。

```ts
dddk.tools.registerRecommend<Product>({
  items: allProducts,
  toDoc: (p) => ({
    id: p.sku,
    fields: { title: p.title, body: p.body },
    meta: { price: p.price },
  }),
  customerId: currentUser.id,
  topK: 5,
});
```

- `recommend_for_customer()` → 根據 customer 累積偏好回 personalised top-K。
- `recommend_similar({ productId })` → 找類似商品。
- `record_preference({ productId, response: 'yes' | 'no' | 'dismiss' })` → 把使用者的 ♥/✕ 餵回 recommender。

Agent 接到使用者的 reaction 就會主動呼 `record_preference`，下次推薦會反映。

## 低階：`register({...ActionDefinition})`

helper 蓋不到的客製工具就走原始 `ActionDefinition`：

```ts
dddk.tools.register({
  name: 'create_ticket',
  label: '建立客服單',
  description: '在工單系統開一張新單。當使用者描述了一個還沒解決的問題、且 FAQ 沒有答案時用。',
  parameters: {
    type: 'object',
    properties: {
      title:    { type: 'string',  description: '一行摘要使用者問題' },
      priority: { type: 'string',  enum: ['low', 'normal', 'high'] },
      body:     { type: 'string',  description: '完整描述' },
    },
    required: ['title', 'body'],
  },
  handler: async (params) => {
    const { title, priority, body } = params as { title: string; priority?: string; body: string };
    try {
      const ticket = await fetch('/api/tickets', {
        method: 'POST',
        body: JSON.stringify({ title, priority: priority ?? 'normal', body }),
      }).then((r) => r.json());
      return { ok: true, data: { id: ticket.id, url: `/tickets/${ticket.id}` } };
    } catch (err) {
      return { ok: false, reason: 'unknown', message: (err as Error).message };
    }
  },
});
```

| ActionDefinition 欄位 | 重點 |
| --- | --- |
| `name` | 必須 `^[a-z][a-z0-9_]*$`（agent 不能叫帶 dot / slash 的名字）。重複註冊會 throw。 |
| `description` | agent 看的「我什麼時候該叫這個工具」。寫好它比啥都重要。 |
| `parameters` | JSON Schema。Agent 用這個產 args。 |
| `handler` | `(params) => Promise<ActionResult<unknown>>`。回 `{ ok: true, data }` 或 `{ ok: false, reason, message }`。 |

## Live vs build-time

兩種註冊時機都 OK：

```ts
// Build-time：在 DotDotDuck constructor 之前 register。
//   orchestrator 建 WebAgent 時會 snapshot() 出來一次塞給 agent。
dddk.tools.register({ /* ... */ });
const dddk = new DotDotDuck({ /* ... */ });

// Live：agent 已經跑起來，register 會立刻 attachAgent → registerAction。
//   下一次 agent turn 就看得到。
dddk.tools.register({ /* ... */ });
```

`attachAgent(agent)` 是 orchestrator 內部呼的；它會 replay 所有已註冊的 tool 到 live agent，順序不重要。

## Unregister + 列出

```ts
dddk.tools.unregister('qa_lookup');     // true if removed
dddk.tools.list();                       // ToolSpec[]
```

注意：WebAgent **不支援 runtime un-register**。`unregister` 把 tool 從 registry 移掉了，但已經 attach 的 agent 還會記得它，直到 agent 重建。實務上：要動的話在 boot 階段一次定型，別 runtime 拔。

## 何時用 tools vs palette skill

| 想要 | 用 tools registry | 用 palette skill |
| --- | --- | --- |
| 使用者一句話，LLM 決定要不要查資料 | ✓ | |
| 使用者明確要打開某個工具 | | ✓ |
| 多個獨立 capability 要組合（FAQ + search + ticket） | ✓ | |
| 需要持續 UI（chat、瀏覽） | | ✓ (PanelSkill) |
| 結果是「答案 / 結構化資料」回給 agent | ✓ | |
| 結果是「畫一個表單給 user」 | | ✓ (SurfaceSkill) |

兩者可以混 — 同一份 FAQ 既當 `registerQA` 工具（讓 agent 自己查），也用 PanelSkill 提供「直接瀏覽 FAQ」入口。

## 跨文件

- [SurfaceSkill / PanelSkill](../skills/overview.md) — 使用者主動觸發的另一條路。
- [Evals](./evals.md) — 測試你的 tool 被 agent 正確呼叫。
- WebAgent `ActionDefinition` — `parameters` JSON Schema 細節走 webagent doc。
