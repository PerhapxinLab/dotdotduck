# 自己接 Agent backend

> dddk 的 UI surface — palette、字幕條、FAB、手勢、intent stream、語音 — 本身就有價值，就算你的 agent 已經在 server 自己跑、不想用 dddk 內建的 webagent / inline agent 也一樣。

## 為什麼這件事重要

2026 年大部分要採用 dddk 的團隊已經有自己的 agent 了。有些公司投了好幾年在 in-house RAG pipeline、內部 tool router、自製 LangGraph orchestrator、自家 planner — 他們要的是 dddk 帶來的**UI / 互動層**，但不想丟掉 backend。

dddk 是為這個設計的。Webagent 跟 inline agent 是 agent 角色的**預設實作**，不是必要依賴。整套關掉，把每個 user 手勢（palette Enter / voice / Dwell 選取 / FAB tap）都路由到自己的 agent。字幕條、overlay、intent stream、palette、mobile chrome 全照常運作。

## 最少改動的 opt-out

```ts
new DotDotDuck({
  // 沒 `llm` 欄位、沒 `webAgent` config。
  agent: { enabled: false },        // 內建 webagent loop 關閉
  // 連 `new InlineAgent({ ... })` 都不要呼叫 — Inline agent 本來就跟
  // orchestrator 分開，host 自己 new 出來的；直接不做這步就好。
});
```

關掉之後的差異：

- `dddk.startAgent(task)` 變成 no-op，會跳一行「Agent is disabled」字幕（你會繞過它走自家 agent — 見下）。
- 不再每輪做 DOM scraping、沒 tool registry、dddk 發起的 LLM call 不再帶 agent prompt。
- 字幕條 / overlay / palette / 手勢 / mobile FAB / intent stream 全部照常。

## 三個整合接點

關掉內建 agent 之後，host 要做的就是把這三件事串起來：

### 1. 接 user 輸入

| Event | Payload | 什麼時候觸發 |
|---|---|---|
| `palette_open` | `{ selection?: SelectionContext }` | User 開 palette（Ctrl+K、idle 時 FAB tap、滑動手勢）。Selection 文字跟圖片附件都會一起傳過來。 |
| `voice_end` | `{ text: string }` | 語音逐字稿好了（Web Speech / 自訂 `transcribe()` callback 完成）。 |
| `gesture_reject` / `gesture_escape` | — | User 取消了。 |

加上 palette 的純文字「Ask AI」fallback handler — 推薦給打字輸入用的 hook。註冊方式跟 dddk-frontend 同，但路由到**你的** agent：

```ts
dddk.palette.addItem({
  id: 'ask-ai-fallback',
  name: 'Ask AI',
  fallback: true,                       // 只在其他都不 match 時出現
  section: 'AI',
  handler: (p, arg) => {
    p.close();
    const text = arg ?? p.input.trim();
    if (text) runMyAgent(text);          // ← 你的 agent 入口
  },
});
```

### 2. 渲染輸出

字幕條的用法跟內建 agent 一樣：

```ts
function runMyAgent(task: string): Promise<void> {
  const stream = myBackend.run(task);    // 你的 AsyncIterable / EventSource / 任何

  for await (const chunk of stream) {
    if (chunk.kind === 'text') {
      dddk.subtitle.appendStreamed(chunk.delta);
    } else if (chunk.kind === 'tool') {
      dddk.subtitle.appendStreamed(`\n[${chunk.toolName}…]`);
    } else if (chunk.kind === 'final') {
      dddk.subtitle.finalizeStreamed({ autoHide: 8000 });
    }
  }
}
```

想做結構化輸出（表單 / 表格 / 卡片 / 圖表），用 Pieces 系統 — envelope 跟內建 agent 會 emit 的格式一樣：

```ts
dddk.subtitle.show({
  type: 'agent',
  text: 'Here are your invoices:',
});
dddk.surfaces.render(myPiecesEnvelope, { placement: 'inline' });
```

要做 ask-back 互動：

```ts
const answer = await new Promise<string>((resolve) => {
  dddk.subtitle.showChoice({
    question: 'Which account?',
    options: ['Personal', 'Business', 'Family'],
    allowFreeText: true,
    onPick: resolve,
  });
});
```

### 3. 發 intent event 給分析

讓 dashboard（跟任何 listen `dddk.on('intent', …)` 的下游）能繼續追蹤你的 agent 行為：

