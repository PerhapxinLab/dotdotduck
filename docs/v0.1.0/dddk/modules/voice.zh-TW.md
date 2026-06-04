# dotdotduck — 語音 I/O

> Speech-to-text（聽使用者） + Text-to-speech（念給使用者聽）。兩個 opt-in class — `Voice`（STT）跟 `TTS`，搭配 `VoiceModule` 包成一份方便使用。Host 自己把它們接到 space 手勢跟字幕條；SDK 不會自動掛載任何一個。

## 整合架構

1. 長按 space → host call `voiceModule.captureOnce(dddk.subtitle)`（或直接 `voice.start()`）。
2. Web Speech API（或 host 提供的 `transcribe` callback）拿出 raw text。
3. 選用的 LLM cleanup（去填詞 / 修標點），走 `voiceCleanup` LLM role。
4. Host 決定文字怎麼用：
   - **焦點在可編輯欄位** → 插到 caret 位置。
   - **Dwell 已 pin 元素** → `dddk.startAgent(text, { selection: { ... } })`。
   - **頁面有活的選取** → `dddk.startAgent(text, { selection: { text } })`。
   - **其他** → `dddk.startAgent(text)` 當完整任務。

`DotDotDuckConfig.voice` 現在只剩 `{ enabled?: boolean }` — 字幕條 voice indicator 的全域開關。實際的 STT / TTS 設定都在你自己 new 的 `VoiceModule` / `Voice` / `TTS` class 上面。

## STT 設定（`VoiceConfig`）

可以直接傳 `new Voice(config)`，也可以走 `new VoiceModule({ stt: config, ... })`。

```ts
import { Voice, VoiceModule } from '@perhapxin/dddk';

const voice = new VoiceModule({
  llm: router,                  // LLMProvider / LLMRouter — 走 `voiceCleanup` role
  stt: {
    language: 'zh-TW',          // 預設：navigator.language
    continuous: true,           // 預設：true（鬆開 space 結束 capture）
    interimResults: true,       // 預設：true（中間結果串流出來）
    cleanupWithLLM: true,       // 有設 `llm` 時預設：true
    cleanupPrompt: '…',         // 覆蓋內建的語言無關 cleanup prompt
    transcribe: async (audio, opts) => '…',   // host 提供的 STT — 見下方「自訂 STT」
    transcribeMode: 'fallback', // 'fallback'（Web Speech 不行再 MediaRecorder） | 'always'
    autoRestartOnEnd: true,     // 預設：true — Android/iOS 自動斷線時重啟 recognition
  },
  // VoiceModule 額外的：
  listeningLabel: '聽取中 — 鬆開送出',
  unsupportedLabel: '此瀏覽器不支援語音輸入',
  captureTimeoutMs: 30000,      // 單次 capture 的上限
  autoSpeakSubtitles: false,    // 設 true 後每次 subtitle.show() 都會 TTS 念出來
  skipEmptyTranscript: true,    // 預設 true — captureOnce 對空語音 / timeout / 不支援都回 null
});
```

### `skipEmptyTranscript`（預設 `true`）

使用者長按 Space 但沒講話就放開、STT 超時、瀏覽器不支援語音 — 這幾種情況 `captureOnce` 都回 `null` 而不是 `''`。host 一條 guard 就能擋掉所有「沒抓到東西」的情境：

```ts
const text = await voice.captureOnce(dddk.subtitle);
if (!text) return;          // null 跟空字串都擋住
dddk.startAgent(text);      // text 已經被 trim 過
```

關掉（`skipEmptyTranscript: false`）— `captureOnce` 會回原始轉錄結果（包括空字串）。host 要自己做 `.trim()` + 早 return。除非你真的想讓每次靜默放手都跑下游邏輯，否則沒必要關。

## TTS 設定（`TTSConfig`）

```ts
import { TTS } from '@perhapxin/dddk';

new TTS({
  voice: 'Google 國語',  // 瀏覽器 voice 名稱（必須對應裝置上某個 SpeechSynthesisVoice）
  rate: 1.0,             // 0.1 – 10
  pitch: 1.0,            // 0 – 2
  volume: 1.0,           // 0 – 1
  lang: 'zh-TW',         // BCP-47，會影響 voice 挑選
});
```

`VoiceModule` 內部會自己建一個 TTS；要覆蓋就傳 `tts: TTSConfig`。想讓字幕條自動唸的 host 改去接 `dddk.subtitle.setTTSProvider(fn)` — 詳見 Subtitle 文件。

## 語音觸發場景

### 場景 1 — 長按 space，沒選取
```
keydown space（長按）→ mic 開
voice 結束 → 當完整任務：dddk.startAgent(text)
```

### 場景 2 — 長按 space + 焦點在可編輯欄位
```
voice_start: snapshot document.activeElement（仍是可編輯）
voice 結束 → 把 transcript splice 到該欄位的 caret 位置
```

### 場景 3 — 長按 space + Dwell 已 pin 元素
```
voice 結束 → captureElementContext(pinnedEl) → screenshot + innerText
dddk.startAgent(text, { selection: { text, elements, images } })
```

## 語音 → 行動的決策樹（建議的 host wiring）

拿到 transcript 時，依優先順序檢查：

1. **焦點在可編輯欄位（voice_start 時 snapshot 的）** → 把 transcript 插到 caret 位置。對齊原生口述輸入的行為。
2. **Dwell 已 pin 元素** → `dddk.startAgent(text, { selection: { text, elements, images } })`，把被 pin 元素的文字 + 自動截圖一起帶下去。
3. **頁面有活的選取** → `dddk.startAgent(text, { selection: { text } })`，讓 agent 回答的是「那段」而不是整頁。
4. 都沒有 → `dddk.startAgent(text)` 當完整任務。

