# 概述

`@perhapxin/dddk` 是一個可直接嵌入任何 web 產品的 AI 互動層。裝套件、mount 一個 instance，你的使用者就拿到：

- **命令面板（Command palette）** — `Ctrl+K` 開啟。前綴路由、模糊搜尋、你自訂的指令。
- **網頁 agent（Web agent）** — 用自然語言下達操作頁面的任務（點擊 / 輸入 / 導頁 / 破壞性操作前確認）。
- **語音輸入** — 長按空白鍵口述，可選 LLM 後處理整理逐字稿。
- **Inline agent** — 在 `<input>` / `<textarea>` / contenteditable 內反白文字，下方浮出翻譯 / 改寫 / 修文法 / 解釋 的小工具列；搭配 Dwell 長按任一元素，可以把該元素塞進下一次 palette / agent 的 context。

這些 UI **你完全不用自己寫**。`dotdotduck` 自帶 palette、字幕條、手機 chrome、agent 游標、Dwell popover 等元件，全部走 CSS 變數可被你的品牌主題化。你只需要註冊「產品能做什麼」（palette item、skill），並接上一個 LLM。

## 30 秒安裝

```bash
npm install @perhapxin/dddk
```

```ts
import { DotDotDuck, OpenAIProvider } from '@perhapxin/dddk';
import '@perhapxin/dddk/styles.css';

const dotdotduck = new DotDotDuck({
  siteName: 'YourSaaS',
  llm: new OpenAIProvider({ apiKey: process.env.OPENAI_KEY! }),
});
dotdotduck.mount();
```

就這樣。`Ctrl+K` 通了、語音通了、Dwell 也通了。

## 接下來看哪一篇

| 你想要... | 看這篇 |
|---|---|
| 在 React / Svelte / Next.js / Vue 用 | [quickstart-frameworks](./quickstart-frameworks.md) |
| 加一個 `/skill` 跑 guided tour 或 LLM 模板 | [skills / how-to-add-a-skill](./skills/how-to-add-a-skill.md) |
| 加一個 palette 指令呼叫你自己的 code | [triggers / palette](./triggers/palette.md) |
| 開/關 語音 / 字幕 / Dwell | [modules / overview](./modules/overview.md) |
| 改色彩 / 字體 / 暗色模式 | [theming](./theming.md) |
| 安全地接自己的 LLM key（伺服端代理） | [agent / security](./agent/security.md) |

## 不要做的事

- 不要自己寫 palette UI — `dotdotduck` 自己 render。
- 不要手動 proxy 事件 — 註冊一個 palette item，dotdotduck 會幫你 fire 它的 handler。
- 不要自己刻 DOM action 層 — webagent 內建 12 個 action 加你的自訂 action 就夠了。
- 不要把 API key 打包進 client bundle。用 `ProxyProvider` + 一個放 key 的 worker。詳見 webagent 的 security guide。

---

## SDK 裡有什麼 — 整張地圖

dddk 比上面四個 headline feature 還大很多。底下其實切成八個 top-level cluster，每一個都有自己的一整個資料夾文件。當你在找「有沒有東西可以做 X？」的時候，這張表是你的 sitemap。

