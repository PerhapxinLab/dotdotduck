# dotdotduck — Theming（CSS 變數客製）

> 不同網站要不同 UI 風格。dotdotduck 全部視覺元素用 CSS 變數控制，企業在自己 site CSS 就能完全 override。

## 設計原則

1. **每個視覺值都是變數** — 沒有 hardcode 顏色 / 邊角 / 字型
2. **預設值合理** — 用戶不設定也好看
3. **支援亮 / 暗主題** — 透過 `[data-theme="dark"]` 切換
4. **不污染 host** — 所有 selector 用 `[data-dddk-ui]` 範圍化
5. **Shadow DOM 可選** — 想徹底隔離可以開（trade-off：難 inspect）

## 完整變數清單

### Colors（基礎色）
```css
:root {
  --dddk-accent: #8B7355;              /* 主色：highlight / button / link */
  --dddk-accent-hover: #7A6347;        /* 主色 hover */
  --dddk-accent-active: #6A5337;       /* 主色 active */

  --dddk-bg: rgba(255, 255, 255, 0.96); /* 字幕條、palette、Surface 底色 */
  --dddk-bg-elevated: #ffffff;          /* 卡片底 */
  --dddk-bg-overlay: rgba(0, 0, 0, 0.5); /* modal backdrop */

  --dddk-text: #1a1a1a;
  --dddk-text-muted: #6b6b6b;
  --dddk-text-on-accent: #ffffff;

  --dddk-border: rgba(0, 0, 0, 0.1);
  --dddk-border-focus: var(--dddk-accent);

  --dddk-success: #00aa66;
  --dddk-warning: #ff9900;
  --dddk-error: #cc3333;
  --dddk-info: #3388dd;
}
```

### Spacing & sizing
```css
:root {
  --dddk-radius: 12px;
  --dddk-radius-sm: 6px;
  --dddk-radius-lg: 16px;

  --dddk-spacing-xs: 4px;
  --dddk-spacing-sm: 8px;
  --dddk-spacing-md: 12px;
  --dddk-spacing-lg: 16px;
  --dddk-spacing-xl: 24px;

  --dddk-bar-max-width: 640px;
  --dddk-palette-width: 720px;
  --dddk-palette-max-height: 80vh;
  --dddk-modal-max-width: 560px;
  --dddk-dock-width: 360px;
}
```

### Typography
```css
:root {
  --dddk-font: system-ui, -apple-system, 'Segoe UI', sans-serif;
  --dddk-font-mono: ui-monospace, 'SF Mono', Menlo, monospace;

  --dddk-font-size-sm: 13px;
  --dddk-font-size-md: 14px;
  --dddk-font-size-lg: 16px;
  --dddk-font-size-xl: 20px;

  --dddk-line-height: 1.5;
  --dddk-font-weight-normal: 400;
  --dddk-font-weight-medium: 500;
  --dddk-font-weight-bold: 600;
}
```

### Shadow & effects
```css
:root {
  --dddk-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
  --dddk-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.1);
  --dddk-shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.15);

  --dddk-blur: 12px;  /* backdrop-filter blur amount */
}
```

### z-index 層級
```css
:root {
  --dddk-z-overlay: 9000;
  --dddk-z-bar: 9500;
  --dddk-z-pointer: 9800;
  --dddk-z-palette: 9900;
  --dddk-z-modal: 10000;
  --dddk-z-toast: 10100;
}
```

### Animation
```css
:root {
  --dddk-transition-fast: 80ms ease-out;
  --dddk-transition-md: 200ms ease-out;
  --dddk-transition-slow: 400ms ease-out;
}
```

## 暗主題

```css
[data-theme="dark"] {
  --dddk-accent: #d4a574;
  --dddk-bg: rgba(28, 28, 30, 0.96);
  --dddk-bg-elevated: #2c2c2e;
  --dddk-text: #ffffff;
  --dddk-text-muted: #98989d;
  --dddk-border: rgba(255, 255, 255, 0.1);
  --dddk-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
}
```

或用 prefers-color-scheme：

```css
@media (prefers-color-scheme: dark) {
  :root { /* 同上 */ }
}
```

## 自動跟 host 取色

如果 host 已有自己的 design token：

```css
:root {
  --dddk-accent: var(--brand-primary, #8B7355);
  --dddk-bg: var(--surface-1, rgba(255, 255, 255, 0.96));
  --dddk-text: var(--text-primary, #1a1a1a);
  --dddk-radius: var(--card-radius, 12px);
  --dddk-font: var(--font-sans, system-ui);
}
```

## 完整客製範例

某客戶要 brutalist 風格（方角、黑邊、亮黃）：

```css
:root {
  --dddk-accent: #ffeb3b;
  --dddk-bg: #ffffff;
  --dddk-text: #000000;
  --dddk-border: #000000;
  --dddk-radius: 0;          /* 全方角 */
  --dddk-radius-sm: 0;
  --dddk-radius-lg: 0;
  --dddk-shadow-md: 4px 4px 0 #000;  /* 立體陰影 */
  --dddk-font: 'Space Grotesk', sans-serif;
}

[data-dddk-ui="bar"],
[data-dddk-ui="palette"] {
  border: 2px solid var(--dddk-border);
}
```

## DOM 範圍化

所有 dotdotduck render 出來的元素都有 `[data-dddk-ui]` attribute：

