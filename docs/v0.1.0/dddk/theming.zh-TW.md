# dotdotduck — Theming（CSS 變數客製）

> 不同網站要不同 UI 風格。dotdotduck 全部視覺元素都走 CSS 變數，企業在自己的 site CSS 直接 override 就好。

## 設計原則

1. **每個視覺值都是變數** — SDK 內沒有 hardcode 的顏色 / 邊角 / 字型
2. **預設值合理** — 使用者不設定也好看
3. **支援亮 / 暗主題** — 用 `[data-theme="dark"]` 切
4. **不污染 host CSS** — 所有 dddk selector 都在 `[data-dddk-ui]` scope 下
5. **走 global CSS 變數，不走 Shadow DOM** — rationale 見下方 [Shadow DOM 段落](#shadow-dom-為什麼我們不用)

## 完整變數清單

### Colors（基礎色）
```css
:root {
  --dddk-accent: #ec4899;              /* 主色：highlight / button / link */
  --dddk-accent-hover: #db2777;        /* 主色 hover */
  --dddk-accent-soft: rgba(236, 72, 153, 0.12); /* 淡底 */

  --dddk-bg: #ffffff;                  /* 字幕條、palette、Surface 底色 */
  --dddk-bg-elevated: #ffffff;         /* 卡片底 */
  --dddk-bg-overlay: rgba(0, 0, 0, 0.45); /* modal backdrop */

  --dddk-text: #18181b;
  --dddk-text-muted: #71717a;
  --dddk-text-on-accent: #ffffff;

  --dddk-border: rgba(0, 0, 0, 0.08);
  --dddk-border-focus: var(--dddk-accent);

  --dddk-success: #00aa66;
  --dddk-warning: #ff9900;
  --dddk-error:   #cc3333;
  --dddk-info:    #3388dd;
}
```

### Spacing & sizing
```css
:root {
  --dddk-radius: 10px;
  --dddk-radius-sm: 6px;
  --dddk-radius-lg: 16px;

  --dddk-spacing-xs: 4px;
  --dddk-spacing-sm: 8px;
  --dddk-spacing-md: 12px;
  --dddk-spacing-lg: 16px;
  --dddk-spacing-xl: 24px;

  --dddk-bar-max-width: 720px;
  --dddk-palette-width: 600px;
  --dddk-palette-max-height: 480px;
  --dddk-modal-max-width: 560px;
  --dddk-dock-width: 360px;
}
```

### Typography
```css
:root {
  --dddk-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --dddk-font-mono: ui-monospace, 'SF Mono', Menlo, monospace;

  --dddk-font-size-sm: 12px;
  --dddk-font-size-md: 14px;
  --dddk-font-size-lg: 16px;

  --dddk-line-height: 1.55;
  --dddk-font-weight-medium: 500;
}
```

### Shadow & effects
```css
:root {
  --dddk-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.06);
  --dddk-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.08);
  --dddk-shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.12);

  --dddk-blur: 16px;
}
```

### z-index 層級
```css
:root {
  --dddk-z-bar: 9700;
  --dddk-z-palette: 9600;
  --dddk-z-pointer: 9500;
  --dddk-z-cursor: 9800;
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

## 暗色主題

```css
[data-theme="dark"] {
  --dddk-bg: #09090b;
  --dddk-bg-elevated: #18181b;
  --dddk-text: #fafafa;
  --dddk-text-muted: #a1a1aa;
  --dddk-border: rgba(255, 255, 255, 0.1);
  --dddk-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.5);
}
```

或走 `prefers-color-scheme`：

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { /* 同一組 */ }
}
```

## 從 host design token 繼承

如果 host 已經有自己的 design token：

```css
:root {
  --dddk-accent: var(--brand-primary, #ec4899);
  --dddk-bg:     var(--surface-1, #ffffff);
  --dddk-text:   var(--text-primary, #18181b);
  --dddk-radius: var(--card-radius, 10px);
  --dddk-font:   var(--font-sans, system-ui);
}
```

## 完整客製範例 — brutalist

某客戶要 brutalist 風格（方角、黑邊、亮黃）：

```css
:root {
  --dddk-accent: #ffeb3b;
  --dddk-bg: #ffffff;
  --dddk-text: #000000;
  --dddk-border: #000000;
  --dddk-radius: 0;
  --dddk-radius-sm: 0;
  --dddk-radius-lg: 0;
  --dddk-shadow-md: 4px 4px 0 #000;
  --dddk-font: 'Space Grotesk', sans-serif;
}

[data-dddk-ui="bar"],
[data-dddk-ui="palette"] {
  border: 2px solid var(--dddk-border);
}
```

## DOM 範圍化

