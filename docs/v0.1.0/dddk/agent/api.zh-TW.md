# webagent — 公開 API

## 安裝

```bash
npm install @perhapxin/dddk
```

## 最小範例

```ts
import { WebAgent, OpenAIProvider } from '@perhapxin/dddk';

const agent = new WebAgent({
  llm: new OpenAIProvider({ apiKey: 'sk-...' }),
  locale: 'zh-TW',
});

agent.on('subtitle', (text) => console.log('Agent:', text));
agent.on('done', () => console.log('Done'));

await agent.run('幫我把標題改成「年度報告」');
```

## 主要 class

### `WebAgent`

```ts
class WebAgent {
  constructor(config: WebAgentConfig);

  // 控制
  run(task: string, options?: RunOptions): Promise<void>;
  resume(): Promise<void>;          // 接回持久化的 session
  stop(): void;
  destroy(): void;                  // 完整 unmount（host 收掉時呼叫）
  isRunning(): boolean;

  // Session
  getSession(): AgentSession | null;
  clearSession(): void;

  // Tool 註冊（constructor 之後再加 action）
  registerAction(action: ActionDefinition): void;

  // 互動回應 — 收到 ask_user 或 ask_user_choice event 之後呼叫，
  // 把答案送回 loop 繼續跑。
  respond(answer: string | Record<string, unknown>): void;

  // Events (EventEmitter API)
  on<E extends AgentEventName>(event: E, handler: AgentEventHandler<E>): void;
  off<E extends AgentEventName>(event: E, handler: AgentEventHandler<E>): void;
}
```

### Config

