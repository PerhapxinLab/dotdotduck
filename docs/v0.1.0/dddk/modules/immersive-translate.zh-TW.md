# ImmersiveTranslate — 雙語頁面渲染

> 走過整個頁面 DOM，把可翻譯區塊一批批送 LLM，翻好後接在每個區塊後面。輸出慣例 — 在每個原始 block 後面接一個 `<font class="dddk-imm-translate">` 包裝 — 是刻意選的，可以挺過大多數富文字編輯器跟 PDF / Office HTML pipeline，不會被 host CSS 蓋掉。

Opt-in。預設關掉；attach 一個 `ImmersiveTranslate` instance，然後從 palette command、按鈕、或其他 host trigger 呼叫 `enable(targetLang)`。

## 什麼時候用

- 用戶在讀外文長文，想把譯文**並排**在原文旁邊，不是取代
- 把 user-facing 文件 / blog / KB 文章在現有 CMS preview 裡翻譯
- 任何需要「對照原文跟譯文逐行學單字」的場景

不要用：

- 文字在**可編輯欄位**裡 — 用 [InlineAgent](./inline-agent.md) 做選取翻譯
- 頁面是用 native PDF 外掛或跨來源 Office Online iframe 渲染 — DOM 摸不到
- 用戶只想翻譯一個字串 — 直接 call `llm.complete()`，不需要 module

## Import

```ts
import { ImmersiveTranslate } from '@perhapxin/dddk';
import type { ImmersiveTranslateConfig } from '@perhapxin/dddk';
```

## 最小設定

```ts
import { ImmersiveTranslate } from '@perhapxin/dddk';

const immersive = new ImmersiveTranslate({
  llm,
  batchSize: 8,       // 每次 LLM call 的 block 數（預設 8，越小越能平行 fan-out）
  batchCharCap: 1200, // 或 batch 字數超過這個就斷（預設 1200）
});
immersive.attachTo(dddk);

// 從 palette 驅動（看 demo 裡的 /immersive_translate）：
await immersive.enable('zh-TW', '繁體中文'); // 整頁跑一次
immersive.disable();                          // 移除注入的譯文
await immersive.toggle('ja', '日本語');        // shorthand
```

## 一次 LLM call 怎麼處理一大堆 block

Prompt 送一個 JSON array，每個元素是一個 block 的原文。回應必須是相同長度的 JSON array。所有 batch 都用 `Promise.all` 平行送，所以整體耗時是最慢那批 batch 的時間，不是所有 batch 相加。

```json
// Request
["The agent runs in the visible DOM…", "Selection rides as context…", "…"]
// Response
["agent 在可見的 DOM 範圍內執行…", "選取會作為 context…", "…"]
```

LLM flag：`thinking: 'off'`、`jsonMode: true`、`temperature: 0.2` — 穩定的翻譯，不是推理。

## Block 偵測

DOM walker 走過所有符合這些 block-level tag 的元素，把每個的 `innerHTML`（不是 `textContent`）當一個單位：

```
p, li, h1, h2, h3, h4, h5, h6, blockquote,
figcaption, td, th, dt, dd, summary, caption
```

自動跳過：

- `[data-dddk-ui]` — dddk 自己的 UI
- `[data-dddk-no-translate]` — host 針對單一元素的 opt-out
- `script`、`style`、`noscript`、`svg`、`code`、`pre`、`kbd`
- `.dddk-imm-translate` — 已翻譯的節點
- 修剪後 `textContent` < 2 字元的元素
- 內含 block-level child 的元素（避免巢狀重複翻譯）

要加更多用 `ignoreSelector`：

```ts
new ImmersiveTranslate({
  llm,
  ignoreSelector: '.ads, .footer-legalese',
});
```

## Inline tag 保留

送出去的是 block 的 `innerHTML` — `<a>`、`<strong>`、`<em>`、`<code>`、`<span>` 這些 inline tag LLM 看得到。System prompt 要求模型逐字保留、包在相同內容外面。URL、數字、日期、專有名詞除非有標準譯名，否則保持不動。

## 設定