| Cluster | 資料夾 | 一句話 | 文件 |
|---|---|---|---|
| **Triggers** | `triggers/` | 把使用者手勢轉成 dddk 意圖的進入點 — palette、space gesture、Spotter、panel runtime。 | [triggers / overview](./triggers/overview.md) |
| **Skills** | `skills/` | host 行為的可註冊單位，agent（或使用者）可以叫得到 — script、prompt、action、surface、panel。 | [skills / overview](./skills/overview.md) |
| **Modules** | `modules/` | 可選、可掛載的功能：voice、subtitle、Dwell、inline-agent、immersive translate、agent cursor、mobile trigger、form-assist、onboarding、theme + language。 | [modules / overview](./modules/overview.md) |
| **Surfaces** | `surfaces/` | SDK 吐出的結構化 UI — `PieceSurface` tree、`PieceRenderer`、catalog、placement（`center` / `inline` / `dock`）。 | [surfaces / renderer](./surfaces/renderer.md) |
| **Toolbox** | `toolbox/` | 零 LLM、零 server 的 NLP / retrieval primitive — search（BM25）、QA、classify、recommend、memory、proactive、analytics。 | [toolbox / overview](./toolbox/overview.md) |
| **Extensibility** | `extensibility/` | SDK 對外開的接縫 — tools registry 給 agent、evals harness、React adapter、cache + heat-rank。 | [extensibility / tools-registry](./extensibility/tools-registry.md) |
| **Theming** | `theming.md` | dddk render 出來的東西全部重塗的 CSS 變數 token 面。 | [theming](./theming.md) |
| **Quickstart** | `quickstart-frameworks.md` | React / Svelte / Next.js / Vue 各自的接線指南，含正確 lifecycle。 | [quickstart-frameworks](./quickstart-frameworks.md) |

如果你在掃某個特定子系統，**每個子資料夾都有自己的 `overview.md`**（除了 `extensibility/`，那邊的入口是 `tools-registry.md`）。先看 overview，再往下挑你要的章節。

---

## 文件怎麼讀

文件分兩層，看你在做什麼決定先看哪一層。

**Top-level 章節（`dddk/00-*` … `dddk/11-*`）** 是「核心 curriculum」 — 不管你打開哪些功能，每個 host 整合 dddk 都會碰到的東西。第一次把 dddk 接進產品時，按順序讀完：overview → quickstart → theming。這幾篇穩定，很少動。

**子資料夾**（`triggers/`、`skills/`、`modules/`、`surfaces/`、`toolbox/`、`extensibility/`）是深入篇，每個都從自己的 `overview.md` 起頭，先講這個 cluster 的心智模型，然後列出裡面有什麼。當你決定要碰*這個* cluster 才打開 — 例如你決定要加 proactive 建議，那就打開 `toolbox/proactive.md`。整個子資料夾不必都讀；overview 會告訴你哪一章解決你眼前的問題。

有些 cluster 在自己 overview 頂部會掛一個 **「優化中 / Tuning」** 標籤（目前是 `modules/`、部分 `toolbox/` 章節、還有少數 extensibility 章節）。意思是 **API 已經穩定** — 你的程式碼跨 patch release 不會壞 — 但**預設值跟 ergonomics 還在收斂**，會被真實 app 持續壓測。可預期文案、預設逾時、threshold 值會比 function signature 動得多。如果你在 production 跑帶 Tuning 標籤的章節，pin 版本，升級時重看那章。

其他都當作已經定案：型別名、每章 "What's exported" 列出的 public export、prose 描述的行為，就是 contract。

---

## 依角色排的閱讀順序

不是每個讀者都在做同一件事。三條常見路徑：

**你第一次把 dddk 整合進產品。** 照這個順序讀：本篇 overview → [quickstart-frameworks](./quickstart-frameworks.md) → [triggers / palette](./triggers/palette.md) → [skills / how-to-add-a-skill](./skills/how-to-add-a-skill.md) → [theming](./theming.md)。這樣就足夠 ship 一個能跑的整合。其他全部等真的需要再說。

**你在客製外觀。** 直接到 [theming](./theming.md) — 有一個「Build your own theme」cookbook 含 sepia / 高對比 / 品牌色三種 walk-through。然後 [modules / subtitle](./modules/subtitle.md) 如果你想特別調字幕條。

**你要擴 agent 的能力。** 先讀 [extensibility / tools-registry](./extensibility/tools-registry.md) 註冊 tool，然後讀 [toolbox / overview](./toolbox/overview.md) 看現成有什麼再決定要不要自己寫。Repo 裡的 `notes/toolbox-as-tools.md` design doc（clone 過的話）講底層 pattern。