```ts
interface WebAgentConfig {
  llm: LLMSource;            // LLMProvider 或 LLMRouter — 見 llm/providers
  locale?: string;           // BCP-47（'en'、'zh-TW'、'ja-JP' ...）。
                             // 當作「用戶輸入曖昧時的預設回覆語言」用
                             // —— 例如 "hello"、純 URL、單一表情符號。
                             // 用戶寫出明確句子時，model 仍會用該句語言回。
                             // 預設取自 navigator.language。
  maxSteps?: number;         // 預設 30 — 一個 task 內 tool-call 迴圈上限
  maxErrors?: number;        // 預設 3 — 連續 LLM call 失敗到此次數就放棄
  llmTimeoutMs?: number;     // 預設 60_000 — 單一 LLM call hard timeout

  // 每個 step LLM call 的 reasoning 預算。預設 'off' — 從固定 registry
  // 選 action 本來就不需要 reasoning，跳過可以在 reasoning-capable model
  // （gpt-5 / o-series / Gemini 3.x）省下每輪 5-8 秒延遲。沒有 reasoning
  // 模式的 model 會忽略這個 flag。自訂 action 想讓 model 多想一點再選的話
  // 設成 'low' / 'medium' / 'high'。
  thinking?: 'off' | 'low' | 'medium' | 'high';

  // Prompt 分層 — 見 prompt-design
  brand?: BrandPrompt;                 // 結構化的產品 context（推薦）
  persona?: string | PersonaConfig;    // 第一人稱身分（「你 ARE X、用『我們』來說話」）
  appendSystemPrompt?: string;         // 自由文字，接在預設 prompt 後面
  systemPrompt?: SystemPromptOverride; // string（硬替換）或 fn(ctx, default) => string

  sitemap?: SitemapConfig;             // SitemapEntry[] 或 SitemapNode tree
  agentName?: string;                  // 顯示名（預設 'Agent'）
  siteName?: string;
  customActions?: ActionDefinition[];  // host 註冊的 action

  // 進 turn loop 前的 planning callback — 設了就在 loop 開始前先發一次
  // planning call、把回傳的 TaskPlan 存到 session、把 per-turn envelope
  // 切到 planned 版本（turn_planning + todo_adjust + actions，沒有
  // todos_remaining）。一般 wire 法：`(input) => plan.makeTodos(input)`
  // 其中 `plan` 是 `Plan` instance — 詳見 [Plan 模組文件](./plan.md)。
  planner?: (input: PlanInput) => Promise<TaskPlan>;

  // 設了 `planner` 時，再加這個 = true → planner 的 `task_summary` 會在
  // turn 1 開始前 stream 進字幕條，然後 runtime 主動 await 用戶按 Space
  // 才開始 loop（避免後續 navigate 確認 dialog 蓋掉 announce）。預設 false。
  announcePlan?: boolean;
  // 每個 action 的 description 覆蓋 — 在組 tool 時套用。
  // key 是 action 名字；`description` 硬替換，`appendDescription` 接在
  // SDK 預設後面、用 `\n` 隔開。詳見 prompt-design。
  actionOverrides?: Record<string, { description?: string; appendDescription?: string }>;
  sessionStorageKey?: string;          // 預設 'webagent.session'
  toolDefinitions?: ToolDefinition[];  // 進階：覆蓋整份 tool 清單
  crossTabSync?: boolean;              // 預設 false — 見 session-continuity

  // 多輪延續：在這個時間視窗內 follow-up 會附加到同個 session 上。
  // 傳 `0` 關閉延續，每次 runStream() 都重起。預設 5 * 60 * 1000。
  sessionContinuityMs?: number;
  // `'time'` 看 `sessionContinuityMs`；`'palette'` 在面板關閉時結束延續
  //（host 透過 `dddk.endAgentContinuity()` 通知）。
  sessionScope?: 'time' | 'palette';

  // History 修剪 — prompt 太長時丟掉最舊的 turn。兩個都選填，可疊加。
  // 見 dom-format / prompt-design。
  maxTurnsInPrompt?: number;           // turn 數量上限
  maxPromptTokens?: number;            // token 估算上限（char ÷ 3.5）

  // DOM dump 塑形 — 索引 `[N]<tag>` 格式見 dom-format。
  // domFilter：回傳 false 把元素 + 子樹丟掉。
  // domMaxLength：dump 字數上限（預設 ~12000）超過會 truncate。
  domFilter?: (el: Element) => boolean;
  domMaxLength?: number;

  // 自訂 destructive-action 正規表達。name 命中這些 regex 的 action
  // 自動進 `confirm` gate。傳空陣列關掉內建 pattern 表，只走每個
  // action 自己的 `requireConfirmation`。
  destructivePatterns?: RegExp[];

  // `pause` tool 沒給 note 時的 subtitle bar fallback 文字。SDK 預設英文
  //（'Press space to continue'）。Host 自己傳當地語言以提供在地化 UX。
  defaultPauseNote?: string;

  // 可選的視覺截圖，每一輪都跟著 LLM 訊息送出去。預設關閉。`true` 是
  //「viewport 模式」的速記。完整選項（模式、切片高度、自訂 capture）
  // 見 ./screenshot.md。
  screenshot?: boolean | ScreenshotConfig;

  // Agent loop 結束時的行為（CoT `actions: []` / classic 沒 tool call /
  // 撞 maxSteps）。沒設這個的話字幕條會直接消失，看起來像壞掉。
  // SDK 預設 `{ kind: 'text', text: '✓ 執行完畢', autoHide: 3000 }`。
  // 詳細 union 看下方 OnLoopEnd。
  onLoopEnd?: OnLoopEnd;

  // 不要曝光給 agent 的內建 action 名單。預設套完整 12 個內建
  //（navigate / scroll_to / wait / click / fill_input / select_option /
  // clear_input / border / pause / ask_user / ask_user_choice）讓任何
  // host 接上就能跑；只用子集的網站把不需要的名字列在這裡，
  // 縮 LLM 看到的 schema、減少「選錯工具」的失敗模式。詳見
  // actions/catalog。
  disableBuiltinActions?: string[];
}

type OnLoopEnd =
  // 舊行為：字幕條結束時直接消失。
  | { kind: 'silent' }
  // 串流結束文案（如「✓ 執行完畢」），autoHide 毫秒後自動關閉。
  | { kind: 'text'; text: string; autoHide?: number }
  // 結束文案 + Space（滿意）/ 雙擊（不滿意）手勢收集。
  // 字幕條走 `persistent: true` — 不會自動關閉、Esc 不關、外部點擊不關，
  // 用戶必須選同意或拒絕。任一選擇都會在 intent stream 發出
  // `agent_feedback`（`satisfied: true | false`）。
  | { kind: 'feedback'; text: string }
  // 多選題（例如 1-5 分評分）。選到的值寫進 `agent_feedback.summary`，
  // 字幕條 persistent 行為跟 feedback 一樣。
  | { kind: 'ask_user'; question: string; options: Array<{ value: string; label: string }> };

interface SitemapEntry {
  path: string;
  description: string;
  aliases?: string[];        // 可選的自然語言別名（「設定頁」→ /preferences）
}
```

