# v0.2.1 釋出說明

疊在 v0.2.0 上的 patch release。**沒有破壞性改動**。兩個主軸：

1. **InlineAgent 的 inline-diff UX** — 每個內建 action 現在都會用「刪除線舊文 / 新文」的預覽框秀結果，使用者按 accept / reject / 插入下方 / 複製，並可開後續對話再改一輪 — 不再直接 splice 進選取區。
2. **Cursor lifecycle 強化** — 合成游標透過 RAF 錨在目標上、每個 terminal event 都會正確隱藏、run 之間狀態重置。

外加 planner 對 `finish` 語意的修正，跟 command palette 鍵盤導航的 bug fix。

## 一句話總結

- **InlineAgent 預設 `displayAs: 'inline-diff'`** — 每個內建 action（improve / fix / shorter / longer / tone / translate）都會先給 diff 預覽，使用者接受或拒絕，不再立即取代選取。Host 可以 per-action 用 `displayAs: 'replace'` 還原，或全域用 `InlineAgentConfig.defaultDisplayAs`。
- **新 UI primitive** 在 `@perhapxin/dddk/ui` — `mountProcessingLine`、`mountInlineDiff`、`InlineChatSession`。不用 InlineAgent 的 host（例如 Tiptap editor）可以直接拿去用。
- **Diff panel 支援 streaming** — diff handle 上的 `applyStreamChunk(text)` + `streamStart()` + `streamDone()`。文字一個 token 一個 token 流進來、帶閃爍游標；stream 期間 accept / reject 按鈕 disable。
- **後續對話 session** — `InlineChatSession` 把之前的 prompt 保留在 diff 上方（超過 3 輪自動折疊成「▼ 顯示 N 筆之前」）。每次改寫都 ground 在**原始文字**，不會被上一輪輸出帶歪。
- **`mountInlineDiff` 的 `onCancel`** — 使用者按 Reject / Escape / `dispose()` 時立刻 fire，host 可以在 result promise 還沒 settle 前 abort 串流。
- **Cursor 錨在目標上** — `position: fixed` 游標以前一次定一個座標；現在 RAF loop 每 frame 重算目標 rect、cursor 跟著元素走。捲頁 / layout shift 不會脫鉤。
- **每個 terminal event 都 hide cursor** — `final` / `error` / 手動 `stop` / `safeCleanup` / 新 run 開始都會清乾淨。
- **Planner `finish` 語意明確化** — `finish` 是「結束」不是「最後問一下」。Informational task（介紹 / 解說 / what / where / how）的 plan 是 navigate → narrate → finish，不插 `ask`。
- **Palette 鍵盤捲動保留 row 標題** — 有展開 inline detail 的高 row 用方向鍵移動時，標題不會被切掉在 viewport 外。

## 各別變更

### InlineAgent inline-diff 模式（這版重點）

之前每個 action 的結果直接 splice 回選取區 — 快，但沒預覽。v0.2.1 翻過來：每個內建 action 都會在選取區下方 anchor 一個 diff panel，原文加刪除線、新文寫在下面。按鈕：Accept / Reject / 插入下方 / Copy / 開後續對話。使用者按 Accept 才會真的改選取區。

每個內建 action 都預設打開。Host 想還原舊行為：

```ts
// 單一 action 蓋掉
{ id: 'improve', label: 'Improve', displayAs: 'replace', ... }

// 全域 fallback（沒指定 displayAs 的 action 都吃這個）
new InlineAgent({ ..., defaultDisplayAs: 'replace' });
```

### 新 UI primitive（不用 InlineAgent 也能用）

```ts
import {
  mountProcessingLine,
  mountInlineDiff,
  InlineChatSession,
} from '@perhapxin/dddk/ui';
```

- **`mountProcessingLine(opts)`** — LLM 思考時 anchor「處理中…」line 在編輯 rect 下方。Replaceable / disposable handle。
- **`mountInlineDiff(originalText, newText, opts)`** — 完整 diff 預覽 panel，含 action 按鈕跟後續對話 composer。回傳 handle 有 `applyStreamChunk` / `streamStart` / `streamDone` / `pushHistoryTurn` / `dispose`。
- **`InlineChatSession`** — 保留之前的 turn 跟原始文字。每次後續 `send()` 呼叫 host transport 時帶上 `{ original, history, prompt }`，LLM 一直 ground 在原文。

Host 想自己驅動 editor surface（Tiptap、純 `<textarea>`、自製 contenteditable）就直接用這幾個 primitive，不用走 InlineAgent。

