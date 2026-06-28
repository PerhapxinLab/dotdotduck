# Analytics

匿名 event 收集器。Track signal fire-and-forget,在記憶體內 batch
(選用同步寫 IndexedDB 做離線),按時間 / 大小門檻 flush,然後以
JSON POST 到 host 控制的 endpoint。

## 快速上手

```ts
import { createAnalytics } from '@perhapxin/dddk/modules/analytics';

const analytics = createAnalytics({
  endpoint: '/api/dddk/events',
  identity: () => ({
    session_id,           // 由 host 自己產生 + 保存
    visitor_id,
    locale: 'zh-TW',
    device: 'desktop',
  }),
  batchSize: 20,
  flushIntervalMs: 5000,
});
await analytics.init();

analytics.track('session.start');
analytics.track('page.view', { path: location.pathname });
analytics.track('voice.result', { status: 'attempt' });
```

Endpoint 收到的是 `AnalyticsEvent` 陣列:

```json
[
  {
    "ts": 1716543210000,
    "event": "page.view",
    "session_id": "...",
    "visitor_id": "...",
    "locale": "zh-TW",
    "device": "desktop",
    "payload": { "path": "/commercial" }
  }
]
```

## API

- `createAnalytics({ endpoint, identity, batchSize, flushIntervalMs, offlineBuffer, transport })`
- `await analytics.init()` — 啟動 flush timer、drain 離線 buffer
- `analytics.track(event, payload?, { identity? }?)`
- `analytics.identify(values)` — 把持久 identity 欄位 merge 進每筆
  後續 event
- `analytics.reset()` — 清掉持久 identity(例如 logout 時)
- `await analytics.flush()` — 強制 flush buffer
- `await analytics.dispose()` — 關 timer、最後 flush 一次、關
  storage

## Options

| Option | 預設 | 用途 |
|---|---|---|
| `endpoint` | — | POST URL。會收到 JSON 陣列形式的 event。 |
| `identity` | — | `() => Record<string, unknown>` — 每筆 event call 一次,用來拿動態欄位。 |
| `batchSize` | `20` | Buffer 累積到此數量立刻 flush。 |
| `flushIntervalMs` | `5000` | Timer 驅動的 flush 間隔。 |
| `offlineBuffer` | — | `'indexeddb'` 同步 mirror;下次 `init()` 時補送。 |
| `transport` | — | 用自己的 `(events) => Promise<void>` 取代 fetch。優先於 `endpoint`。 |

## `identity` callback

Identity 欄位在 fire 當下會 merge 進每一筆 event。有兩種機制:

| 來源 | 何時用 |
|---|---|
| `identity()` option | 每筆 event 都 call。適合 session 中可能變動的(locale、device)。 |
| `analytics.identify({ ... })` | Sticky。登入後拿到穩定 user id 時用。 |
| `track(event, payload, { identity })` | 單筆 override。 |

Merge 順序(後者覆蓋前者):`staticIdentity` → `identity()` → 單筆
override。Toolbox 故意不做 fingerprint,id 完全由 host 自己產生與
保存:

```ts
function uuid(): string {
  if (crypto?.randomUUID) return crypto.randomUUID();
  /* fallback ... */
}
const visitor_id = localStorage.getItem('app:visitor_id')
  ?? (localStorage.setItem('app:visitor_id', uuid()), localStorage.getItem('app:visitor_id')!);
const session_id = sessionStorage.getItem('app:session_id')
  ?? (sessionStorage.setItem('app:session_id', uuid()), sessionStorage.getItem('app:session_id')!);
```

## Event 結構

```ts
type AnalyticsEvent = {
  ts: number;                              // ms epoch,track() 時設
  event: string;                           // 點分名稱,例如 'page.view'
  payload?: Record<string, unknown>;       // 呼叫處的 payload
} & Record<string, unknown>;               // identity 欄位 merge 進來
```

`track` 簽名:

