# Memory

兩套並存的記憶系統。選擇符合你形狀的：

| 系統 | 適用 | Storage |
|---|---|---|
| **Memory v1** — 3 層 hybrid（core / episodic / semantic） | 想要 agent 自動跨 run 記住 user profile + 過去 session + 可召回事實 | 預設 `localStorage`；semantic 那層 host 自接 |
| **DrawerMemory** — verbatim drawer + BM25 | 想要 host 顯式寫入的可查詢筆記庫 | `memory`（預設） / `localStorage` / `indexeddb` |

都是 opt-in。預設 `new DotDotDuck({})` 沒有 memory。

## Memory v1

三層，每層獨立 opt-in。

```ts
import { DotDotDuck } from '@perhapxin/dddk';

const dddk = new DotDotDuck({
  memory: {
    core: {
      schema: { language: 'string', tone: 'string', recent_pages: 'array' },
      storage: 'localStorage',
      maxBytes: 2048,
    },
    episodic: {
      enabled: true,
      maxEntries: 50,
      replayTopK: 3,
      relevance: 'recency', // 或 'keyword'
    },
    semantic: {
      provider: myVectorProvider, // host 自接
      writeMode: 'explicit',
    },
    privacy: {
      requireConsent: true,
      retentionDays: 90,
      excludePatterns: [/myCustomPattern/],
    },
  },
});
```

### Tier 1 — core

結構化 user profile。Always-in-context。Hard byte cap。Schema 強制欄位形狀：

```ts
dddk.memory.core?.set('language', 'zh-TW');
dddk.memory.core?.set('tone', 'concise');
dddk.memory.core?.get('language'); // 'zh-TW'
```

每次 run 都會 render 成 `# About this user` system-prompt block。

### Tier 2 — episodic

過去 session summary 的 ring buffer：

```ts
// host 在 session 結束時呼叫 — 通常在 agent_run_completed 之後
dddk.memory.endSession({
  summary: '幫使用者了解商業授權方案分級',
  taskSummary: '介紹商業授權方案',
  turnCount: 4,
});
```

Render 成 `# Past relevant sessions` system-prompt block。`relevance: 'recency'` 取最近 N 筆；`'keyword'` 對新 query 做 token overlap。

### Tier 3 — semantic

host 實作 `MemoryProvider`：

```ts
interface MemoryProvider {
  remember(entry: Omit<SemanticMemoryEntry, 'id' | 'timestamp'>): Promise<string>;
  recall(query: string, opts?: { topK?: number; tags?: string[] }): Promise<SemanticMemoryEntry[]>;
  forget(id: string): Promise<void>;
  list?(opts?: { tags?: string[]; limit?: number }): Promise<SemanticMemoryEntry[]>;
}
```

每次 run 開始 dddk 會呼 `recall(userQuery, { topK: 5 })`。回傳的 entries render 成 `# Recalled facts` system-prompt block。

dddk 不嵌入、不持久化 — provider 自己負責 infra。

### 隱私

| 欄位 | 效果 |
|---|---|
| `requireConsent: true` | 首次寫入觸發 host consent hook |
| `retentionDays` | 過期的 episodic entries 在 read 時被丟掉 |
| `excludePatterns` | regex 集合；命中的文字 write 前被丟。預設包含信用卡 / API key / private key 形狀 |

### 自動 inject

任何一層接上後，`dddk.startAgent(task)` 會自動跑 `memory.buildContext(task)` 並 prepend 到 task。不用手動接線。

## DrawerMemory

verbatim 筆記庫（0.1.0 的 `Memory` 改名）。

```ts
import { DrawerMemory, createDrawerMemory } from '@perhapxin/dddk/agent';

const memory = new DrawerMemory({
  storage: 'memory',         // 'memory'（預設）/ 'localStorage' / 'indexeddb'
  customerId: 'cust_4823',
});

memory.addDrawer({ text: '使用者說：我的東西壞了', ts: Date.now() });
memory.addDrawer({ wing: 'orders', room: 'ORD-1002', text: '訂單 ORD-1002 → 2026-05-20 收款 $990', ts: Date.now() });

const recent = await memory.recent({ limit: 20 });
const hits   = await memory.search('broken', { topK: 5 });
```

### wing / room scope

Drawer 可掛 optional `wing`（主分類）+ `room`（子分類）。Search 可 scope：

```ts
await memory.search('refund', { scope: { wing: 'orders' } });
await memory.wing('orders').room('ORD-1002').search('paid');
```

### 設計上不是 webagent tool

DrawerMemory 是給 host code 用的 — 一個 skill、一個 sidebar、一個 debug panel 想查 session 狀態。**不會** export 成 LLM 可呼叫的 tool。LLM 該看的長期事實走 Memory v1（semantic 那層）。

## 哪個用什麼時候

- 「Agent 該知道使用者偏好中文」→ **Memory v1 core**
- 「Agent 該記得上週聊過什麼」→ **Memory v1 episodic** + **semantic**（如果你有 vector 召回）
- 「我想記 customer service 筆記讓 agent 後續查」→ **DrawerMemory**（host code 自己寫入）
- 「我想要型別化的 key-value session 狀態給 skills 用」→ 用 SDK preferences，不是 memory

## 共存

同一個 `DotDotDuck` instance 可以兩套都開 — `dddk.memory` 是 3 層 instance，`new DrawerMemory(...)` host 想擺哪就擺哪。

## 向後相容

舊的 `Memory` / `createMemory` export 仍然 resolve 成 `DrawerMemory` / `createDrawerMemory` 的 alias。0.2 會 log deprecation warning。
