# DOM dump 格式

> Agent 每一輪實際看到的文字。想要 fine-tune `appendSystemPrompt` 讓 prompt 提到頁面結構、或 debug「agent 為什麼沒點到對的元素」時，讀這頁。

## Dump 內容是什麼

每一輪 webagent 會把當下頁面序列化成一段精簡文字，貼進 user message 在 LLM call 前。長這樣：

```
URL: https://yoursite.com/pricing
TITLE: Pricing — YourSaaS
VIEWPORT: 240px above · 900px visible · 1820px below

[1]<a href="/">Home</a>
[2]<section> Pricing
	[3]<h2>Plans</h2>
	[4]<table>
		[5]<tr>
			<td>Hobby</td><td>Free</td>
		[6]<tr>
			<td>Pro</td><td>$29 /mo</td>
↓[7]<section> FAQ
	↓[8]<h2>Common questions</h2>
```

三行 header，接著就是每個可操作元素的縮排樹。

## 三行 header

| 行 | 意義 |
|---|---|
| `URL: …` | Agent 目前看的頁面。寫進 prompt 來判斷目的地邏輯 —「如果 user 命名了一個 sitemap 路由、URL 卻不是那個路由，先 navigate」。 |
| `TITLE: …` | `document.title` 截斷後。快速定位用。 |
| `VIEWPORT: 240px above · 900px visible · 1820px below` | User 現在在頁面上的捲動位置。Agent 用這個決定要不要 `scroll_to` 才開始講。 |

`VIEWPORT` 是 SDK 給 agent 最強的「user 注意力在哪」訊號。Prompt 要讓敘事跟著 user 視線時就提它：「若 subject 在可見視窗下方，先 `scroll_to`」。

## 索引樹

每個可操作元素都加一個 `[N]` 數字索引：`[3]`、`[12]` 之類。Agent 呼叫 tool 時用**索引**當 selector：

```
border({ selector: "5" })       // 或 "[5]"，兩個都接
click({ selector: "12" })
scroll_to({ selector: "8" })
```

Host 不需要知道任何 CSS selector；SDK 的 `resolveSelector(target)` 透過 per-turn map 查到對應的 live Element。CSS selector 還是支援，作為非 dump 元素的 fallback。

Tab 縮排反映 sectioning container 的 parent → child 結構（`<section>` / `<article>` / `<aside>` / `<table>` / `<tr>` / `<form>` / `<details>` / `<dl>` / `<dialog>` / `<header>` / `<footer>` / `<main>` / `<nav>` / `<hgroup>`）。其他包裝層（`<div>`、`<span>`、framework `display: contents` fragment）扁平穿過、不加縮排 — 那些是 agent 不需要知道的 DOM 雜訊。

### Viewport 標記

行首的 `↑` 或 `↓` 表示元素**不在當前 viewport 範圍內**：

| 標記 | 意義 |
|---|---|
| `↑` | 已捲過 — 在可見視窗上方 |
|（無） | 目前可見 |
| `↓` | 在可見視窗下方 — user 需要向下捲 |

Agent 想指 `↓` 標記的元素之前要先 `scroll_to`，讓 user 看得到接下來要講的東西。SDK 的內建 system prompt 已經教這個節奏；host 端 prompt 只需要針對 vertical layout 強化。

Viewport 判斷用 `getBoundingClientRect()` 在 dump 時計算，所以每輪都跟著 user 當下的捲動位置走。

## 包進來的東西

| 類別 | 標籤 | 處理方式 |
|---|---|---|
| **互動類** | `<a>`、`<button>`、`<input>`、`<select>`、`<textarea>`、`<label>`、`<summary>`，加上任何帶 interactive ARIA role 的元素（`button` / `link` / `tab` / `menuitem` / `option` / `checkbox` / `radio` / `switch` / `combobox` / `textbox` / `slider` / `spinbutton`）或具鍵盤可聚焦 `tabindex` 且有 accessible label 的元素 | 編號、不下鑽 |
| **標題** | `<h1>` – `<h6>` | 編號 |
| **區塊** | `<section>`、`<article>`、`<aside>`、`<fieldset>`、`<main>`、`<nav>`、`<header>`、`<footer>`、`<hgroup>`、`<table>`、`<tr>`、`<form>`、`<details>`、`<dl>`、`<dialog>` | 編號 + 子元素 bump 縮排 |
| **圖片** | `<img>` | 編號；輸出 `alt` 文字（沒 alt 就用檔名提示） |
| **預格式化** | `<pre>` | 編號；保留換行，上限 600 字 |
| **內容行** | `<p>`、`<li>`、`<td>`、`<th>`、`<dt>`、`<dd>`、`<blockquote>`、`<figcaption>`、`<caption>`、`<legend>`、`<output>`、`<meter>`、`<progress>` | 純文字行、無索引 |

## 丟掉的東西

- `<script>`、`<style>`、`<noscript>`、`<template>`、`<iframe>`、`<svg>`、`<canvas>`、`<source>`、`<track>`、`<head>`、`<meta>`、`<link>` — 直接 skip。
- 被 `display: none` / `visibility: hidden` / 零 bounding box 隱藏的東西。（`display: contents` 例外：元素本身沒 box 但子元素照常 render，walker 會下鑽但不 bump 縮排。）
- Host 透過 `WebAgentConfig.domFilter` 函式 return `false` 過濾掉的元素。
- 含 `class="dddk-skip"` 或 attribute `data-dddk-skip` 的元素（連同子樹）。

## Host 端 opt-out

兩種方式跟 dump 說「不要看這個」：

### Class / attribute 標記

加 `dddk-skip` 到不希望 agent 看到的元素 — 站點 chrome、cookie banner、頁尾小字：

```html
<footer class="site-footer dddk-skip">…</footer>
<div data-dddk-skip>內部用 widget</div>
```

元素本身**跟整個子樹**都從 dump 消失。

### `domFilter` 函式

要做動態判斷（route-specific filter、權限感知）：

```ts
new DotDotDuck({
  webAgent: {
    domFilter: (el) => !el.matches('nav.global-nav, footer, [data-cookie]'),
  },
});
```

Return `false` 丟掉元素 + 子樹。Class-based skip 之後再套這個 filter。

## 大小上限

Dump 字數上限是 `domMaxLength`（預設 ~12,000）。命中時尾端帶 `[...truncated]` marker。dense 頁面（長定價表、章節很多的文件）可以調高；token 預算敏感的部署可以調低。

這個 cap 算的是字數不是 token，但下一層的 `WebAgentConfig.maxPromptTokens` 會在 message array 層級擋整體過長 prompt。

## Debug 開放點

每一輪 dump 都鏡像到 `window.__dddkDebug`：

```ts
window.__dddkDebug.lastDom          // LLM 看到的字串
window.__dddkDebug.lastDomAt        // ISO timestamp
window.__dddkDebug.lastDomBytes     // size
window.__dddkDebug.lastIndexMap     // Map<number, Element>，tool 透過這個 resolve
window.__dddkDebug.lastLlmMessages  // 送進 LLM 的完整 message array（system + history + env block）
```

開 devtools 打 `__dddkDebug.lastDom` 就看得到 model 讀的東西 — 敘事走鐘想問「agent 到底看到那個 section 沒」時這是命脈。

也看：[prompt-design](./prompt-design.md) dump 怎麼跟分層 system prompt 結合、[actions/catalog](./actions/catalog.md) 每個 tool 共用的 indexed-selector 契約、[screenshot](./screenshot.md) 在文字 dump 旁邊另外附 viewport / 整頁 screenshot 的選項。