`SitemapConfig` 接受兩種：扁平的 `SitemapEntry[]`（小站簡單用）或 `SitemapNode` tree（頁數超過 ~8 之後比較好用 — 見 [sitemap/tree](./sitemap/tree.md)）。

## RunOptions

```ts
interface RunOptions {
  /** 用戶 invoke agent 的當下選了什麼。 */
  selection?: SelectionContext;
}

interface SelectionContext {
  /** 被選的文字（如果有）。 */
  text?: string;
  /** 被選的圖片，base64 或 URL（如果有）。 */
  images?: string[];
  /** 頁面上的選取 bounding box。 */
  bbox?: { x: number; y: number; width: number; height: number };
  /** 用戶點 / 多選的 CSS selector 或 DOM path。 */
  elements?: string[];
}
```

當 host 觸發 agent 的那個手勢本身就帶目標（長按某段話、lasso 拉到某塊圖、點某一列），就把 `selection` 填好，LLM 才知道要對什麼東西做事。

| 欄位 | host 何時填 |
|---|---|
| `text` | 用戶有 text selection（`getSelection().toString()`），或長按某個元素 — 把它的可見文字傳進來。 |
| `images` | 用戶選 / 丟一張圖。base64 data URL 或可抓的 URL 都行 — LLM provider 自己處理上傳。 |
| `bbox` | 拖選 lasso、截圖切片、「問這塊區域是什麼」這類手勢。座標是頁面相對。 |
| `elements` | 用戶點了一或多個元素（Dwell 長按、Spotter ring、多選）。傳當下頁面上能 resolve 的 CSS selector。 |

Agent 會把 selection 序列化成 system prompt 裡的 `# User selection at invocation` 段 — LLM 看到時當作這次任務的首要 context。如果 `llm` 是 `LLMRouter` 而且設了 `webagentWithSelection`，這一輪就用那個（比較便宜的）model 跑（selection 任務多半是一發完成的摘要 / 釐清，不需要頂級模型）。

```ts
// 長按一段話 → 「幫我摘要」
await agent.run('幫我摘要這段條款', {
  selection: {
    text: '雙方任一方可提前 30 天書面通知終止本協議…',
    elements: ['#clause-4'],
  },
});

// Lasso 一塊圖表區域 → 「這塊有什麼異常？」
await agent.run('這塊區域有什麼異常?', {
  selection: {
    bbox: { x: 240, y: 480, width: 360, height: 220 },
    images: ['data:image/png;base64,iVBORw0KGgo...'],
  },
});
```

## Events

下面列出的 event 都是 agent loop 正在跑的時候 fire。Handler 按註冊順序同步呼叫；payload 含 `resolve` / `decide` callback 的 event（`ask_user`、`confirm_action`），loop 會停在那邊等 host 回 callback。

