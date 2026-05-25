# dotdotduck — Subtitle UI

> 字幕條 — dotdotduck 跟用戶溝通的主要介面。用戶按 space 確認、按雙 space 拒絕、按 Tab 接受部分、按 Escape 取消。

## 結構

字幕條是一條固定在畫面底部、置中的橫條，蓋在頁面內容上方。預設長相：

- 主文字（最多兩行，超出 ellipsis）
- 下方一條小字 hint：`space 同意 · 雙擊 space 拒絕 · Tab 接受一行`
- 不擋互動：點下方頁面元素還是有作用（pointer-events 只覆蓋條本身）

## 五種類型

| Type | 觸發者 | 行為 |
|---|---|---|
| `voice` | 語音轉文字結果 | 顯示 + 等用戶 accept / reject |
| `selection` | SelectionAgent 結果 | 顯示 + 提供 copy / accept |
| `agent` | webagent 的 `show_subtitle` | 顯示 + 允許 agent 繼續 |
| `post` | 一般文字建議（autocomplete） | accept 直接插入 / reject 消失 |
| `info` | 純訊息 | 不需要回應，3 秒自動消 |

## API

```ts
import { Subtitle } from '@perhapxin/dddk';

const subtitle = new Subtitle();

subtitle.show({
  text: '要把標題改成「年度報告」嗎？',
  type: 'agent',
  onAccept?: () => agent.respond('yes'),
  onReject?: () => agent.respond('no'),
  onCancel?: () => agent.stop(),
  hints?: string,  // 自訂 hint 文字
  autoHide?: number,  // ms，預設不自動隱藏
});

subtitle.hide();
subtitle.update(newText);  // 不重建，只改文字
subtitle.isVisible();
```

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

Voice 啟動時顯示獨立的小 indicator（圓點跳動），跟 subtitle 不同 UI：

```ts
subtitle.showIndicator('listening', '聽取中 — 鬆開結束');
subtitle.showIndicator('processing', '處理中...');
subtitle.hideIndicator();
```

樣式上：indicator 在右下角，subtitle 在正下方。

## Surface 整合

短互動（單選 / 確認）走 `inline` placement — 字幕條上方塞一個小 surface。Host 監聽 `surface` event 自己決定畫在哪裡：

```ts
dotdotduck.on('surface', ({ surface, placement }) => {
  if (placement === 'inline') mountAboveSubtitle(surface);
  else if (placement === 'center') mountModal(surface);
  else if (placement === 'dock') mountInDock(surface);
});
```

完整流程見 [08-surface-renderer](./08-surface-renderer.md)。

## 主題化（要點）

完整變數見 [11-theming.md](./11-theming.md)。字幕條相關：

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
  <div data-dddk-ui="bar-hints">space 同意 | 雙擊 space 拒絕</div>
  <div data-dddk-ui="bar-buttons">
    <button data-dddk-action="accept">✓</button>
    <button data-dddk-action="reject">✕</button>
    <button data-dddk-action="copy">📋</button>
  </div>
</div>
```

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

- ❌ 浮動 / 拖移視窗
- ❌ Pin 在 page 內某位置（永遠 fixed bottom）
- ❌ 多 instance 並存
- ❌ Rich markdown（subtitle 是純文字 + 少量 emoji）
