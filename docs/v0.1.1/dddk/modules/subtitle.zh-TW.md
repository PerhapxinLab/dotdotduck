# dotdotduck — 字幕條 UI

> 字幕條 — dotdotduck 跟使用者溝通的主要介面。使用者按 space 確認、按雙 space 拒絕、按 Tab 接受部分、按 Escape 取消。

## 結構

字幕條是一條固定在畫面底部、置中的橫條，蓋在頁面內容上方。預設長相：

- 主文字（最多兩行，超出 ellipsis）
- 下方一條小字 hint：`space 同意 · 雙擊 space 拒絕 · Tab 接受一行`
- 不擋互動：點下方頁面元素還是有作用（pointer-events 只覆蓋條本身）

## 五種類型

| Type | 觸發者 | 行為 |
|---|---|---|
| `voice` | 語音轉文字結果 | 顯示 + 等使用者 accept / reject |
| `selection` | InlineAgent 結果 | 顯示 + 提供 copy / accept |
| `agent` | webagent 的 `show_subtitle` | 顯示 + 允許 agent 繼續 |
| `post` | 一般文字建議（autocomplete） | accept 直接插入 / reject 消失 |
| `info` | 純訊息 | 預設 sticky；傳 `autoHide: <ms>` 才會自動消 |

## API

```ts
import { Subtitle } from '@perhapxin/dddk';

const subtitle = new Subtitle({ locale: 'zh-TW' });

subtitle.show({
  text: '要把標題改成「年度報告」嗎？',
  type: 'agent',
  onAccept: () => agent.respond('yes'),
  onReject: () => agent.respond('no'),
  onCancel: () => agent.stop(),
  onCopy: () => navigator.clipboard.writeText('...'),  // 選填，會多畫一顆 copy 鈕
  hints: '...',                  // 自訂 hint 文字，預設用 locale 內建的 accept/reject 提示
  autoHide: 0,                   // ms；預設 0 = sticky 等使用者手動關
  maxCharsPerPage: 220,          // 分頁 — 在句子邊界把長文切開
});

subtitle.hide();
subtitle.isVisible();
subtitle.setLocale('en');        // 換掉內建 accept/reject 提示的語系
subtitle.setTTSProvider(fn);     // 自動唸出每一筆字幕（見 Voice 文件）
subtitle.setVisibilityListener(fn);  // host 接 gesture-manager 同步用
subtitle.setRunningLabel('Agent 執行中…');  // Space accept 後等下一輪 LLM 回來時顯示的 label
```

### 長內容分頁

當 `text.length > maxCharsPerPage`（預設 220）時，字幕條會在句子邊界（`. ! ? 。 ！ ？` + 段落換行）切頁。Space 換下一頁，**只有最後一頁**的 `onAccept` 才會打到 host callback。非最後一頁會顯示 `n/N · space → 下一頁` 的 hint。`maxCharsPerPage: 0` 會把整段一次畫出來（必要時可捲）。

### Indicator 跟 subtitle 互斥

字幕條顯示中時，`showIndicator(state, label)` **不**會疊在上面 — 會被排到佇列。等字幕條被收掉（使用者 accept / reject / 取消）後，排隊中的 indicator 才出來。適合做「agent 播完第 N 步 → 開始想第 N+1 步」這種流程。

```ts
subtitle.showIndicator('processing', 'Agent 執行中…');   // 沒字幕時才會畫
subtitle.hideIndicator();                                // 順便清掉 pending request
```

## 多選 picker（`showChoice`）

`show()` 的形狀是給 binary yes/no 用的（一個 accept callback、一個 reject）。當使用者要在 2–4 個離散選項裡**挑一個**時，改 call `showChoice()` — 同一個字幕條 slot 改 render 編號選項列表，下面再帶一個 free-text 輸入列，host 已經 style 好 `show()` 的話兩種模式長相一致。

```ts
subtitle.showChoice({
  question: '要對這個做什麼?',
  options: ['解說', '摘要', '翻譯', 'Other (輸入)'],
  onChoose: (value, index) => {
    if (index === -1) startAgent(value);              // 使用者自己打的
    else if (index === 0) startAgent('Explain this'); // 預設選項
    // ...
  },
});
```

### Options

| 欄位 | 型別 | 預設 | 說明 |
|---|---|---|---|
| `question` | `string` | — | 問題本身。TTS hook 會原文唸出來 — 用自然口語寫。 |
| `options` | `string[]` | — | 2–6 個預設選項。畫成編號列（1、2、3 …）。 |
| `allowFreeText` | `boolean` | `true` | 最後再接一條 free-text 輸入，讓使用者打不在清單內的答案。 |
| `freeTextLabel` | `string` | 內建翻譯 | free-text 輸入的 placeholder。 |
| `onChoose` | `(value, index) => void` | — | 必填。`index` 語意見下方。 |
| `onCancel` | `() => void` | — | Esc / 程式化關閉。 |
| `autoHide` | `number` | — | 自動消失 ms 數。預設不消失，等使用者互動。 |

### `onChoose(value, index)` 語意

