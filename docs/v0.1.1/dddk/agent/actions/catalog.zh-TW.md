# webagent — Action Catalog

> Agent 能用的所有 tool。LLM 透過 function calling 呼叫。

## 設計原則

- 每個 action 都有明確的 input schema（Zod / JSON Schema）
- 每個 action 都是 idempotent，或明確標記 side-effect
- 失敗回標準化的 error（不會 throw 給 agent loop）
- DOM 操作前先 `query` 一次確認存在，找不到就回 `{ ok: false, reason: 'not_found' }`

## 完整清單（內建 12 個）

### 導頁 / 頁面控制

| Action | 參數 | 行為 |
|---|---|---|
| `navigate` | `{ path }` | SPA-friendly 換頁。固定會走 Space 確認流程（runtime 會先發 `confirm` event） |
| `scroll_to` | `{ selector }` | 平滑滾到該元素，講某個視窗外的東西之前先 scroll |
| `wait` | `{ ms?, selector?, timeout? }` | 兩種模式 — 睡 `ms` 毫秒，或輪詢直到 CSS `selector` 出現（搭配 `timeout`），上限 5 秒 |

### DOM 互動

| Action | 參數 | 行為 |
|---|---|---|
| `click` | `{ selector }` | 點擊元素。送出表單也用這個 — submit button 就是個 button，沒有獨立的 `submit_form` |
| `fill_input` | `{ selector, value }` | 填 input / textarea（會 dispatch `input` + `change`） |
| `select_option` | `{ selector, value }` | 選 `<select>` 的選項 |
| `clear_input` | `{ selector }` | 清空欄位 |
| `press_key` | `{ key, selector? }` | Dispatch 鍵盤 event（keydown + keyup）。`key` 是 W3C key 名稱（`"Enter"`、`"Escape"`、`"ArrowDown"`、`" "`、單字元）。`selector` 省略 = `document.activeElement`。Enter 送出、Escape 關閉、Arrow keys 移動等都靠這個 |

### 視覺 overlay（給使用者看）

| Action | 參數 | 行為 |
|---|---|---|
| `border` | `{ selector, color?, label? }` | 加框。`border` / `highlight` 會自動清掉之前的 overlay，沒有 `clear_overlays` 工具。**CoT mode 下 `border` 從 model tool list 隱藏** — 框元素是透過 `narrate.about` 設定（見下）。Action 本身還在註冊內、給 classic loop / customActions 用 |
| `highlight` | `{ selector, color?, label? }` | 加底色 — 適合 inline 段落。同樣自動清掉舊 overlay。預設沒在 builtin set 裡，要 opt-in 透過 `customActions` |

### 跟使用者溝通

| Action | 參數 | 行為 |
|---|---|---|
| `pause` | `{ note? }` | 等使用者按 space。**CoT mode 下隱藏** — runtime 每個 narrate 後會自動 pause，曝露 `pause` 反而會雙 pause。Classic mode 還有 |
| `ask_user` | `{ question }` | 問純文字問題 |
| `ask_user_choice` | `{ question, options[], allowFreeText? }` | 多選 picker（2–6 個選項，可選 free-text fallback） |

#### `ask_user` vs `ask_user_choice`

