# webagent — Screenshot

> 每一輪都把當前畫面的截圖跟 DOM dump 一起送進 LLM。

預設關閉。DOM dump 足以應付大部分敘事任務 — 文字、連結、標題、表格列。當 agent 需要評論 DOM 表達不出的視覺內容時才打開：圖表、自繪 canvas、複雜視覺排版、以圖為主的商品卡。

## 快速開始

```ts
import { WebAgent } from '@perhapxin/dddk';

const agent = new WebAgent({
  llm: ...,
  screenshot: true,         // 速記 → viewport 模式
});
```

完整選項：

```ts
new WebAgent({
  llm: ...,
  screenshot: {
    mode: 'full-page',      // 'viewport'（預設）｜'full-page'
    maxSegmentHeight: 4000, // 太長的頁面每張圖最高這麼多 px
    maxImages: 3,           // 一輪最多幾張
    quality: 0.75,          // JPEG 品質 0–1
    scale: 0.75,            // 縮放係數 0.25–2
  },
});
```

## 兩種模式

| 模式 | 截什麼 | 每輪圖數 |
|---|---|---|
| `viewport` | 使用者當下看到的範圍 | 1 |
| `full-page` | 整個 scroll height，太高的自動切成多張 | 1–`maxImages` |

`viewport` 便宜，跟使用者眼睛看到的同步。`full-page` 適合需要 agent 對整頁推理的場景（橫跨整張長表格的定價比較、整篇 docs 從頭到尾）。

## Peer dependency

預設用 [`html2canvas`](https://www.npmjs.com/package/html2canvas) — 只在打開 screenshot 時才動態載入的選用依賴。

```bash
pnpm add html2canvas
```

如果開了 `screenshot` 但沒裝 `html2canvas`，capture 會靜默 no-op，agent 改跑純文字模式。不會 throw，不會炸 loop，只是沒圖。

## 自帶 capture

要做 SSR、headless browser 截圖、或任何其他來源，傳一個 `capture` function：

```ts
new WebAgent({
  llm: ...,
  screenshot: {
    mode: 'full-page',
    capture: async (mode) => {
      // 回傳一張或多張 data URL（或 LLM 能 fetch 的 URL）。
      const res = await fetch('/api/render', { method: 'POST', body: JSON.stringify({ mode, url: location.href }) });
      const { images } = await res.json();
      return images;
    },
  },
});
```

提供 `capture` 時，`html2canvas` 不會被載入。

## 圖怎麼送進 LLM

截到的圖會變成 `{ type: 'image', image: dataUrl }` content part，跟那一輪的 DOM dump 掛在同一個 user message 上。Provider adapter 自動轉成各家的格式 — OpenAI 的 `image_url`、Google 的 `inlineData` 之類。

## 成本考量

每張圖都吃 token。預設值（`maxImages: 3`、`scale: 0.75`、`quality: 0.75`）下一張 viewport 截圖大約等於幾千個 text token。full-page 模式請乘上 `maxImages`。

成本敏感時優先用 `viewport`，剩下的靠 indexed DOM dump 補。Dump 是文字、便宜，而且任何有標籤的東西它都沒丟。

## 什麼時候別開

- 純文字網站（docs、部落格、設定面板）— DOM dump 已經涵蓋全部。
- 延遲敏感的流程 — 每次截圖大約 +300 ms（裝置慢的會更久）。
- 跨 origin 或 shadow DOM 重的元件 — `html2canvas` 在這些情境有已知限制，建議先在你的頁面實測。