dotdotduck render 出來的元素都帶 `[data-dddk-ui]` attribute：

```html
<div data-dddk-ui="bar">           <!-- 字幕條 -->
<div data-dddk-ui="palette">       <!-- palette 容器 -->
<div data-dddk-ui="surface">       <!-- Surface (modal / inline / dock) -->
<div data-dddk-ui="spotter-ring">  <!-- Spotter 環 -->
```

要對某個 UI 特別下手：

```css
[data-dddk-ui="bar"] {
  /* 只改字幕條樣式 */
}
```

---

## 自己做一個主題 — cookbook

三個實例。每一個都按同一組順序蓋同一組變數：accent → surface → text → border → radius → shadow → typography。這個順序是刻意的 — accent 視覺最強，surface 次之，依此類推。從上而下調，theme 讀起來會 coherent；亂跳，會調出科學怪人。

### CSS rule 放哪裡

dddk 沒有 "theme 系統" — 沒有 theme registry、沒有 `setTheme()`。你寫一段 CSS rule，rule 底下的元素就吃到變數。兩種常見 pattern：

```css
/* Pattern A：site-wide。放在 global stylesheet，要 load 在
 * @perhapxin/dddk/styles.css 之後，這樣同 specificity 時你贏。 */
:root {
  --dddk-accent: #8B7355;
  /* ... */
}

/* Pattern B：scope 到某個區段。Wrapper 上掛一個 class。 */
.docs-section {
  --dddk-accent: #8B7355;
  /* ... */
}
```

Pattern A 是預設正確答案。Pattern B 用在「行銷站走品牌色，內嵌的後台用比較沉穩的色」這類場景。

### 範例 1：sepia（溫暖、紙感）

Sepia 配色給人的感覺是溫、低對比。重點不在 accent，在 surface tint。

```css
:root {
  /* accent：低飽和棕，不是亮橘 */
  --dddk-accent: #8B7355;
  --dddk-accent-hover: #7A6347;
  --dddk-accent-soft: rgba(139, 115, 85, 0.12);

  /* surface：淡淡的暖色 tint — 純 #fff 會打破溫暖感 */
  --dddk-bg: #f5ecd9;
  --dddk-bg-elevated: #faf2e0;
  --dddk-bg-overlay: rgba(60, 40, 20, 0.4);

  /* text：深棕，不是純黑；暖色一路貫穿 */
  --dddk-text: #3b2c1a;
  --dddk-text-muted: #7a6750;
  --dddk-text-on-accent: #faf2e0;

  /* border：同色相、低 alpha */
  --dddk-border: rgba(80, 60, 30, 0.15);

  /* radius：軟、有機 */
  --dddk-radius: 14px;
  --dddk-radius-sm: 8px;

  /* shadow：暖色 tint 的陰影，不要中性黑 */
  --dddk-shadow-md: 0 4px 16px rgba(80, 50, 20, 0.12);

  /* typography：紙感主題，serif 很合 */
  --dddk-font: 'Iowan Old Style', Georgia, serif;
}
```

關鍵：**任何地方都不要留純白**。只要一個 surface 還是 `#ffffff`，整個 theme 就破功。`--dddk-bg`、`--dddk-bg-elevated`、還有 `--dddk-bar-bg`（字幕條有自己的 — 見下）都要蓋。

### 範例 2：高對比 / 無障礙

給需要極高對比的使用者（低視力、強光環境、無障礙合規）。重點在 border 跟 shadow — **不在** accent。

```css
:root {
  /* accent：深飽和，跟 bg 強烈對比 */
  --dddk-accent: #0033cc;
  --dddk-accent-hover: #002299;
  --dddk-accent-soft: rgba(0, 51, 204, 0.18);

  /* surface：純白 + 純黑 overlay */
  --dddk-bg: #ffffff;
  --dddk-bg-elevated: #ffffff;
  --dddk-bg-overlay: rgba(0, 0, 0, 0.75);

  /* text：純黑，沒有 muted gray */
  --dddk-text: #000000;
  --dddk-text-muted: #333333;  /* 不要比 #333 還淺 */
  --dddk-text-on-accent: #ffffff;

  /* border：每個 chrome 元素都 1.5–2px 的黑色 solid */
  --dddk-border: #000000;

  /* radius：小或零 — 線條密度比圓角重要 */
  --dddk-radius: 4px;
  --dddk-radius-sm: 2px;

  /* shadow：改成 hard offset，類似刻印的 UI */
  --dddk-shadow-sm: 2px 2px 0 #000;
  --dddk-shadow-md: 3px 3px 0 #000;
  --dddk-shadow-lg: 4px 4px 0 #000;
}

[data-dddk-ui="bar"],
[data-dddk-ui="palette"],
[data-dddk-ui="surface"] {
  border: 2px solid var(--dddk-border);
}
```