```ts
analytics.track('voice.result', { status: 'error', via: 'network' });
```

慣例:`payload` 只放小型 primitive — 字串(id、status code)、數字
(時長、count)、布林。任何自由格式的內容,host 應該在 `track` 之前
先 sanitize(見下)。

## 接 dddk intent

dddk 會發 typed `IntentEvent`(`palette_activated`、`agent_asked`、
`agent_answered`、`voice_captured`、`selection_used`、`skill_*`、
`agent_feedback`、`agent_mode_changed`、`agent_tool_failed`、…)。
每一筆 track 前都該 sanitize — 內容欄位(問題、回答、語音
transcript、選取文字)**不該**離開瀏覽器:

```ts
import { intentToTrack } from '$lib/analytics-sanitize';

dddk.on('intent', (i) => {
  const safe = intentToTrack(i);
  if (safe) analytics.track(safe.event, safe.payload as Record<string, unknown>);
});
```

`intentToTrack` 對每個 kind 走白名單:保留 `itemId`、`via`、
`status`、`response`、長度、count;丟掉 `question`、`answer`、
`text`、`selectionText`。重點在 pattern 而不是具體欄位 — 你的領域
敏感欄位可能完全不一樣。

## `agent_feedback` — 有標籤的訓練訊號

當 host 設了 `webAgent.onLoopEnd: { kind: 'feedback', text: ... }`，每次
agent run 結束時 closure 會問訪客「這次滿意嗎」。Space = 滿意、雙擊 Space =
不滿意 — 這個手勢會發出 `agent_feedback` IntentEvent：

```ts
{ kind: 'agent_feedback'
  runId?: string          // 對應這次 agent_run_started 的 runId
  skillId?: string        // 由 skill 觸發的 run 才會有
  satisfied: boolean | null  // 手勢結果：true / false；ask_user picker 走 null
  summary: string         // closure 文案或選到的選項值
  timestamp: number
}
```

為什麼這比 click-through 資料有價值：

- **有標籤** — 每一筆都明確 yes / no，不用從捲動深度、停留時間「猜」使用者
  意圖。
- **可 join** — `runId` / `skillId` 讓你能按 run 或 skill 切片。某次 prompt
  改完導致滿意度下滑，會直接在那個 skill 的 yes-rate 看到，而不是所有訊號
  都被雜訊蓋掉。
- **RL-ready** — `(run 開始時的狀態, satisfied)` 這個 pair 就是 reward model
  要的資料形狀。匯出後直接丟離線訓練流程，不需要再手動標註。

內建 dashboard 把 `agent_feedback` 渲染為主要的滿意度區塊（`/dashboard` 頁
頂部）：主指標滿意率、每日 yes/no/dismiss 堆疊條、依 skill 拆分的 yes-rate
表（樣本 < 30 時自動帶 `low_confidence` 旗標）。同一份資料也在 CSV / JSON
匯出裡，外部 pipeline 可以直接吃。

典型 event 對應表:

| dddk intent | Tracked event | 保留的 payload |
|---|---|---|
| `palette_activated` | `intent.palette_activated` | `item_id`、`size_chars`、`attachments_count` |
| `agent_asked` | `intent.agent_asked` | (無 — question 內容丟掉) |
| `agent_answered` | `intent.agent_answered` | `via`、`size_chars`、`latency_ms`（從 ask 到 answer 的 ms） |
| `agent_llm_call` | `intent.agent_llm_call` | `item_id`（= runId）、`variant_id`（= role）、`via`（= model）、`ttft_ms`、`duration_ms`、`output_tokens` |
| `voice_captured` | `intent.voice_captured` | `size_chars` |
| `confirm_action` | `intent.confirm_action` | `item_id`（= action 名）、`status`（`approved` / `rejected`） |
| `skill_started` / `skill_finished` | `intent.skill_*` | `item_id` |
| `agent_run_started` | `intent.agent_run_started` | `item_id`（= runId）、`size_chars`（= task 長度） |
| `agent_run_completed` | `intent.agent_run_completed` | `item_id`（= runId）、`size_chars`（= turn 數） |
| `agent_run_stopped` | `intent.agent_run_stopped` | `item_id`（= runId）、`status`（`close` / `esc` / `reject` / `palette` / `voice`） |
| `agent_pause_decision` | `intent.agent_pause_decision` | `item_id`（= runId）、`status`（`continue` / `stop`） |
| `agent_feedback` | `intent.agent_feedback` | `response`（`yes` / `no` / `dismiss`）、`size_chars` |

