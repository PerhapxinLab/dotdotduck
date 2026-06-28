# v0.2.0 釋出說明

疊在 v0.1.3 上的大版本。新增第三種 agent class、把 action 目錄從 opt-out 翻成 opt-in、合成游標從只走 click 擴到每個互動動作、planner 開始讀 DOM、加上自架的 analytics stack。

**一個破壞性改動**：WebAgent 預設裝的 action 從 12 個減成 5 個（`coreActions`）。要還原 v0.1 行為，傳 `customActions: builtinActions`。

## 一句話總結

- **TaskAgent** — 第三種 agent class（跟 WebAgent / InlineAgent 並排）。對話 + host 自定 tool、不讀 DOM、plain protocol。`ask()` 回傳字串；`streamAsk()` 吐 chunk。同一個 `AgentSession`，多個 TaskAgent 可以共享歷史。
- **WebAgent 多 instance + 共享 session** — `dddk.sessions` 命名 session registry + `dddk.agents` 命名 agent registry。不同 agent（每個 route 一個 persona）可以共用同一份對話歷史。
- **加入制的 action bundle** — 預設只裝 `coreActions`（5 個：narrate / navigate / click / border / scroll_to）。要 `formActions` / `flowActions` / `extraActions` 就傳進 `customActions` opt-in。實測 host 幾乎都會 trim 一半的內建 action，opt-in 把成本攤在桌上。
- **每個互動動作都有游標** — `cursorTrail: true` 現在涵蓋 click / border / highlight / fill_input / scroll_to / narrate-with-about。`scroll_to` 會把游標切成滑鼠滾輪圖示。
- **Planner 讀 DOM** — 每次 planning 呼叫都會把當前頁面快照塞進 `hostContext`，planner 可以看到 sidebar 跟 nav link 即使 sitemap 設定漏列。
- **Navigate 路徑驗證** — `navigate` 動作會檢查 sitemap，未知 path 直接 reject 並把 valid path 回給 LLM 重試。Loop 不會再追 hallucinate 出來的路徑跑進 404。
- **Live registry** — `webagent.registerTool` 跟 `webagent.registerContextProvider` 升級為 first-class，回 handle 含 `remove()` 收尾。
- **自架 analytics + mini dashboard** — `@perhapxin/dddk/analytics`（IndexedDB EventStore + CSV / NDJSON / SQL 匯出 + function-based schema mapper）跟 `@perhapxin/dddk/analytics/dashboard`（6 張 SVG chart，EN + zh-TW、無 library 依賴）。
- **Streaming envelope 每個 action 立刻 dispatch** — 每個 action 的 `{}` 收齊就 fire，不等 envelope 關閉。
- **InlineAgent scoping** — `attachScope(selector, config)` 每個區域不同 action set。
- **`onLoopEnd` hook** — agent loop 收尾 UI：`silent` / `text` / `feedback` / `ask_user`。
- **Inline command palette + 多元 row** — `palette.mountInline(host)` 把 palette 常駐嵌進 host 元素（無 backdrop）。新增 `PaletteItem.lines: string[]` + `image` + `submitButton`。

## 破壞性改動

### 預設 action 從 12 個減成 5 個

**v0.1.x 之前**：WebAgent 預設裝 12 個 builtin action。Host 用 `excludeTools` 拔。

**v0.2.0**：預設只裝 `coreActions` — `narrate / navigate / click / border / scroll_to`。form / flow / extra bundle 都 opt-in。

```ts
import { WebAgent, coreActions, formActions, flowActions, builtinActions } from '@perhapxin/dddk';

// 還原 v0.1 行為 — 傳聯集
new WebAgent({ ..., customActions: builtinActions });

// 推薦 — 只 opt in 你會用到的
new WebAgent({ ..., customActions: [...formActions] });
new WebAgent({ ..., customActions: [...formActions, ...flowActions] });
```

`excludeTools` 還能用 — 從 bundle 裡拔單一項目時方便。

### `sessionContinuityMs` 預設 5 分鐘 → 0

**之前**：5 分鐘內的下一次 `runStream()` 會接著用同一個 session。