當答案空間是 2–4 個短選項時，**優先**用 `ask_user_choice` — 它在 host 端 render 成可點 / 數字鍵選的 picker（推薦走 [`Subtitle.showChoice`](../../modules/subtitle.md#%E5%A4%9A%E9%81%B8-picker-showchoice)），使用者不用打字。只有當答案真的需要自由文字（「描述你的問題」、「貼 email」這種）才用 `ask_user`。

`allowFreeText` 預設 `true`：picker 的最後一列是 free-text 輸入，使用者可以打不在清單裡的答案。送出時直接交付成使用者打的字串 — agent 拿到的就是該字串，沒有特殊 sentinel；host 在 event 層用 `index === -1` 區分是 free-text 還是 canonical 選項，然後呼叫 `agent.respond(value)`。

兩個 action 行為對等：呼叫後 agent 進入 `waiting`，loop 停在那裡直到 host 呼叫 `respond(value)`。

### Selector 寫法 — DOM dump 的 `[id]` 雜湊

上面所有 `selector` 參數都同時接受 DOM dump 給的 `[id]` 雜湊（`"a1b2"`、`"[a1b2]"`、甚至 `"↓[a1b2]"`）或 CSS selector。DOM reader 把頁面上每個可操作的元素都加上一個 per-element 雜湊，LLM 把這個 hash 傳回來當 `selector`，runtime 用 per-turn 索引表查回 element。CSS selector 還是支援，但雜湊是主要管道，避免 LLM 自己猜 selector。

**絕對不要憑空編 CSS selector** 像 `#command-X` 之類 — 頁面不一定真的用這個 ID。永遠從這一輪的 DOM dump 抄 hash。

### 結束（CoT mode）

CoT envelope 有顯式的結束信號：

- `{ task_finish: true }` — 放在 `actions[]` **最後**一項，當使用者的 task 已經完整滿足。Runtime 跑完前面 actions 立刻結束 loop。**不要**跟 `ask_user_choice` / `navigate` / `click` / `fill_input` 等「結果還沒讀」的 tool 同 turn — runtime 會 drop 誤用的 task_finish 並 log warning
- 空 / 省略 `actions` — 舊式收尾路徑；沒 actions runtime 自然關掉字幕條

Classic（非 CoT）mode：model 該 turn 只有文字、沒 tool call 時（`finish_reason=stop`）自動結束。

### Narrate envelope — `narrate.about` 自動 border

CoT mode 的 `agent_turn` envelope `actions[]` 接受 `{ narrate: string, about?: string }`。`about` 填 element 的 `[id]` hash 時，runtime 會在 stream narrate 之前**自動呼叫 `border`**。不用另外 chain 一個 `border` action — framing 直接綁在 narrate object 上。這也是上面 `border` 在 CoT tool list 被隱藏的原因。

## Action Result 標準格式

```ts
type ActionResult =
  | { ok: true; data?: any }
  | { ok: false; reason: ActionFailureReason; message?: string };

type ActionFailureReason =
  | 'not_found'       // selector 沒找到
  | 'not_visible'     // 元素存在但不可見
  | 'not_interactive' // 元素 disabled / readonly
  | 'timeout'         // wait_for 超時
  | 'navigation'      // 換頁中途被打斷
  | 'unknown';
```

Agent loop 會把 result 加進 session.steps，下一輪 LLM 看得到失敗原因，可以自我修正。

## Selector 規範

LLM 回的 selector 必須是 **CSS selector**，但有限制：
- 只能用 tag / id / class / `[data-*]` attribute / `:nth-child()`
- **禁止** `:has()`、`:not()` 這類可能讓 NodeList 大爆炸的選擇器
- 禁止 `*`（全選）
- 找到多個元素時，預設取第一個可見的，但 `result.data` 會帶 `{ matched: N, used: 0 }` 提示

複雜選擇用 `data-webagent-id` 屬性（DOM Reader 會自動加 fallback id）。

## 自訂 action 範例

```ts
import { z } from 'zod';

agent.config.customActions = [
  {
    name: 'open_chat_panel',
    description: '在右側打開聊天面板',
    parameters: z.object({
      initialMessage: z.string().optional(),
    }),
    handler: async ({ initialMessage }, ctx) => {
      myUI.openChatPanel(initialMessage);
      return { ok: true };
    },
  },
];
```

## 關掉用不到的內建 action

上面表格列的每個 action 預設都會註冊，這樣任何 host 接上 SDK 就能跑。但如果你網站只用到一個子集（例如沒有 `<select>` 元素、沒有破壞性操作、不需要 agent 反問使用者），可以用 `disableBuiltinActions` 把列在裡面的 action 從 agent 看到的 tool schema 完全拿掉，降低每 turn 的 token 成本、也減少「選錯工具」的可能。

```ts
new DotDotDuck({
  // …
  webAgent: {
    disableBuiltinActions: [
      'pause',            // runtime 在 narrate 後自動 pause；只有破壞性動作前才需要這個 tool
      'wait',             // 沒有 async UI 要等
      'select_option',    // 沒有 <select> 元素
      'clear_input',      // 罕見的情況用 fill_input('') 就能解
      'ask_user',         // 一次性 Q&A — agent 不該主動反問
      'ask_user_choice',  // 同上
    ],
  },
});
```

`highlight` 預設**沒**註冊 — 想跟 `border` 並用半透明填色標記，需要透過 `customActions` 自己加回去。`present_surface` 同樣 opt-in，要設 `allowPresent: true` 才會出現。兩個都仍受 `disableBuiltinActions` 影響，即使 opt-in 之後還是可以列進去關掉。

## Action vs Direct API

Action 是「LLM 可呼叫」的。如果你要 host 直接觸發某些行為（不透過 LLM），用 `agent.executeAction(name, params)` 直接執行，不會記進 session.steps。

## 不會做的 action（明確列出避免被問）

- ❌ `eval_js` — 太危險，不開
- ❌ `fetch` — 改用 custom action 包，不要直接讓 LLM 發任意 request
- ❌ `localStorage_set/get` — 改用 custom action

注意：沒有 `screenshot` **action**（LLM 不能主動要求截圖），但 agent **可以**看到頁面 — 打開 `WebAgentConfig.screenshot`，每一輪 viewport / 整頁的圖片會跟著 DOM dump 一起送進去。詳見 [screenshot 設定](../screenshot)。