| Event | Payload | 何時 fire |
|---|---|---|
| `status` | `AgentStatus`（`'idle' \| 'thinking' \| 'executing' \| 'waiting' \| 'done' \| 'failed'`） | 狀態轉換時。 |
| `before_action` | `{ actionName: string; params: Record<string, unknown>; targetSelector?: string }` | LLM 挑好 action、但 handler 還沒跑之前。讓視覺層（agent 游標、action overlay）有一拍可以先把目標標出來。純資訊性，不用回任何東西。 |
| `step` | `AgentStep` | 每一個 action 跑完（成功或失敗）。 |
| `subtitle` | `string` | Agent 在 tool call 之間發出的自由文字。沒有 `show_subtitle` 工具 — LLM 在 tool call 之間 emit 的文字會透過這個 event 一個字一個字 stream 進中央底部的 subtitle bar。 |
| `piece_surface` | `{ surface: PieceSurface; placement: PiecePlacement }` | dddk 把 host 開的 Piece surface 轉發進來，讓 agent loop 知道現在畫面上有什麼。 |
| `ask_user` | `{ question: string; resolve: (answer: string) => void }` | Agent 呼叫內建 `ask_user` action。Loop 在 `waiting`，直到 host 呼叫 `resolve` 或呼叫 `agent.respond(...)`。 |
| `ask_user_choice` | `{ question: string; options: string[]; allowFreeText?: boolean; resolve: (answer: string) => void }` | Agent 呼叫內建 `ask_user_choice` action。Host 要 render 一個離散選項 picker（推薦走 dddk 的 [`Subtitle.showChoice`](../modules/subtitle.md#%E5%A4%9A%E9%81%B8-picker-showchoice)），然後呼叫 `agent.respond(chosenValue)` 把用戶的選擇送回 — 預設選項就傳該選項字串；`allowFreeText` 開時用戶用 free-text 列就傳他打的字。`waiting` 語意跟 `ask_user` 一樣。 |
| `confirm_action` | `{ actionName: string; params: Record<string, unknown>; message: string; decide: (approved: boolean) => void }` | `confirmEachStep: true` 時每個 action 前，或某個 action 標了 `requireConfirmation` 時。Host **必須**呼叫 `decide(boolean)` — `decide(false)` 會以「stopped by user」狀態結束 loop。 |
| `overlay_update` | `OverlayItem[]` | `border` / `highlight` / `inject` overlay 新增、改變、移除。每次傳完整的當前列表。呼叫 `border` 或 `highlight` 會自動清掉上一個 overlay — 沒有獨立的 `clear_overlays` action。 |
| `navigate` | `{ path: string }` | Agent 想換頁。換頁主控權在 host — 呼 `router.push(path)` 才能保持 SPA routing。 |
| `error` | `Error` | Loop 裡任何錯誤（LLM call、tool 執行、parse）。會計入 `maxErrors`。 |
| `done` | `AgentSession` | Loop 結束（status 是 `done` 或 `failed`）。Session 已持久化，會一起傳出來。 |

### `ask_user` / `ask_user_choice` — 會把控制權交還給 host 的 event

所有 event 裡面，只有 `ask_user`、`ask_user_choice`、跟啟用時的 `confirm_action` 會暫停 agent loop 並等 host callback。其他全部 fire-and-forget。`ask_user` 跟 `ask_user_choice` resolve 的是同一個 pending promise — 呼叫 `agent.respond(value)`（或直接呼叫 payload 裡的 `resolve(value)`）傳一個字串進去，loop 就會帶著該字串當 tool result 繼續跑。

結構化 UI 交給 dddk 的 Pieces 系統處理 — host mount 的 surface 透過 `piece_surface` 轉發進 agent 上下文（純資訊）。Host 收到 form 提交時呼叫 `agent.respond(data)` 把資料送回給 LLM 當 tool result。

## 互動模式範例

### 1. ask_user（純文字問答）

```ts
agent.on('ask_user', ({ question, resolve }) => {
  const answer = window.prompt(question);
  resolve(answer ?? '');
});
```

可以直接在 handler 裡呼 `resolve`（同步 prompt），也可以晚一點呼 `agent.respond(answer)`（非同步 UI 流程 — 你自家 dialog mount、用戶送出、你 call `respond`）。兩條路 resolve 的是同一個 pending promise。

### 2. Surface（結構化 form / dialog）

結構化 UI 不是 agent 自己渲染的 — 而是 host 透過 dddk 的 Pieces 系統開一個 Surface（例如 `dddk.tools.surface(...)`）。如果同時跑 webagent，dddk 會把該 Surface 轉發成 webagent 的 `piece_surface` event，讓 agent 上下文知道現在畫面上有什麼：

```ts
agent.on('piece_surface', ({ surface, placement }) => {
  yourRenderer.mount(surface, placement, {
    onSubmit: (data) => agent.respond(data),
    onCancel: ()      => agent.respond(''),
  });
});
```

整包用 `@perhapxin/dddk` 時 host 通常直接訂閱 dddk 的 `surface` event — 那邊用 `PieceRenderer` 渲染，submit 用 `dddk.submitSurface(data)`。完整流程見 [dddk 的 Surface renderer](../surfaces/renderer.md)。

### 3. Subtitle / overlay

```ts
agent.on('subtitle', (text) => {
  myUI.showBottomBar(text);
});

agent.on('overlay_update', (items) => {
  myUI.renderHighlights(items);
});
```

### 4. confirm_action（step-by-step 或 destructive action）

```ts
agent.on('confirm_action', ({ actionName, message, decide }) => {
  // 接到 subtitle bar：space 接受、double-tap / Esc 拒絕。
  myUI.showConfirm(message, {
    onAccept: () => decide(true),
    onReject: () => decide(false),
  });
});
```

Agent loop 會停在 `decide` 被呼叫之前。拒絕（`decide(false)`）會優雅地結束 loop（status `done`，summary `(stopped by user)`）— 不算 error。

### 5. before_action（預先把目標標出來）

```ts
agent.on('before_action', ({ actionName, targetSelector }) => {
  if (targetSelector) {
    myCursor.moveTo(document.querySelector(targetSelector));
  }
});
```

用這個 event 來動 agent 游標、或讓目標元素閃一下，讓用戶看清楚下一步要對哪裡動手。

## Navigation Hook

Agent 想換頁的時候不會自己 call `location.href` — 它發 `navigate` event，由 host 決定怎麼換（保留 SPA router 的友善度）：

```ts
agent.on('navigate', ({ path }) => {
  router.push(path);  // Next.js / SvelteKit / React Router
});
```

這樣 SPA 不會整頁 reload，host 也有機會在換頁前做檢查（auth、未存檔提醒之類）。

## 自訂 action

```ts
agent.registerAction({
  name: 'add_to_cart',
  description: 'Add a product to the shopping cart',
  parameters: {
    type: 'object',
    properties: { productId: { type: 'string' } },
    required: ['productId'],
  },
  handler: async ({ productId }) => {
    await fetch('/api/cart/add', {
      method: 'POST',
      body: JSON.stringify({ productId }),
    });
    return { ok: true };
  },
  requireConfirmation: true,        // 透過 confirm_action 問用戶
  confirmationMessage: (p) => `要把 ${p.productId} 加進購物車嗎？`,
});
```

Action 可以一開始就透過 `config.customActions` 註冊，也可以之後再用 `agent.registerAction(...)` 加。註冊之後 LLM 在 tool 清單裡看得到，會自己決定要不要 call。

### `executeAction` — 從 host 直接觸發 action

絕大多數情況都是 LLM 透過 agent loop 驅動 action 執行。Host 想直接觸發只有兩種情境：

1. **Deterministic shortcut** — 一個 hotkey 或 palette 指令，永遠做同一件事，不需要繞 LLM 一圈。
2. **Replay / scripted test** — 用已知參數直接跑 handler 來測試。

這兩種情境下，從 registry 撈 definition、自己組一個 `ActionContext` 直接呼叫 handler：

```ts
// 找出註冊好的 action
const def = agent.actions?.get?.('add_to_cart');
if (def) {
  const result = await def.handler(
    { productId: 'SKU-42' },
    {
      session: agent.getSession()!,
      signal: new AbortController().signal,
      emit: (event, payload) => agent.emit?.(event, payload),
    },
  );
}
```

底層 agent loop 也是走同一個 `executeAction` helper — 看 `src/agent/webagent/execute-action.ts`。注意：內建 `ask_user` 跟 `ask_user_choice` action 在那支 helper 裡有特殊處理（會註冊 pending resolver 等 `agent.respond(...)`）；host 在 loop 外直接 call handler 的話，這兩個都沒有地方可以 resolve，所以還是讓 loop 自己跑比較好。

## Type 完整匯出

```ts
import type {
  WebAgentConfig,
  RunOptions,
  SelectionContext,
  AgentSession,
  AgentStep,
  AgentAction,
  AgentStatus,
  AgentEventName,
  AgentEventMap,
  AgentEventHandler,
  ActionDefinition,
  ActionResult,
  ActionContext,
  ActionFailureReason,
  SitemapEntry,
  SitemapConfig,
  OverlayItem,
  OverlayType,
  PieceSurface,
  PiecePlacement,
  BrandPrompt,
  SystemPromptOverride,
  LLMProvider,
  LLMRouter,
  LLMSource,
  LLMRole,
  LLMMessage,
} from '@perhapxin/dddk';
```