**現在**：每次 `runStream()` 都開新 session。要對話延續性的 host opt-in：

```ts
new WebAgent({ ..., sessionContinuityMs: 5 * 60 * 1000 });
```

原因：絕大多數 webagent 用法是一問一答。把上一輪 turn 帶到下一輪會讓 LLM 把不相關的問題串在一起。

跨頁面的 continuity（SPA navigation 期間 loop 不斷）是獨立機制，不受影響。

## 各別變更

### TaskAgent

新增 `TaskAgent` class — 對話型 agent，host 自定 tool、不依賴 DOM、plain protocol（標準 chat + OpenAI tool-calls）。跟 `WebAgent`（操作頁面）跟 `InlineAgent`（錨在選取上）並列。

```ts
import { TaskAgent } from '@perhapxin/dddk';

const support = new TaskAgent({
  llm: nano,
  systemPrompt: '回答 Acme Co. 客服問題，回答跟 user 問題同語言。',
  tools: [{
    name: 'lookup_order',
    description: '查訂單狀態 by id',
    parameters: { type: 'object', properties: { id: { type: 'string' } } },
    handler: async ({ id }) => fetch(`/api/orders/${id}`).then(r => r.json()),
  }],
});
support.attachTo(dddk);

const reply = await support.ask('我的訂單 12345 到哪了？');
```

打字機效果的 streaming 版本：

```ts
for await (const c of support.streamAsk('我的訂單 12345 到哪了？')) {
  if (c.toolCallStart) showSpinner(c.toolCallStart.name);
  if (c.toolCallEnd)   hideSpinner();
  if (c.delta)         append(c.delta);
  if (c.done)          flush(c.text);
}
```

共享 `AgentSession`：

```ts
const session = dddk.sessions.get('support-thread');
const sales   = new TaskAgent({ llm, systemPrompt: '銷售', session });
const billing = new TaskAgent({ llm, systemPrompt: '帳務', session });
```

### WebAgent 多 instance + 共享 session

`dddk.sessions` 是命名 session registry；`dddk.agents` 是命名 agent registry。註冊多個 `WebAgent` instance（每個 route 一個 persona），注入同一個 `AgentSession`，route 改變時切換 active。

```ts
const sharedSession = dddk.sessions.get('demo');

const homeAgent = new WebAgent({ ..., session: sharedSession });
const docsAgent = new WebAgent({ ..., session: sharedSession, persona: docsPersona });

dddk.agents.register('home', homeAgent, { active: true });
dddk.agents.register('docs', docsAgent);

afterNavigate(({ to }) => {
  if (to.url.pathname.startsWith('/docs')) dddk.agents.setActive('docs');
  else                                      dddk.agents.setActive('home');
});
```

`dddk.getAgent()` 回的是 active 那個；單 agent 的舊 host code 不用改。

### Action bundle + 新動作

| Bundle | 成員 | 預設？ |
|---|---|---|
| `coreActions` | `narrate`, `navigate`, `click`, `border`, `scroll_to` | ✅ 預設裝 |
| `formActions` | `fill_input`, `select_option`, `clear_input`, `press_key`, `hold_key`, `double_click`, `long_press`, `drag` | opt-in |
| `flowActions` | `wait`, `pause`, `ask_user`, `ask_user_choice` | opt-in |
| `extraActions` | `highlight`, `track_intent`, `escalate_to_human` | opt-in |
| `workflowActions` | `validate_form`, `wait_until` | opt-in |

新動作：

- **`narrate({text, about?})`** — `coreActions` 裡的 first-class action。CoT runtime 依然在 envelope 攔截；plain-protocol 的呼叫者會走 handler。
- **`hold_key({key, ms, selector?, modifiers?})`** — push-to-talk、按住 Ctrl 多選、按住放大。上限 5s。
- **`double_click({selector})`** — 真的 `dblclick`（不是兩次 `click`）。
- **`long_press({selector, ms?})`** — mousedown + touchstart → 等 → mouseup + touchend。預設 600ms。
- **`drag({from, to, steps?})`** — `from` 上 mousedown、沿路徑插值 mousemove、`to` 上 mouseup。同時發 HTML5 drag 事件，React-DnD / SortableJS / 原生 HTML5 DnD 都吃。
- **`press_key` 加 modifiers** — 新增 `modifiers: ('ctrl' | 'shift' | 'alt' | 'meta')[]` 支援組合鍵（Ctrl+S、Cmd+K、Shift+Tab）。

