# Memory

Session-only 對話記憶。存當下 host 想餵回 LLM 當 context 的近期 turn / 觀察。Reload 就清掉(設計如此)— 長期持久化是 host 的責任。

## 為什麼只做 session

Toolbox 畫死一條線:

| 層級 | 放哪 | 誰擁有 |
|---|---|---|
| 靜態 catalog / FAQ | build-time JSON → 瀏覽器記憶體 | host(build pipeline)|
| 對話 context | toolbox `memory`(這個模組)| toolbox |
| 長期 customer state | host 自家後端 DB | host |

如果使用者有 profile、退貨歷史、帳戶設定 — 那些屬於**你的後端**。每個 turn 透過 `WebAgentConfig.contextProvider` 注入,**不是**用這個模組。

## 快速上手

```ts
import { createMemory } from '@perhapxin/dddk/agent';

const memory = createMemory({
  storage: 'memory',         // 'memory'(預設)或 'indexeddb' tab 重開仍在
  customerId: 'cust_4823',
});

memory.addDrawer({ text: 'user said: my item is broken', ts: Date.now() });
memory.addRoom({  text: 'shipped to apartment 4A, Tainan', ts: Date.now() });
memory.addWing({  text: 'order ORD-1002 → $990 charged on 2026-05-20', ts: Date.now() });

const recent = await memory.recent({ limit: 20 });
const hits   = await memory.search('broken', { limit: 5 });
```

## 三種 bucket

Memory 開三個命名 bucket — wings / rooms / drawers — 讓 host 區分:

| Bucket | 意圖 | 例子 |
|---|---|---|
| `drawer` | 短期當下提及 | "user just said X" |
| `room`   | session 內 context | "they're on the checkout page" |
| `wing`   | 字面快照 | "order ORD-1002, total $990, paid Visa" |

三個都可以 query;命名只是幫 debug。

## Host 管持久化 pattern

```ts
// Session 啟動時 — 從後端載入 facts:
const session = createMemory();
const facts = await myBackend.getLongTermFacts(customerId);
for (const f of facts) session.addWing({ text: f.text, ts: f.ts });

// Session 結束時 — 把重要的升級到後端:
panelSkill.onLeave = async () => {
  const drawers = await session.recent({ limit: 100 });
  for (const d of drawers) {
    if (await isImportant(d)) {
      await myBackend.insertLongTermMemory({ customerId, fact: d.text, ts: d.ts });
    }
  }
};
```

Toolbox 不判斷什麼「重要」— 那是 host 的領域知識。

## 不是 webagent 工具(刻意)

跟 `qa` / `search` / `classify` / `recommend` 不同,這個模組**不**透過 `dddk.tools.registerMemory()` 暴露。

原因:LLM 不該需要「呼叫」memory。近期 turn 應該已經在 system prompt 裡(透過 `contextProvider` 或 message history)。Customer 長期 facts 也是走 `contextProvider`。加 memory 當工具只會多一層令人困惑的繞路。

`memory` 模組是給 **host code** 用的(skill、sidebar、debug panel)— 想 query session state 用這個。

## API

- `createMemory({ storage, customerId })`
- `memory.addDrawer({ text, ts, meta? })`
- `memory.addRoom({ text, ts, meta? })`
- `memory.addWing({ text, ts, meta? })`
- `await memory.recent({ limit, bucket?, since? })`
- `await memory.search(query, { limit, bucket? })`
- `memory.clear({ bucket? })`
