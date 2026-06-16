# webagent — Modules

> 可選 module，host 用到才 import。每個 module 獨立、可單獨使用，也可被 agent 當 action 呼叫。

## Immersive Translate（沉浸式翻譯）

### 是什麼
在頁面上做即時翻譯 — 不取代原文，在每段下方插入翻譯（沉浸式翻譯 / chrome extension 同款）。

### API
```ts
import { immersiveTranslate, removeImmersiveTranslation } from '@perhapxin/dddk';

await immersiveTranslate({
  targetLang: 'zh-TW',
  llm: provider,
  glossary?: { 'API': 'API（應用程式介面）', ... },
  cache?: boolean,            // 預設 true，存 sessionStorage
  layout?: 'below' | 'side',  // 預設 below
  scope?: HTMLElement | string,  // 預設 document.body
});

removeImmersiveTranslation();
```

### 功能（v1 要做完）
- DOM walk + 取段落文字
- 批次翻譯（15 段一批，省 token）
- 插入 sibling 元素（保留原文）
- **詞彙表 glossary**（企業常用名詞固定譯法）
- **雙語並排模式**（除了下方插入，也支援左右並排）
- **翻譯 cache**（同段重複進來不重翻）
- **HTML 格式保留**（加粗、連結、inline code）
- 自動偵測來源語言
- 進度回報（大頁面可看進度）

### 當 webagent action 用
LLM 可以呼叫 `immersive_translate` action（透過 customAction 註冊）。

### 不在 v1 範圍
- PDF / EPUB 翻譯（獨立套件，未來 `@perhapxin/translate-pdf`）
- 影片字幕（同上）
- 圖片 OCR 翻譯（同上）

---

## TTS（Text-to-Speech）

### API
```ts
import { TTS } from '@perhapxin/dddk';

const tts = new TTS({
  provider?: 'web-speech' | 'openai-tts' | 'gemini-tts',  // 預設 web-speech
  voice?: string,
  rate?: number,
  pitch?: number,
});

await tts.speak('Hello world');
tts.stop();
tts.on('end', () => { ... });
```

### 為什麼預設 Web Speech
- 零成本（瀏覽器原生）
- 零延遲（不打網路）
- 缺點：聲音品質不如雲端，多國語言支援不均

### 雲端 provider
- `openai-tts` — `tts-1-hd`，需要 `OPENAI_API_KEY`
- `gemini-tts` — Gemini TTS API，需要 `GEMINI_API_KEY`

### 跟 agent 的整合
Agent 講 `show_subtitle` 的時候，如果 host 註冊了 TTS：

```ts
agent.on('subtitle', (text) => {
  myUI.showBar(text);
  tts.speak(text);  // 同時念出來
});
```

---

## Selection Agent

### 是什麼
使用者選取一段文字 → 對選取內容做事（翻譯 / 摘要 / 改寫 / 解釋 / 搜尋）。dddk 的 `space` 長按會用到。

### API
```ts
import { InlineAgent } from '@perhapxin/dddk';

const sa = new InlineAgent({ llm: provider });

const result = await sa.process(
  selectedText,
  instruction,    // 使用者講的話：「翻譯」「摘要」「改寫得更專業」
  images?,        // 選區內如果有圖片
);
```

### 特殊 result 格式
result 可以是純文字，也可以是兩個特殊格式讓 host 觸發更深層的行為：

- `[NAVIGATE:/path]` — 「去 settings 頁」這種指令，回 navigate 指令
- `[AGENT:task]` — 「幫我做 X」這種指令，丟給 host 去開 agent run

```ts
const result = await sa.process(text, instruction);

if (result.startsWith('[AGENT:')) {
  const task = result.match(/\[AGENT:(.+)\]/)[1];
  agent.run(task);
} else if (result.startsWith('[NAVIGATE:')) {
  router.push(result.match(/\[NAVIGATE:(.+)\]/)[1]);
} else {
  showResult(result);
}
```

---

## STT（Speech-to-Text）

### API
```ts
import { Voice } from '@perhapxin/dddk';

const voice = new Voice({
  language?: 'en-US' | 'zh-TW',  // 預設 navigator.language
  cleanupWithLLM?: boolean,      // 預設 true — 用 LLM 修標點 / 去填詞
  llm?: provider,                // cleanup 用
});

voice.start();
// 使用者講話...
const cleaned = await voice.stop();  // 回語音轉文字 + LLM 清理過的版本
```

### 為什麼要 LLM cleanup
Web Speech API 出來的文字常常有：
- 沒標點
- 「呃」「就是」「然後然後」這種填詞
- 中英混講會跳行
- 同音字錯誤

跑一次 LLM cleanup 出來的文字才能直接給使用者看。Cleanup prompt 很短，幾乎不增加成本。

---

## Surface emission

結構化 UI 由 dddk 的 Pieces 系統處理，webagent 自己不渲染。當 dddk 開一個 Piece surface 時，會透過 webagent 的 `piece_surface` event 轉發給 agent 上下文，讓 agent 知道現在畫面上有什麼。Host 端直接訂閱 dddk 的 `surface` event 來渲染；見 [dddk — Surface renderer](../../surfaces/renderer.md)。