### 每個互動動作都有游標

合成游標（`cursorTrail: true`）現在涵蓋：

- `click` / `border` / `highlight` / `fill_input` — 游標滑到目標、抵達脈動、動作執行。
- `scroll_to` — 游標切成滑鼠滾輪圖示（`setCursorMode('scroll')`）、沿著捲動路徑走、落在終點、切回 pointer。
- `narrate({about})` — 合成 `border` call，游標 glide 自動跟著。

新的 runtime API：

- `moveCursorTo(el)` — glide 不 tap。
- `cursorPulse()` — 抵達脈動 flash。
- `setCursorMode('pointer' | 'scroll' | 'reading')` — 切換 SVG glyph。

`prefers-reduced-motion` 整路尊重。

### Planner 讀 DOM

Planner 在 agent ask 開頭跑一次。v0.2 把當前頁面 DOM 透過 `PlanInput.hostContext` 傳進去，planner 可以看到 sidebar / nav link 即使 sitemap 設定漏列。

```ts
new WebAgent({ ..., plannerDomMaxLength: 8000 });
```

Loop 用的 per-turn DOM（`domMaxLength`，預設 40000）是獨立的。

### Navigate 路徑驗證

WebAgent 有設 `sitemap` 時，`navigate` 動作會檢查 path 是否在 sitemap 裡。未知 path 直接 reject，把 valid path list 回給 LLM 下一輪重試。

```
ok: false
reason: 'navigation'
message: 'Path "/coming-soon" is not in this site\'s sitemap. The valid paths are: "/", "/try", "/docs", "/dashboard", "/platform", "/commercial". Pick one of those and retry.'
```

沒這個的話小 model 會從 route 描述裡的 label 詞 hallucinate 出路徑（看到「Coming soon」→ 跑 `/coming-soon`），撞 404。

### Live registry

```ts
const toolHandle = webagent.registerTool({ name, description, parameters, handler });
toolHandle.remove();

const providerHandle = webagent.registerContextProvider('selection', async (req) => {
  return renderUserSelectionAsXml();
});
providerHandle.remove();  // 還原 SDK 預設 provider
```

六個 provider slot 都有 SDK 預設：`url`, `page_summary`, `dom`, `screenshot`, `history`, `selection`。

### 自架 analytics

`@perhapxin/dddk/analytics`：

- **`EventStore`** — IndexedDB 本地 store。預設上限 5 萬 event / 30 天。可調 `{ cap, onFull: 'ring' | 'drop-new' | { notifyHost } }`。
- **匯出器** — `toCSV`、`toNDJSON`、`toSQL`（搭 `SqlSchemaMapper` 自訂 row 形狀）。
- **`dddk_events` 標準 DDL** 附 SQLite / Postgres / MySQL 版本。

`@perhapxin/dddk/analytics/dashboard`：

- **`renderDashboard(container, store)`** — 6 張 vanilla-SVG chart：event 量、palette item top、agent 完成率、feedback 分佈、語音用量、LLM 平均延遲。
- 繼承 `--dddk-*` theme tokens；EN + zh-TW labels；可選自動刷新。
- Host 用 `lineChart` / `barChart` / `donut` / `numberTile` primitive 自組 chart。

新增 intent event：**`agent_tool_failed`** — tool 回 `{ ok: false }` 或 throw 時 fire。

### Streaming envelope 每個 action 立刻 dispatch

CoT envelope 是 `{memory, turn_planning, actions: [a1, a2, …], is_final}`。v0.2 在每個 action 的 `{}` 收齊那一刻就 dispatch，不等外層 envelope 關閉。

```ts
new DotDotDuck({
  webAgent: { enableStreamingEnvelope: true },
});
```