## 預熱 mic（`Voice.warmUp` / `VoiceModule.warmUp`）

第一次 call `voice.start()` 會串： 權限對話框（如果還沒授權） → `getUserMedia`（冷啟約 300–800ms） → Web Speech 對 Google STT 做 TLS handshake（約 200–500ms）。實際情況是使用者常常 space 都鬆開了麥才開始錄。在任何不相關的使用者手勢（pointerdown / keydown）裡 call `warmUp()`，可以把這段冷啟挪離語音手勢的關鍵路徑：

```ts
const tryWarmUp = () => voice.warmUp().catch(() => { /* 拒絕 — 安靜跳過 */ });

if (navigator.permissions?.query) {
  navigator.permissions.query({ name: 'microphone' as PermissionName }).then((s) => {
    if (s.state === 'granted') tryWarmUp();    // 回訪使用者 — 立刻熱身
  });
}
window.addEventListener('pointerdown', tryWarmUp, { capture: true, once: true });
window.addEventListener('keydown',     tryWarmUp, { capture: true, once: true });
```

`warmUp()` 是 idempotent — 已經 `granted` 後再 call 是 no-op。閒置很久要重熱可以傳 `{ force: true }`。回傳 `'granted' | 'prompt' | 'denied' | 'unavailable'`。

## 字幕條整合

語音講話時，字幕條會顯示「聽取中 — 鬆開結束」這類 indicator：

```ts
voice.on('start', () => subtitle.showIndicator('listening', '聽取中 — 鬆開結束'));
voice.on('interim', (partial) => subtitle.showIndicator('listening', partial));
voice.on('end', () => subtitle.showIndicator('processing', '處理中...'));
voice.on('cleanup_done', (text) => subtitle.hideIndicator());
```

## 用 TTS 自動念 agent 字幕

兩種接法，挑一個：

```ts
// (a) VoiceModule.autoSpeakSubtitles：true 時 speakSubtitle(text) 會念。
const voice = new VoiceModule({ tts: {...}, autoSpeakSubtitles: true });
agent.on('subtitle', (text) => {
  dddk.subtitle.show({ text, type: 'agent' });
  void voice.speakSubtitle(text);
});

// (b) subtitle.setTTSProvider — 每次 subtitle.show() 都自動觸發。
import { createWebSpeechTTSProvider } from '$lib/tts-provider';
dddk.subtitle.setTTSProvider(createWebSpeechTTSProvider());
```

念到一半使用者按 Escape → TTS 由 host 自己的 handler 停（內建 provider 有 `tts.stop()`）。

## 語音 cleanup 提示詞

單一份語言無關的 prompt — LLM 自己從 transcript 偵測語言、用同樣的語言回：

```
You are a speech-to-text post-processor. The input is a raw transcript.

- Detect the language(s) and reply in the same language(s). Preserve code-switching.
- Add correct punctuation and capitalisation.
- Remove fillers ("um", "uh", "you know", "like", "I mean", and equivalents in other languages).
- Fix obvious homophone / mishear errors when context makes them obvious.
- Do NOT rewrite or interpret — preserve the user's meaning verbatim.
- Reply with the cleaned text only. No prefix, no explanation.
```

要保留 domain 詞（產品名稱、code identifier）就傳 `VoiceConfig.cleanupPrompt` 覆蓋。

## 自訂 STT（`transcribe` callback）

Web Speech 不是每個瀏覽器都跑得動（Firefox、部分嵌入式 webview），品質也未必最好。傳 `transcribe(audioBlob, opts)` 進去就能接任何 STT vendor — SDK 用 MediaRecorder 錄音、把結果丟給你的 callback：

```ts
new VoiceModule({
  stt: {
    transcribe: async (audio, { language, mimeType }) => {
      // 把音訊送到自己的 endpoint，回 transcript。
      const fd = new FormData();
      fd.append('audio', audio, `clip.${mimeType.split('/')[1]}`);
      fd.append('lang', language);
      const res = await fetch('/api/stt', { method: 'POST', body: fd });
      const { text } = await res.json();
      return text;
    },
    transcribeMode: 'fallback', // 或 'always' — 完全不走 Web Speech
  },
});
```

常見接法：OpenAI Whisper、Gemini 音訊輸入、Azure Speech、Deepgram、AssemblyAI、自架 whisper.cpp。

## 不支援的（v0.1 明確邊界）

- 連續對話模式（打斷 agent 那種）
- 多人辨識
- 即時語音翻譯 — 整頁翻譯改用 ImmersiveTranslate
- 自訂喚醒詞（space 就是正式手勢）

## 隱私

- 預設 STT 走 Web Speech — 音訊由瀏覽器的 STT vendor 處理（Chrome/Edge 送到 Google STT；新版 macOS / iOS 的 Safari 在本機處理）。
- 使用者主動長按 space 才會開麥 — 不會持續監聽。
- mic 權限由瀏覽器管，dotdotduck 不繞過。
- 透過 `transcribe` 走雲端 STT 是 opt-in，且只走 host 自己的 endpoint — dotdotduck 不附 vendor SDK。

## 怎麼確認可用

掛上 `new DotDotDuck({ voice: { ... } })` 後：

1. 在不是輸入欄位的地方長按 space → 字幕條應該在 ~150ms 內顯示「聽取中 — 鬆開結束」。
2. 講一句、鬆開 space → indicator 變「處理中...」。
3. 有開 `cleanupWithLLM` 的話，cleaned text 會以 agent task 或 subtitle suggestion 形式出現。
4. 都沒反應就開 DevTools 看有沒有 `voice.error` event — Web Speech 必須跑在 HTTPS，`language` 也要正確（例如 `zh-TW`，不是 `zh-Hant-TW`）。
