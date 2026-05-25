# dotdotduck — Voice I/O

> Speech-to-text（聽用戶） + Text-to-speech（念給用戶聽）。共用 webagent 的 `Voice` / `TTS` modules，dotdotduck 接到 space gesture + subtitle。

## 整合架構

1. 長按 space → `Voice.start()`
2. Web Speech API 拿 raw text
3. LLM cleanup（去填詞 / 修標點）
4. 看當下 context 分支：
   - **有選取文字** → `SelectionAgent.process(sel, voiceText)`
   - **沒選取** → `agent.run(voiceText)` 或塞進 subtitle suggestion

`voiceCleanup` LLM role 拿到 STT raw → 回乾淨版本。整條 pipeline 都可以關掉（傳 `cleanupWithLLM: false`）。

## STT 設定

```ts
new DotDotDuck({
  voice: {
    language?: 'en-US' | 'zh-TW' | 'auto',  // 預設 auto = navigator.language
    continuous?: boolean,                    // 預設 false（press-and-hold 模式）
    cleanupWithLLM?: boolean,                // 預設 true
    interimResults?: boolean,                // 預設 true（顯示 partial 中間結果）
  },
});
```

## TTS 設定

```ts
new DotDotDuck({
  tts: {
    enabled?: boolean,        // 預設 false（用戶手動開）
    provider?: 'web-speech' | 'openai' | 'gemini',
    voice?: string,           // 'female' / 'male' / specific voice name
    rate?: number,            // 0.5 ~ 2.0，預設 1.0
    autoSpeakSubtitles?: boolean,  // 預設 false（agent 講話自動念）
  },
});
```

## Voice 觸發場景

### 場景 1：space 長按純粹講話（沒選取）
```
keydown space (long press) → voice mic 開
voice 結束 → text 送 webagent.run() 當任務
```

### 場景 2：space 長按 + 已選取文字
```
selectionchange 已存 lastSelection = "..."
keydown space (long press) → voice mic 開
voice 結束 → SelectionAgent.process(selection, voiceText)
result → subtitle.show(result)
```

### 場景 3：Spotter 鎖元素後講話
```
pointer ring 已顯示 + keydown space → pointer.lock() + voice 開
voice 結束 → agent.run("對 <selector>: <voiceText>")
```

## 語音 → 行動的決策樹

Voice text 一拿到，依序檢查：

1. 用戶**有選取文字** → `SelectionAgent.process(selection, voiceText)`
2. **Spotter 已鎖元素** → `agent.run("對 <selector>: <voiceText>")`
3. **焦點在 input / textarea** → 當 text suggestion 塞進 subtitle，等用戶 accept
4. 都沒有 → `agent.run(voiceText)` 當完整任務交給 webagent

## Subtitle 整合

Voice 講話時，subtitle 顯示「聽取中 — 鬆開結束」這類 indicator：

```ts
voice.on('start', () => subtitle.showIndicator('listening', '聽取中 — 鬆開結束'));
voice.on('interim', (partial) => subtitle.showIndicator('listening', partial));
voice.on('end', () => subtitle.showIndicator('processing', '處理中...'));
voice.on('cleanup_done', (text) => subtitle.hideIndicator());
```

## TTS 念出 agent subtitle

opt-in 設定：

```ts
new DotDotDuck({
  tts: { enabled: true, autoSpeakSubtitles: true },
});
```

效果：

```ts
agent.on('subtitle', (text) => {
  subtitle.show(text);
  if (config.tts.autoSpeakSubtitles) tts.speak(text);
});
```

念到一半用戶按 Escape → TTS stop。

## 語音 cleanup 提示詞

```
你是一個語音轉文字後處理器。輸入是用戶剛剛講話的 raw transcript。

要做：
1. 加上正確標點符號
2. 移除「呃」「嗯」「就是」「然後」這種填詞
3. 修正明顯同音字錯誤（看上下文）
4. 保留原意，不改寫
5. 中英混講保留兩種語言

只回 cleaned 後的文字，不解釋。
```

## 不支援的（v1 明確列出）

- ❌ 連續對話模式（continuous voice agent，要打斷 agent）— v2 看狀況
- ❌ 多人辨識
- ❌ 即時翻譯語音 → 用 immersive-translate
- ❌ 自訂喚醒詞（按 space 就好）

## 隱私

- 預設用 Web Speech API（**音訊本地處理或 Google STT，視瀏覽器**）
- 用戶必須主動按 space → 才開麥（沒持續監聽）
- mic permission 由瀏覽器管，dotdotduck 不繞過
- 雲端 STT provider（openai-whisper / gemini）opt-in，host 要明確開