### Streaming + 對話 history chip strip

Diff panel 支援逐 chunk 串文 + 閃爍游標：

```ts
const panel = mountInlineDiff(original, '', { ... });
panel.streamStart();
for await (const chunk of llmStream) panel.applyStreamChunk(chunk);
panel.streamDone();
```

`streamStart()` 到 `streamDone()` 之間 accept / reject 按鈕 disable，避免使用者在串到一半時誤接受。

後續 prompt 用 `pushHistoryTurn(prompt)` 顯示成 diff 上方的 chip。超過 3 輪 chip strip 自動折疊成「▼ 顯示 N 筆之前」toggle，多輪改寫不會把 panel 撐爆。

### onCancel hook

```ts
mountInlineDiff(original, '', {
  onCancel: () => abortStreamingController.abort(),
  // ...
});
```

使用者按 Reject、Escape、或 caller 呼叫 `panel.dispose()` 時立刻 fire。Host 可以在 result promise settle 之前 abort LLM 串流。沒這個的話，按 Reject 還是會有幾秒沒用的 token 一直流。

### Cursor 錨在目標上（RAF tracking）

合成游標（`cursorTrail: true`）以前是 `position: fixed` 加每次 move 一次 rect snapshot。Move 之後頁面捲動 / layout shift，cursor 在那個視窗座標待著但底下元素已經跑了 — 看起來「指錯位置」。

現在：初始 glide 動畫落地後，`setCursorAnchor(targetEl)` 啟動 `requestAnimationFrame` loop，每 frame 重讀 `targetEl.getBoundingClientRect()` 更新 cursor transform。Cursor 即時跟著元素過 scroll / resize / layout shift。`hideCursor` / `destroyCursor` / 下一個 move call / 元素離開 DOM 都會釋放 anchor。

也順手拔了 v0.2.0 的「大元素左上內縮」heuristic — 那是在打補丁打錯層（model 有時把整個 `<section>` 當成 narrate 的 `about` target，這是 model 選錯，不是 cursor 該幫忙）。回到單純的 rect 中心。

### Cursor 在 terminal event 都會 hide

`hideCursor` v0.2.0 就有 export 但**沒人呼叫**。合成游標 run 結束後永遠停在最後位置。現在接到：

- `runAgent` start（新 run 開始前清舊的）
- `final` event handler（loop 正常結束）
- `error` event handler（出錯路徑）
- `safeCleanup`（stream 任意異常退出）
- `agentStop`（手動 stop / voice / palette / esc / 雙擊）

另外 `hideCursor` 同時把 `lastX / lastY` 重置回 "first use" sentinel — 下一輪的進場 glide 從 off-screen-left 滑進來，不會從上一輪結束的位置鬼鬼祟祟 fly 過去。

### Planner：finish 是結束、ask 只給真的擋路的決策用

Planner 之前會產出 description 寫成問題的 `finish` todo（「確認你是否要...」），loop 跑到那 todo 時就把它當成「narrate 結尾加個問題」 — 即使使用者只是請你介紹。

Planner prompt 收緊 intent 語意：

- **`ask`**：暫停 loop 等 user input。**只有**下一步 agent action 真的卡在使用者選擇時才用。不是用來客氣關懷。
- **`finish`**：宣告 run 結束。Description 是「剛才做了什麼」，**不是問題**。
- **資訊類 task shortcut**：使用者問題是 introduce / explain / tell / show / what / where / how 這類，plan 是 `navigate → narrate → finish`，不插 `ask` 去問使用者沒提過的需求。

WebAgent loop 的 appendSystemPrompt 也同樣原則 echo：cover the ask once、`is_final: true` 同一個 turn、narrate 結尾不要問問題。

### Palette：高 row 鍵盤導航不切掉標題

有展開 inline detail 的 row（orders / cart 等）可能高過 list viewport。原本 `scrollIntoView({block: 'nearest'})` 會對齊 row 底部，方向鍵移動時 row 的**標題**被切掉在 viewport 頂部之外。

改成手算 `scrollTop`，優先保留 row TOP 可見。Async detail layout 用 RAF 等一個 frame 再讀 rect。

## 升級

不用改 code，直接換版本就好。

如果想 opt out inline-diff 預覽、回到 v0.2.0 的直接 splice：

```ts
new InlineAgent({ ..., defaultDisplayAs: 'replace' });
```

或單一 action：

```ts
{ id: 'translate', label: 'Translate', displayAs: 'replace', ... }
```