那段顯式 `border: 2px solid` 必要 — 預設 token 是 `rgba(0,0,0,0.08)`，故意很淡。光把 `--dddk-border: #000` 不會把 border 加粗；你還要對在乎的 chrome 元素加 `border-width`。

### 範例 3：品牌色（例如 Notion 風）

對齊 host 已有的 design system。多半 host 本來就有 `--brand-*` 那組 token；把 dddk token 綁過去就好。

```css
:root {
  /* 綁到你現有的 token — fallback 保險 */
  --dddk-accent:       var(--brand-primary,    #2e2e2e);
  --dddk-accent-hover: var(--brand-primary-hover, #1a1a1a);

  --dddk-bg:           var(--surface-1,        #ffffff);
  --dddk-bg-elevated:  var(--surface-2,        #f7f6f3);

  --dddk-text:         var(--text-primary,     #37352f);
  --dddk-text-muted:   var(--text-secondary,   #787774);

  --dddk-border:       var(--divider-default,  rgba(55, 53, 47, 0.09));

  --dddk-radius:       var(--radius-card,      6px);
  --dddk-font:         var(--font-sans,        'Inter', system-ui);
}
```

`var(brand-x, fallback)` 這個 pattern 很關鍵：如果某個 route load 順序跑前 host CSS 還沒到（少見但 code-split app 會），dddk 還是會用 fallback render，不會變成 `unset`。

### 不在基本清單裡、但你可能要蓋的東西

字幕條有自己的變數（過去 contrast 出過 bug — rationale 看 `dddk/src/styles/tokens.css` 內的 inline comment）：

```css
:root {
  --dddk-bar-bg: rgba(255, 255, 255, 0.98);
  --dddk-bar-text: var(--dddk-text);
  --dddk-bar-border: rgba(0, 0, 0, 0.12);
  --dddk-bar-shadow: 0 12px 36px rgba(0, 0, 0, 0.18),
                    0 2px 8px rgba(0, 0, 0, 0.08);
}
```

不要假設 `--dddk-bg` 會管到字幕條。不會。字幕條讀 `--dddk-bar-bg`，這樣不論 host bg 是什麼它都維持 lifted。

Palette row 也有自己的 token（`--dddk-palette-row-bg-hover`、`--dddk-palette-row-bg-active`、`--dddk-palette-match-bg`、…）。完整清單在 `dddk/src/styles/tokens.css`。

### 測試 checklist

主題改完，host 該檢查：

- [ ] 亮 / 暗主題切換正常
- [ ] 字幕條在各種背景下對比都夠（試淺色頁、hero 圖、深色 dashboard）
- [ ] palette 在 mobile / tablet / desktop 寬度都能用
- [ ] Surface modal backdrop 不會意外擋到 host sticky 元素
- [ ] z-index 沒跟 host modal 打架（必要時調 `--dddk-z-*`）
- [ ] Spotter ring 在 app 用到的每個背景色上都看得到
- [ ] 換字型不會 layout shift（preload 字型）

---

## Placement 各自客製

Surface placement = `dock` 想要不同樣式：

```css
[data-dddk-ui="surface"][data-dddk-placement="dock"] {
  --dddk-radius: var(--dddk-radius-sm);
  width: var(--dddk-dock-width);
  height: 100vh;
  right: 0;
}
```

## 響應式 / 手機版

### 預設行為（不寫 extra CSS 就有的）

| 元件 | 預設縮放 |
| --- | --- |
| Command palette | `width: var(--dddk-palette-width, 600px); max-width: 90vw` — 在窄畫面自動縮 |
| Subtitle bar | `max-width: 720px; width: calc(100vw - 32px)` |
| Surface modal | 跟著你的 placement renderer 走；host 自己決定 |
| Dwell 框 | 純 outline，吃元素自身尺寸 — 不需要 media query |
| Inline AI 選單 | `min-width: 220px; max-width: 280px` |

所有相關尺寸都是 token（`--dddk-palette-width`、`--dddk-bar-max-width`、`--dddk-dock-width`），host 可以用 `@media` 重新指定。

### 建議的 breakpoint

dddk 不強制 breakpoint，但這條是個好起點：

```css
@media (max-width: 640px) {
  :root {
    --dddk-palette-width: 100vw;
    --dddk-palette-max-height: 70vh;
    --dddk-bar-bottom: 12px;
    --dddk-bar-padding: 10px 12px;
  }
  /* palette 從底部滑上來，不置中 */
  [data-dddk-ui="palette-backdrop"] {
    padding-top: 0;
    align-items: flex-end;
  }
  [data-dddk-ui="palette"] {
    border-radius: 16px 16px 0 0;
  }
}
```