```ts
dddk.emitIntent({
  kind: 'agent_answered',
  answer: 'yes',                         // 或 'no' / 'cancel' / 自由文字
  via: 'gesture',                        // 或 'voice' / 'click' / 'free_text'
  timestamp: Date.now(),
});

dddk.emitIntent({
  kind: 'confirm_action',
  actionName: 'send_email',
  params: { to: 'a@b.com' },
  approved: true,
  timestamp: Date.now(),
});
```

每個內建 intent kind 都在 `agent/api.md` 裡 — 對齊 shape，分析頁面把你的 agent 當一等公民處理。

## 替換 Inline agent

`InlineAgent` 本來就是 opt-in — orchestrator 不會 auto-construct 它，host 自己呼叫 `new InlineAgent({ llm, locale })`。要用自己的選取彈出工具列就直接別 new 它。Inputs / textarea / contentEditable 上的選字事件接到自家 popover 即可。要把 streaming 輸出寫回 input 框就用 `dddk.subtitle.appendStreamed(...)` 走字幕條，或直接 render 到 input 元素內。

如果你還是想用 dddk 的 inline-popover 殼但裡面接自己的 backend，開 issue 討論 — popover 的 tool dispatch 目前綁死在 LLM call 上，但能拆出來。

## 你免費保留的東西

Opt-out 之後 dddk 還給你：

- **Command palette** — Ctrl+K、prefix routing、子選單、附件、圖片貼上、palette body `showResult()` 接任何自訂 UI。
- **字幕條** — streaming、pause、choice picker、自由文字 picker、autohide、locale-aware copy、touch tap 路由。
- **手勢** — Space accept / 雙擊 Space reject / Esc cancel / 長按 Space 語音 / 長按 Dwell。
- **Mobile chrome + FAB** — 單 tap 走 `triggerAccept()`，所以你的 agent 在手機上 tap 一下就推進，跟桌面 Space 一致。
- **Intent stream + analytics** — 每個手勢、palette 觸發、語音嘗試、顯式 `emitIntent` 都流進同一個 event bus。
- **Sitemap 感知導航** — `dddk.palette.addItem(...)` with path 還是會走 `goto()`。
- **Theming** — 28 個 CSS variable、light / dark。
- **Cross-tab sync、session 持久化、host helper、react adapter…** — 跟 agent 正交。

## 完整 template

最小 host 檔，完全跑自家 backend：

```ts
import { DotDotDuck } from '@perhapxin/dddk';
import { myBackend } from './my-agent';

const dddk = new DotDotDuck({
  siteName: 'YourSaaS',
  agent: { enabled: false },           // 關掉內建 webagent
  // 沒 `llm` 欄位 — 內建 agent 關了就不需要 LLM。
});

dddk.mount();

// 接 user 輸入。
dddk.palette.addItem({
  id: 'ask-ai-fallback',
  name: 'Ask AI',
  fallback: true,
  handler: (p, arg) => {
    p.close();
    const text = arg ?? p.input.trim();
    if (text) void runMyAgent(text);
  },
});

dddk.on('voice_end', ({ text }) => {
  if (text) void runMyAgent(text);
});

async function runMyAgent(task: string): Promise<void> {
  dddk.subtitle.showIndicator('processing');
  try {
    const stream = myBackend.run(task);
    for await (const chunk of stream) {
      if (chunk.kind === 'text') {
        dddk.subtitle.appendStreamed(chunk.delta);
      } else if (chunk.kind === 'tool_called') {
        dddk.emitIntent({
          kind: 'confirm_action',
          actionName: chunk.toolName,
          params: chunk.params,
          approved: true,
          timestamp: Date.now(),
        });
      }
    }
    dddk.subtitle.finalizeStreamed({ autoHide: 8000 });
    dddk.emitIntent({ kind: 'agent_answered', answer: 'complete', via: 'free_text', timestamp: Date.now() });
  } catch (err) {
    dddk.subtitle.hideIndicator();
    dddk.subtitle.show({ text: `Error: ${(err as Error).message}`, type: 'info', autoHide: 6000 });
  }
}
```

整個 integration 就這樣。dddk 處理 UI，你 backend 處理 agent。

也看：[agent/api.md](../agent/api.md) 完整 event + intent shape、[triggers/palette.md](../triggers/palette.md) palette API、[modules/voice.md](../modules/voice.md) 想用 Whisper / Deepgram / 自家 ASR 替換 Web Speech 用的 `transcribe(audio)` callback。