實際效果：多 action 的 turn 裡，第一個 narrate 開始講話時，LLM 還在打第二個 action 的 JSON。

### InlineAgent scoping

```ts
const handle = inlineAgent.attachScope('article.editor textarea.comment', {
  actions: commentActions,
  systemPrompt: '簡短回應，這是留言區。',
});
handle.remove();
```

`appendActions` / `appendSystemPrompt` 是疊上 root；`actions` / `systemPrompt` / `llm` / `layout` / `tools` 是覆蓋。最內層 match 到的 scope 勝。CSS selector 表達不了的情境（data-attr 判斷、自訂 DOM walk）用 `setScopeResolver` callback。

### `onLoopEnd` hook

```ts
new WebAgent({
  ...,
  onLoopEnd: {
    kind: 'feedback',
    text: '這次有幫到你嗎？',
  },
});
```

種類：`silent`（無 UI）、`text`（auto-hide 訊息）、`feedback`（二元訊號 — Space 接受、雙擊拒絕、Esc 跳過）、`ask_user`（收尾多選問題）。

### Inline palette + 多元 row

```ts
const inline = dddk.palette.mountInline(document.getElementById('palette-host'), {
  placeholder: '搜尋…',
  focus: false,
});
// Ctrl/⌘+K 還能用 — 會把 modal 疊到 inline 上方。
inline();  // 收掉
```

`PaletteItem` 新增：

- `lines: string[]` — 多行 metadata 直欄。
- `image: string` — 縮圖 URL。
- `submitButton: boolean` — input 右側圓形送出鈕。

Palette section 排序修正：HeatRank-promoted 的 item 不會把它的 section header 推到最上。Section 順序跟著 host 註冊順序走。

### 字幕條：點擊 / 觸控 = Space

Touch 從 v0.1 就有單點接受 / 雙點拒絕。v0.2 擴到滑鼠 + pen — 點字幕條 = 按 Space；雙擊 = 雙按 Space。

### Session lifecycle 強化

- **硬重整清 session**。`performance.getEntriesByType('navigation')[0].type === 'reload'` 強制 fresh session，跟 `sessionContinuityMs` 無關。重整時 session 殘留會感覺像「鬧鬼」。
- **`sessionContinuityMs` 預設 0**（見上面破壞性改動）。
- **Navigate path validation** reject 未知路徑。

## 接下來（v0.3 roadmap）

從 v0.2 延後的項目：

- **跨類型 session 完整再序列化** — TaskAgent 讀 WebAgent 的 session 已經會了（CoT `agent_step` turn 直接跳過）；反過來 WebAgent 讀 TaskAgent 的 plain-chat turn 並重新包成 CoT 比較費工。
- **多 agent delegation** — TaskAgent 透過 tool 呼叫 WebAgent（或反過來）。可行但 orchestrator routing 複雜度需要實際 use case 驗證。
- **buildMessages 全面走 provider registry** — `url` / `page_summary` / `history` / `selection` / `screenshot` 都改走 provider；`dom` 因為 `currentIndexMap` 跟 selector resolution 綁死目前還是 inline。
- **TaskAgent tool-args 逐字 streaming** — `streamAsk` 已經 stream text delta + toolCallStart / toolCallEnd marker；tool 參數的逐字 stream（讓 host 邊 render「查詢 id `123…`」）排在 roadmap。
- **TaskAgent 跨 tab session 共享** — WebAgent 已 crosstab；TaskAgent 目前還沒。

## v0.1 → v0.2 升級 cheat sheet

```diff
- import { builtinActions } from '@perhapxin/dddk';
- new WebAgent({ ..., excludeTools: ['pause', 'wait', 'ask_user_choice'] });
+ import { coreActions, formActions } from '@perhapxin/dddk';
+ new WebAgent({ ..., customActions: [...formActions.filter(a => a.name !== 'select_option')] });

- new WebAgent({ ... });
+ new WebAgent({ ..., sessionContinuityMs: 5 * 60 * 1000 });
```

`builtinActions` 聯集還在 — 傳它就能完整還原 v0.1 行為。