- `index >= 0` — 使用者點了該位置的選項，`value` 就是該選項字串。
- `index === -1` — 使用者在 free-text 列打字後按 Enter，`value` 是他打的字串（沒有特殊的「Other」sentinel — host 直接用 `index === -1` 判斷）。

### 鍵盤

| 鍵 | 行為 |
|---|---|
| `1`..`9` | 選對應 index 的選項。 |
| 點某一列 | 選那個選項。 |
| `Enter`（只在 free-text 輸入內） | 用 `index === -1` 送出打的字。 |
| `Esc` | 觸發 `onCancel`，然後關掉。 |

**Focus guard**：當焦點在別的 `<input>` / `<textarea>` / `<select>` / contenteditable 元素上時，數字鍵**不會**被攔截 — 所以 picker 還在的時候開 palette（或任何別的輸入欄）不會吃掉使用者第一個按鍵。點擊跟 Esc 還是照常。

### `showChoice` 跟 `show` 怎麼挑

使用者要在 2–4 個離散選項裡**挑一個**（「解說 / 摘要 / 翻譯」）時用 `showChoice()`；問題是「對這個動作 yes 或 no」時用 `show()`。兩個都走同一個字幕條 slot，視覺語言一致，差別只在請使用者回什麼形狀的答案。

## 鍵盤對應

字幕條顯示中：

| 鍵 | 行為 |
|---|---|
| `space`（單擊） | onAccept |
| `space`（雙擊） | onReject |
| `Tab` | onAcceptLine — 多行內容只接受第一行（剩下繼續顯示） |
| `Escape` | onCancel |
| `ctrl+space` | input 內專用 accept |

## Voice indicator

Voice 啟動（或 agent 在步驟間）時顯示獨立的小 indicator（圓點跳動 + label），跟主字幕條不同 UI：

```ts
subtitle.showIndicator('listening', '聽取中 — 鬆開結束');
subtitle.showIndicator('processing', '處理中...');
subtitle.hideIndicator();
```

Indicator 跟字幕條不會同時出現 — 字幕條顯示中時，indicator 請求會被排隊，等字幕條收掉才浮上來。詳見上面「Indicator 跟 subtitle 互斥」那一節。

## Surface 整合

短互動（單選 / 確認）走 `inline` placement — 字幕條上方塞一個小 surface。Host 監聽 `surface` event 自己決定畫在哪裡：

```ts
dotdotduck.on('surface', ({ surface, placement }) => {
  if (placement === 'inline') mountAboveSubtitle(surface);
  else if (placement === 'center') mountModal(surface);
  else if (placement === 'dock') mountInDock(surface);
});
```

完整流程見 [surface-renderer](../surfaces/renderer.md)。

## 主題化（要點）

完整變數見 [theming.md](../theming.md)。字幕條相關：

```css
:root {
  --dddk-bar-bg: rgba(255, 255, 255, 0.95);
  --dddk-bar-text: #1a1a1a;
  --dddk-bar-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
  --dddk-bar-radius: 12px;
  --dddk-bar-padding: 12px 16px;
  --dddk-bar-bottom: 24px;
  --dddk-bar-max-width: 640px;
  --dddk-bar-z-index: 10000;
  --dddk-bar-font: system-ui, -apple-system, sans-serif;
}

[data-theme="dark"] {
  --dddk-bar-bg: rgba(28, 28, 28, 0.95);
  --dddk-bar-text: #ffffff;
}
```

## DOM 結構

完全用 `data-dddk-ui` 屬性標記，方便 host 自己清理 / inspect：

```html
<div data-dddk-ui="bar" data-dddk-bar-type="agent">
  <div data-dddk-ui="bar-text">字幕文字</div>
  <div data-dddk-ui="bar-hints">space 同意 · 雙擊 space 拒絕</div>
  <div data-dddk-ui="bar-buttons">
    <button data-dddk-action="accept" aria-label="Accept">✓</button>
    <button data-dddk-action="reject" aria-label="Reject">✕</button>
    <button data-dddk-action="copy" aria-label="Copy">⎘</button>
  </div>
</div>
```

按鈕圖示一律用單色 Unicode（`✓` `✕` `⎘`） — 不用多色 emoji。

## 多 subtitle 怎麼辦

任何時刻最多一個 subtitle bar。新的 `show()` 取代舊的（除非舊的是 `info` 類型自動消失中）。

agent 連續 show 多個 → 後面的覆蓋前面的。如果 host 想做「逐步顯示」，自己排序：

```ts
const steps = ['第一步', '第二步', '第三步'];
for (const step of steps) {
  subtitle.show({ text: step, type: 'info', autoHide: 1500 });
  await new Promise(r => setTimeout(r, 1500));
}
```

## 響應式

- Mobile (< 640px)：字幕條變全寬，hints 折行
- 字幕條會避開 keyboard（mobile 鍵盤彈起時 bottom offset 自動加）

## 不會做

- 不做浮動 / 拖移視窗
- 不做 pin 在 page 內某位置（永遠 fixed bottom）
- 不允許多 instance 並存
- 不支援 rich markdown（subtitle 是純文字 + 少量 emoji）