### 用 `runId` 重建單次 run

Agent-run 系列 intent（`started` / `completed` / `stopped` / `pause_decision`）都帶同一個 `runId` 在 `item_id`。Dashboard group by 它就能還原一次完整查詢 — 所有在 `agent_run_started` 跟 `agent_run_(completed|stopped)` 之間的 `agent_answered` / `confirm_action` / `agent_pause_decision` 都屬於這個 run。

## 匯出單次 run 為 JSON

Orchestrator 在 agent run 進行中會 buffer 每個 intent，連同 session log。Run 結束後呼叫 `dddk.exportAgentRun()` 拿一個 JSON 物件：

```ts
dddk.on('agent_final', () => {
  const run = dddk.exportAgentRun();
  if (!run) return;
  // run.runId, run.sessionId, run.session.turns, run.intents, run.exportedAt
  void fetch('/api/my-runs', { method: 'POST', body: JSON.stringify(run) });
});
```

把完整查詢記錄（memory + per-turn tool call + 使用者決定）一次包好送到 host DB / dashboard，不用 join 兩條 stream。`session` 是 deep clone，後面的 turn 不會改到 export。

[Proactive](../proactive/overview.md) 透過 `analytics` option 自動接好,免費
發 `proactive.shown` / `proactive.response`。

## 生命週期 hooks

Page unload 前 flush 一下 — 在 hard refresh 時,timer 可能來不及
fire:

```ts
window.addEventListener('beforeunload', () => { void analytics.flush(); });
```

Flush 失敗時(網路錯、5xx、離線),batch 會塞回 buffer 前端等下一次
retry。設 `offlineBuffer: 'indexeddb'`,event 同時會持久化到
IndexedDB,下次 `init()` 時補送 — 即使 tab 關掉也留得住。

## 隱私

Toolbox 自己不存任何 PII,也不會自動 enrich identity。送出去的內容
完全等於 host 寫進去的:

- `identity()` 是**你的程式碼** — 不要回 email / 電話 / IP。
- `payload` 是**你的程式碼** — `track` 前先 sanitize。用上面
  intent-to-track 的白名單 pattern。
- Endpoint 是**你的 server** — 在那邊也做 schema 驗證
  (dddk-frontend 的 reference 在 D1 ingest 端也白名單欄位,當作第
  二道防線)。

法遵問「這收集了什麼」時,答案就是「host 在 `identity()` 跟
`payload` 寫的東西 — 去讀那兩個 function」。讓那兩段保持簡短。

## 自訂 transport

非 HTTP transport(Beacon、Worker postMessage、native bridge):

```ts
const analytics = createAnalytics({
  identity: () => ({ session_id, visitor_id }),
  transport: async (events) => {
    navigator.sendBeacon('/api/dddk/events', new Blob(
      [JSON.stringify(events)],
      { type: 'application/json' },
    ));
  },
});
```

`transport` 優先於 `endpoint` — 二擇一設定即可。

## 透過 webagent

Analytics **沒有**暴露成 LLM tool。Telemetry 是 host 程式碼的 side
effect(頁面導覽、dddk intent、proactive 回應)— 不是 agent 該決定
的事。把 analytics 實例傳給其他 toolbox 模組
(`createProactive({ analytics })`),它們就會自動 track 自己的生命
週期。