```html
<div data-dddk-ui="bar">           <!-- 字幕條 -->
<div data-dddk-ui="palette">       <!-- palette 容器 -->
<div data-dddk-ui="surface">       <!-- Surface (modal / inline / dock) -->
<div data-dddk-ui="spotter-ring"> <!-- Spotter 環 -->
```

要對某 UI 特別做事 → selector 用 `[data-dddk-ui="bar"]`：

```css
[data-dddk-ui="bar"] {
  /* 只改字幕條樣式 */
}
```

## Shadow DOM 隔離（opt-in）

```ts
new DotDotDuck({
  isolation: 'shadow',  // 預設 'none'
});
```

開了 Shadow DOM：
- ✅ host CSS 完全不會影響 dotdotduck
- ✅ dotdotduck CSS 完全不會洩漏到 host
- ❌ inspector 不好點
- ❌ 部分 keyboard event 行為微妙
- ❌ Surface 自訂 catalog 元件要注意 shadowDOM 邊界

預設不開，因為 99% 場景用 CSS 變數就夠。

## 不同 placement 各自的客製

Surface placement = `dock` 想要不同樣式：

```css
[data-dddk-ui="surface"][data-dddk-placement="dock"] {
  --dddk-radius: var(--dddk-radius-sm);
  width: var(--dddk-dock-width);
  height: 100vh;
  right: 0;
}
```

## 響應式與手機板

### 預設行為（沒寫額外 CSS 就有的）

| 元件 | 預設縮放 |
| --- | --- |
| Command palette | `width: var(--dddk-palette-width, 720px); max-width: 90vw` — 在窄畫面自動縮 |
| Subtitle bar | `max-width: 640px; width: calc(100vw - 32px)` — 全寬留 16px 邊 |
| Surface modal | 跟著你的 placement renderer，預設沒設限 — host 自己決定 |
| Dwell 框 | 純 outline，吃元素自身尺寸 — 不需要 media query |
| Inline AI 選單 | `min-width: 220px; max-width: 280px` — 在窄畫面也不會撐爆 |

所有相關尺寸都是 token (`--dddk-palette-width`, `--dddk-bar-max-width`, `--dddk-dock-width`)，host 可以用 `@media` 重新指定。

### 建議的 breakpoint

dddk 不強制 breakpoint，但建議跟著這條：

```css
@media (max-width: 640px) {
  :root {
    --dddk-palette-width: 100vw;
    --dddk-palette-max-height: 70vh;
    --dddk-bar-bottom: 12px;
    --dddk-bar-padding: 10px 12px;
    --dddk-palette-row-padding: 12px 16px;  /* 大一點的 tap target */
    --dddk-palette-name-font-size: 15px;
  }
  /* palette 變成從底部彈出，不要置中 */
  [data-dddk-ui="palette-backdrop"] {
    padding-top: 0;
    align-items: flex-end;
  }
  [data-dddk-ui="palette"] {
    border-radius: 16px 16px 0 0;
  }
}
```

### MobileTrigger — 手機叫出 dddk chrome

桌機用 `Ctrl+K`、手機用什麼？答案是 `MobileTrigger`：偵測快速上下 swipe（預設 3 個 reversal in 700ms），跳出頂部 + 底部 chrome bar。

```ts
import { MobileTrigger } from '@perhapxin/dddk';

const mobile = new MobileTrigger({
  reversalsToTrigger: 3,   // 預設值
  swipeWindowMs: 700,
  minSwipeDelta: 30,       // 過濾 jitter
  longPressMs: 200,        // 底部圓鈕長按 → voice_start
  doubleTapMs: 350,        // 底部圓鈕雙擊 → gesture_reject
  forceEnable: false,      // true 才會在桌機也跑（測試用）
});
mobile.attachTo(dddk);
```

平常滑動不會誤觸（要有 reversal 才算）。可以在 runtime 開關：`mobile.show()` / `mobile.hide()` / `mobile.toggle()`。

頂部 bar 提供 palette icon（跟 Ctrl+K 一樣），底部圓鈕取代 space：
- 單擊 → `gesture_accept`
- 雙擊 → `gesture_reject`
- 長按 → `voice_start`

完整介面：見 [`MobileTriggerConfig`](../src/modules/mobile-trigger.ts)。

## i18n 字串

不算主題，但同一概念 — 透過 config 注入：

```ts
new DotDotDuck({
  locale: 'zh-TW',
  i18n: {
    'zh-TW': {
      'voice.listening': '聽取中 — 鬆開結束',
      'voice.processing': '處理中...',
      'palette.placeholder': '搜尋指令或頁面內容',
      'subtitle.hint.accept': 'space 同意',
      'subtitle.hint.reject': '雙擊 space 拒絕',
      // ...
    },
  },
});
```

內建 `en` + `zh-TW`，其他語言 host 補。

## 字體載入

dotdotduck 不夾帶字型。host 自己 load：

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --dddk-font: 'Inter', system-ui, sans-serif; }
</style>
```

## 測試 checklist

主題改完，host 應該檢查：
- [ ] 亮 / 暗主題切換正常
- [ ] 字幕條在各種背景下對比夠
- [ ] palette 在不同畫面尺寸正常（mobile / tablet / desktop）
- [ ] Surface modal backdrop 不擋住 host 的 sticky 元素
- [ ] z-index 沒跟 host 的 modal 打架（必要時調 `--dddk-z-*`）
- [ ] Spotter ring 在所有顏色背景下都看得到
- [ ] 字體變數沒造成 layout shift
