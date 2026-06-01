# Session 連續性 — 跨頁面與分頁

> Status: 已實作於 `src/agent/webagent/webagent.ts` + `session.ts`。

## 這裡的「session」是什麼

一個 `AgentSession` 就是 agent 跑一個任務時的執行狀態：

```ts
interface AgentSession {
  id: string;
  task: string;           // the user's instruction
  steps: AgentStep[];     // tool calls so far
  status: AgentStatus;
  currentPage: string;    // URL pathname at last step
  startedAt: number;
  updatedAt: number;
  summary?: string;
}
```

webagent 每一步都會把它存起來。存的地方有三種，各自解鎖不同範圍：

| 儲存位置          | 同分頁換頁 | 同 origin 新分頁 | 跨 origin | 跨裝置 |
|------------------|:----------:|:----------------:|:---------:|:------:|
| `sessionStorage` |     ✅     |        ❌        |    ❌     |   ❌   |
| `localStorage` + `BroadcastChannel` |     ✅     |        ✅        |    ❌     |   ❌   |
| Host backend     |     ✅     |        ✅        |    ✅     |   ✅   |

## 同分頁換頁（預設 — sessionStorage）

開箱即用，每個 webagent instance 每一步都會存到 `sessionStorage[webagent.session]`。當 agent 呼叫 `navigate('/billing')`：

- URL 改變（host 的 `onNavigate` handler）。
- React 重 render，host 在新頁面重新 mount dddk。
- 新的 dddk instance 構造一個新的 WebAgent。
- WebAgent loop 注意到 URL 變了 → 更新 `session.currentPage` 並蓋上 `previousUrl`，所以下一輪 prompt 會包含「You arrived from `/crm`」。

`sessionStorage` 是 **per-origin per-tab**，所以 same-origin 換頁都通 — 包含 subdomain？**不行** — subdomain 的 sessionStorage 是分開的。見下面「跨 subdomain」。

如果要在頁面載入時 resume（例如用戶 refresh 了）：

```ts
const agent = new WebAgent({ llm });
await agent.resume();  // 如果有 session 就從 sessionStorage hydrate
```

dddk 會在 `mount()` 時自動做這件事。

## 跨分頁（同 origin） — `crossTabSync: true`

```ts
new WebAgent({ llm, crossTabSync: true });
// 或透過 dddk：
new DotDotDuck({ llm, webAgent: { crossTabSync: true } });
```

它做的事：

1. **`localStorage` 鏡像** — 每次 session save 也寫一份到 `localStorage[webagent.session.crosstab]`。同 origin 新開的分頁在構造時會讀它。
2. **`BroadcastChannel`** — 即時把 session 物件廣播給其他分頁。其他分頁如果 idle（沒在跑自己的 task）且廣播比自己 local 的 session 新，就會 adopt 廣播的版本。

所以：
- 用戶在 Tab A 開了任務 → 開 Tab B 在同 origin → Tab B 從 Tab A 上次的狀態接著走。
- 兩個分頁都 idle → 任一邊都可以 resume 任務。
- Tab A 跑到一半 → Tab B 看得到 update 但會禮貌等著（只在 idle 時 adopt）。

它**不**做的事：
- **不**允許兩個分頁同時驅動同一個 running agent。對話歷史是 last-writer-wins。
- **不**跨 origin（browser sandbox 限制）。

## 跨 subdomain（例如 `app.acme.com` ↔ `docs.acme.com`）

browser 把 subdomain 當作不同 origin 處理 `localStorage` / `sessionStorage`。有兩種做法：

### Pattern A — cookie + URL hash 接力

來源頁的 host code：

```ts
// 在連往 docs.acme.com 的連結上：
const sessionId = dddk.getAgent()?.getSession()?.id;
window.location.href = `https://docs.acme.com/page?dddkSession=${sessionId}`;
```

到目的 subdomain，host 讀 URL hash 然後跟 API 要 session：

```ts
const id = new URL(location.href).searchParams.get('dddkSession');
if (id) {
  const session = await fetch(`/a../session/${id}`).then(r => r.json());
  dddk.getAgent()?.adoptSession(session); // future API
}
```

這需要 host-side 儲存（你的 backend）— 沒有 client-side 的跨 origin store 可用。

### Pattern B — 第三方 iframe

比較不建議（UX 較差）。把次要的 subdomain 嵌成 iframe，透過 `postMessage` proxy webagent。

## 跨 origin（不同 parent domain）

client 端完全不支援。如果你有兩個獨立品牌（`acme.com` 跟 `umbrella-corp.com`）要共享 session，就需要 host backend 的 session store。用 agent 的 `clearSession()` / `getSession()` 把 JSON 在你自家管線裡送來送去。

## Agent 看到什麼導頁資訊

每一輪 prompt 都會包含：

```
- You arrived from: /crm
```

…前提是 `currentPage` 自上一步以來變過。Agent 可以拿這個來理解它剛剛點掉的連結。

## 什麼時候打開 `crossTabSync`

預設：**關** — 它每一步都要付一次 `localStorage` write + 一次 `BroadcastChannel` message。對大部分 demo 沒差，但 hot session loop 下會多幾 ms。

開的時機：
- 用戶真的會在任務中途開新分頁（shop / CRM workflow 很常見）。
- 你是多產品 suite，用戶會在新分頁之間跳。

關的時機：
- 單一產品 app，用戶都待在同一個分頁。
- 你反正會用 host backend 的 session store（你的 store 勝出）。

## Example demo 做了什麼

`dddk/example_website/src/App.tsx` 設了 `crossTabSync: true`，所以你可以：

1. 在 `/crm` 開一個 task。
2. `Ctrl+T` 開新分頁，貼 `http://localhost:5174/crm`。
3. 新分頁就接走對話歷史。

Try-It 頁面的 step 7 可以試。