| Option | Default | 說明 |
| --- | --- | --- |
| `llm` | — | `LLMSource`（必填）。 |
| `batchSize` | `8` | 每次 LLM call 最多幾個 block。越小越能平行 fan-out。 |
| `batchCharCap` | `1200` | 或 batch 字數累計到這個就斷。 |
| `ignoreSelector` | — | 額外的 CSS selector，符合的元素會被跳過。 |
| `root` | `document.body` | 只在這個元素內走訪。 |
| `cache` | 記憶體 `Map` | `{ get(key), set(key, val) }` — 跨 reload 保留。 |

## Cache

譯文以 `(source-text-hash, target-language)` 為 key，hash 用 32-bit FNV-1a。預設記憶體 `Map` reload 就沒了；要持久化請接 `localStorage`（或任何 KV）：

```ts
new ImmersiveTranslate({
  llm,
  cache: {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
  },
});
```

有 cache 的項目不會打 LLM，所以同一頁同一語言再開一次就是瞬間完成。

## 包裝元素 — 為什麼選 `<font>`

譯文用 `<font class="dddk-imm-translate">` 接在後面（前面加一個 `<br>` 做視覺分隔）。選 legacy 的 `<font>` 是刻意的，因為：

- 大多數富文字編輯器（TinyMCE、ProseMirror、Quill）不會把它的 style 拿掉
- PDF viewer（pdf.js）跟 Office Online overlay 在用戶複製 / 匯出時會保留它
- 預設是 inline，不會破壞 block layout

要換 tag 只能 fork，沒有 per-instance override。

## PDF / docx 支援範圍

只要文件**在 DOM 裡**就能跑：

- pdf.js 的可選取文字 overlay（Chrome 內建 viewer、Mozilla pdf.js）
- `mammoth.js` 渲染的 docx
- 任何 HTML preview component

摸不到的（瀏覽器 sandbox）：

- Native PDF 外掛（瀏覽器內建的 plugin viewer，不是 JS overlay）
- 跨來源 Office Online iframe（Microsoft / Google 嵌入）

選 `<font>` 包裝的好處是：如果你的 host 把 PDF / docx render 成 inline HTML，用戶存檔 / 匯出時雙語排版就會被保留。

## 進度 UI

每個 batch 都會更新 subtitle bar：

```
沉浸式翻譯 → 繁體中文 (148 blocks)
沉浸式翻譯 30/148 → 繁體中文
沉浸式翻譯 60/148 → 繁體中文
...
沉浸式翻譯完成 (148 blocks)
```

Host 想自訂 progress UI 可以聽標準 `subtitle` event 自己畫。

## Runtime API

```ts
await immersive.enable('zh-TW', '繁體中文');  // 跑一次完整 pass
immersive.disable();                          // 移除譯文
await immersive.toggle('ja', '日本語');        // shorthand
immersive.isEnabled();                        // boolean
immersive.language();                         // 目前啟用的 target lang，沒有就 null
```

同語言連續 call `enable()` 兩次是 no-op。切換語言會自動先 disable 前一次。

## SPA 切頁自動清譯文

`attachTo(dddk)` 會裝一個 route-change listener（`popstate` + patch 過的 `history.pushState` / `replaceState`）。任何 SPA 路由變動時模組會**自動 call `disable()`**，把先前注入的 `<font class="dddk-imm-translate">` 全部清掉。沒這條的話 SPA 切頁時 page slot 換了、譯文 node 還掛在沒被卸的父 element 上，會「下面藏著上一頁」。Idempotent — 重複 `attachTo` 會清掉舊 listener；host-agnostic — SvelteKit / Next / Vue Router 都走同一條 API。

## 失敗處理

單一 batch 失敗時那個 batch 會被跳過（log 成 `[immersive-translate] batch failed`），其他文件繼續。頁面永遠不會卡在「半改半沒改、救不回來」的狀態 — `disable()` 永遠用 `.dddk-imm-translate` class 完整清乾淨。

也看：[./inline-agent.md](./inline-agent.md) 可編輯欄位內的選取翻譯；[./overview.md](./overview.md) module 索引。
