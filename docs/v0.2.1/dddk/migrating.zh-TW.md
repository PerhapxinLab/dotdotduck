# 升級到 v0.2.x

本頁講從任何 v0.1.x 升到 v0.2.x。0.1 → 0.2 只有**一個破壞性改動**（WebAgent action 目錄從 opt-out 翻成 opt-in）跟**一個預設值改動**（session continuity 預設變 0），其他都是加法。

**預估升級時間**：15 分鐘（如果你 host 用預設 action set 沒動過）；30 分鐘（如果你有傳 `disableBuiltinActions`）。

## 1. 升套件

```bash
pnpm add @perhapxin/dddk@0.2.1
```

## 2. 破壞性改動 — WebAgent action 目錄改成 opt-in

**之前（v0.1.x）**：WebAgent 預設裝 12 個 builtin action。Host 用 `excludeTools` / `disableBuiltinActions` 拔。

**現在（v0.2.x）**：預設只裝 `coreActions`（5 個）：`narrate`, `navigate`, `click`, `border`, `scroll_to`。其他都要 `customActions` 才會裝。

### 快速路線 — 完整還原 v0.1 行為

把 `builtinActions`（現在還是聯集 export）傳進 `customActions`：

```diff
-import { WebAgent } from '@perhapxin/dddk';
+import { WebAgent, builtinActions } from '@perhapxin/dddk';

 new WebAgent({
   ...,
+  customActions: builtinActions,
 });
```

你現有的 `excludeTools` / `disableBuiltinActions` 還是能用，只是現在作用在 `builtinActions` 聯集上。

### 推薦路線 — 只 opt-in 你會用的

v0.2 改這條的原因：實測 host 都會拔一半 bundled catalogue。改成 opt-in 把成本攤在前面、prompt 也變小。

```ts
import {
  WebAgent,
  coreActions,       // narrate · navigate · click · border · scroll_to
  formActions,       // fill_input · select_option · clear_input · press_key · hold_key · double_click · long_press · drag
  flowActions,       // wait · pause · ask_user · ask_user_choice
  extraActions,      // highlight · track_intent · escalate_to_human
} from '@perhapxin/dddk';

new WebAgent({
  ...,
  // 純看的 marketing / docs surface — 預設就夠。
  // 需要填欄位就加 formActions：
  customActions: [...formActions],
  // 對話型 agent 需要 pause 等使用者輸入：
  // customActions: [...formActions, ...flowActions],
});
```

### `disableBuiltinActions` → `excludeTools`

`disableBuiltinActions` 已 deprecated。原地改名 — 形狀一樣（`string[]` action 名稱）、行為一樣：

```diff
 new WebAgent({
-  disableBuiltinActions: ['wait', 'pause'],
+  excludeTools: ['wait', 'pause'],
 });
```

傳舊名字時 console 會顯示一行 warning；v0.3 會完全移除。

## 3. 行為預設值改動 — `sessionContinuityMs`

**之前**：5 分鐘內的下一次 `runStream()` 接著用同一個 session（LLM 看得到上一輪 turn）。

**現在**：預設 `0` — 每次 `runStream()` 都開新 session。

原因：絕大多數 webagent 用法是一問一答。把上一輪 turn 帶到下一輪會讓 LLM 把不相關的問題串在一起。

如果你在做對話型 agent（chat 風格 follow-up）就 opt-in 回來：

```ts
new WebAgent({
  ...,
  sessionContinuityMs: 5 * 60 * 1000,
});
```

跨頁面 continuity（SPA navigation 期間 loop 不斷）是獨立機制，不受影響。

## 4. 加法 — 新的 agent 種類跟 API

以下都不是必須的，想用 v0.2 新東西再看：

### TaskAgent

第三種 agent class（跟 WebAgent / InlineAgent 平行）。對話 + host 自定 tool、不讀 DOM。

```ts
import { TaskAgent } from '@perhapxin/dddk';

const support = new TaskAgent({
  llm: nano,
  systemPrompt: '回答客服問題。',
  tools: [{ name: 'lookup_order', description: '...', parameters: {...}, handler: ... }],
});
const reply = await support.ask('我的訂單在哪？');
```

### WebAgent 多 instance + 共享 session

註冊多個 WebAgent instance（每條 route 一個 persona），route 改變時切換 active：

```ts
const shared = dddk.sessions.get('demo');
const home = new WebAgent({ ..., session: shared });
const docs = new WebAgent({ ..., session: shared, persona: docsPersona });
dddk.agents.register('home', home, { active: true });
dddk.agents.register('docs', docs);
afterNavigate(({ to }) => dddk.agents.setActive(to.url.pathname.startsWith('/docs') ? 'docs' : 'home'));
```

### Live tool + provider registry

```ts
const toolHandle = webagent.registerTool({ name, description, parameters, handler });
toolHandle.remove();

const providerHandle = webagent.registerContextProvider('selection', async (req) => renderSelectionXml());
providerHandle.remove();  // 回到 SDK 預設 provider
```

六個 provider slot：`url`、`page_summary`、`dom`、`screenshot`、`history`、`selection`。

### 每個互動 action 都有游標

`cursorTrail: true` 以前只在 `click` 觸發。現在涵蓋 `click` / `border` / `highlight` / `fill_input` / `scroll_to` / `narrate-with-about`。同樣 config、涵蓋更廣 — 不用改。

### `formActions` 裡的新動作

- `double_click` — 真的 `dblclick` 事件，`ondblclick` handler 才會收到
- `long_press` — mousedown + touchstart → 等 → mouseup + touchend
- `drag` — 從元素 A 拖到元素 B，含 HTML5 drag 事件
- `hold_key` — keydown → 等 → keyup，push-to-talk / 按住 Ctrl 多選用
- `press_key` 加 `modifiers: ('ctrl' | 'shift' | 'alt' | 'meta')[]` 支援組合鍵（Ctrl+S、Cmd+K、Shift+Tab）

### 自架 analytics

```ts
import { EventStore, toCSV, toSQL } from '@perhapxin/dddk/analytics';
import { renderDashboard } from '@perhapxin/dddk/analytics/dashboard';
```

IndexedDB 本地 event store + CSV / NDJSON / SQL 匯出 + 6 張 chart 的迷你 dashboard。

## 5. v0.2.0 → v0.2.1

Patch release，不用改 code。

如果想 opt-out v0.2.1 新的 inline-diff 預覽（預設 `displayAs: 'inline-diff'`）、回到 v0.2.0 的直接 splice：

```ts
new InlineAgent({ ..., defaultDisplayAs: 'replace' });
```

或單一 action：

```ts
{ id: 'translate', label: 'Translate', displayAs: 'replace', ... }
```

## 6. 從 v0.1.2 或更早升

前面版本的 migration guide 也讀一下 — 每步都小、但累積起來還是要看過。