**你在做結構化 UI feature（表單、agent 寫的 panel、dock surface）。** 從 [surfaces / renderer](./surfaces/renderer.md) 開始，然後 [surfaces / pieces-catalog](./surfaces/pieces-catalog.md) 看深一層的 API，最後 [surfaces / placements](./surfaces/placements.md) 看三種 placement 模式。

---

## Public export — contract

從 `@perhapxin/dddk` reach 得到的東西就是 public API。只能從更深的路徑（假設真的存在的 `@perhapxin/dddk/internal/*`）reach 到的就不是。目前我們沒 ship subpath export，規則簡單：

```ts
// Public — 有支援、semver 穩定
import { DotDotDuck, CommandPalette, PieceRenderer } from '@perhapxin/dddk';

// 不要這樣 — 從 node_modules 走相對路徑
import { foo } from '@perhapxin/dddk/dist/internal/foo';
```

每章的 "What's exported" section 列出該章 public surface。如果某個 symbol 沒列在任何 "What's exported" 也不在 `src/index.ts` 裡，當 private 看 — minor 版本之間它可能移位或改名。

---

## 版本

dddk 走 semver 加一個 caveat：**CSS 變數名也是 contract 的一部分**。改 `--dddk-*` token 名是 breaking change，bump minor。加新 token 不算 breaking。Tuning 章節的預設值可以在不 bump 版本下移動 — 如果你依賴特定預設，pin 版本。

Pre-1.0（`v0.x`）：minor bump 可能含尚未穩定 cluster 的 breaking change（目前是 `modules/` 跟 `extensibility/cache-heatrank`）。Patch bump 永遠 non-breaking。

---

## 一段話講完 mental model

如果你只記得一件事：dddk 是一個 host 掛載的 orchestrator（`DotDotDuck`），它擁有四個 trigger（palette、gesture、Spotter、panel）跟一個 host 自訂 skill 的 registry。Skill 是*你的* code 接進來的方式 — 每個 skill 宣告自己能做什麼；orchestrator 把它接到 trigger 跟 LLM。Skill 需要 UI 時，emit 一個 `PieceSurface`（一棵有型別的 primitive tree）；host 用 `PieceRenderer` render。長時間、opt-in 的功能（voice、Dwell、immersive translate、…）以獨立 module 掛載。所有「要文字相關但不要 LLM」的東西 — search、classify、recommend — 在 toolbox 裡。整個 shape 就這樣。每章都是其中一個 box 的放大。

---

## 常見地雷

幾個曾經絆倒真實整合的東西：

- **Mount 兩次。** 沒先 `destroy()` 就再呼叫 `dotdotduck.mount()` 會 double-bind keyboard listener。在有 HMR 的 SPA framework，用「第一次」flag 把 mount 包起來。
- **API key 進 client bundle。** `new OpenAIProvider({ apiKey })` 在 dev 沒事，但 prod 會把你的 key ship 給每個訪客。用 `ProxyProvider` 指向一個藏真 key 的 worker。
- **Skill ID 沒前綴斜線。** Palette 把 `/foo` 當 skill route、`foo` 當搜尋 query。ScriptSkill / PromptSkill 應該 `/` 開頭；ActionSkill / SurfaceSkill 通常以命名 palette item 露出，不走斜線。
- **用 class selector 做主題化。** 不要寫 `.dddk-button { background: red }` — dddk class 不是 contract 的一部分，會改名。用 `--dddk-accent` 跟 `[data-dddk-ui="..."]`。
- **Route 切換忘了 `destroy()`。** SPA host 換根 component 不呼叫 `dotdotduck.destroy()` 會洩漏 listener 跟 DOM。把 `destroy()` 接進你 router 的 unmount hook。

這幾條也會出現在相關章節的「常見地雷」側欄 — 這份就是 union。