## i18n 字串

不算 theming，但同一個概念 — 透過 config 注入：

```ts
new DotDotDuck({
  locale: 'zh-TW',
  i18n: {
    'zh-TW': {
      'voice.listening': '聽取中 — 鬆開結束',
      'voice.processing': '處理中...',
      'palette.placeholder': '搜尋指令或頁面內容',
    },
  },
});
```

內建：`en` + `zh-TW`。其他語言：host 自己補。

## 字型載入

dotdotduck 不夾帶字型。host 自己 load：

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --dddk-font: 'Inter', system-ui, sans-serif; }
</style>
```

---

## <a id="shadow-dom-為什麼我們不用"></a>Shadow DOM — 為什麼我們不用

你可能在其他 widget SDK 看過預設用 Shadow DOM 做樣式隔離。dddk **不用** — 它 render 出來的每個 DOM node 都跟你 app 的 DOM 在同一棵樹裡，每條 style 都是讀變數的一般 global CSS。設計上**沒有** `isolation: 'shadow'` 這個 config。

### 為什麼不用 Shadow DOM

1. **Host 本來就想主題化 dddk。** Shadow DOM 存在的目的是*阻止* host CSS 進來 widget。但我們看到的每個 dddk 整合都想要相反 — 對齊 host 的品牌色、字體、radius。Shadow DOM 會強迫每個 theme override 都走 JS API 或 `::part()` selector，兩個都沒 global CSS 變數靈活。
2. **CSS 變數本來就會跨邊界。** 就算 dddk 在 shadow root 裡，CSS custom properties 還是會穿透 inherit。所以你還是需要那組變數 token API。Shadow DOM 多一層 indirection，卻沒解決真正的問題（host CSS 漏*進* dddk）。
3. **Inspector / devtools 不順手。** 看 shadow root 要顯式打開。對使用者天天看到的 UI 來說，這是開發者每天的麻煩。
4. **Keyboard event 微妙。** 部分 keyboard event 在 shadow root 內行為不同（focus boundary、retargeting）。dddk 重度依賴鍵盤輸入 — palette、gesture、語音 trigger — 我們不想招惹這些邊角案例。
5. **Tree-shake + bundle size。** Shadow DOM 模式要自己的 style injection path。出一個 CSS 檔讓 host bundler 自己 dedupe 比較簡單也比較小。

### dddk 改怎麼做

- **Scoped selector。** 每個 dddk root 都有 `[data-dddk-ui="..."]`。`dddk/src/styles/*.css` 裡的 style rule 一律 `[data-dddk-ui="bar"]`、`[data-dddk-ui="palette"]` 開頭 — 所以 host CSS 對 `div`、`button`、class name 下手不會意外打到 dddk。
- **走變數的值。** 每個顏色 / radius / 字型都讀一個 `--dddk-*` token。Token 是 public 的 theming API；實作 CSS 不是。
- **預設高 z-index。** dddk chrome（`--dddk-z-bar`、`--dddk-z-palette`、…）都在 9000–9800 區段，幾乎蓋過所有 host UI。如果 host modal 要壓過 dddk，蓋 token。

### 沒有 Shadow DOM 要注意的事

- **Specificity 大戰。** host CSS 例如 `.app button { background: red }` 如果 load 在 `@perhapxin/dddk/styles.css` 之後，可能蓋過 dddk button 的背景。修法：把 `@perhapxin/dddk/styles.css` load 在你 global host style *之後*（或 host CSS 也用 `[data-dddk-ui]` scope）。
- **Accent 繼承範圍。** `--dddk-accent` 會流到每個 dddk surface — palette focus row、button bg、Dwell ring、Spotter ring。在 `:root` 蓋一次通常就是你要的。如果 host 在比較深的層級蓋（`.dashboard { --dddk-accent: blue }`），只有 render 在 `.dashboard` *裡面*的 dddk UI 看得到；portal 到 `<body>` 的 UI（palette、modal Surface）看不到。要整個 app 統一 accent，蓋在 `:root` 或 `html`。
- **Reset stylesheet。** Host 如果做激進的 CSS reset（`* { all: unset }` 那種），dddk UI 會壞，因為 `<button>` 這類元素還要靠預設 render。Reset 規則應該 scope 到 host 內容，別 global。

如果你的環境真的需要硬隔離（例如要把 dddk 嵌進一個不信任的 host page，像 third-party extension），開 issue — Shadow DOM 模式是「有需求才會回來看」的東西，但 v0.1.0 還不在 roadmap 上。
