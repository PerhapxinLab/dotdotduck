# Agent — 概述

## 三種 agent class

v0.2.0 起 dddk 出貨三種 agent class，各有用途：

| Class | 讀 DOM？ | Protocol | 用途 |
|---|---|---|---|
| **`WebAgent`** | ✅ 每 turn 讀整頁 DOM | CoT envelope（或 plain，opt-in） | 操作目前頁面 — navigate / click / fill / narrate + 視覺 overlay。預設的 agent |
| **`TaskAgent`** | ❌ 不讀 DOM | 純 chat + OpenAI tool-calls | 對話 + host 自定 tool。客服、host 資料上的 RAG、後端 orchestrator |
| **`InlineAgent`** | ❌ 只看使用者當下 selection | Streaming | Input / textarea / contenteditable 裡的文字 — improve / translate / rewrite / summarize / diff-preview UX |

三者共用 `AgentSession` 形狀，可以共享對話歷史（`dddk.sessions` + `dddk.agents` registry，見 [/api.md#multi-instance](./api.md)）。

本頁講 **`WebAgent`** — DOM-grounded 那個。TaskAgent 在 [/task-agent.md](./task-agent.md)。InlineAgent 在 [../modules/inline-agent.md](../modules/inline-agent.md)。

## WebAgent 是什麼

**一個 DOM-grounded 的 agent toolkit。**

它讓 AI agent 直接在「人正在看的那個網頁」這層工作 — 讀 DOM、點按鈕、填表單、做頁面導頁、在頁面上 highlight / border 元素、跨頁面維持狀態、必要時暫停下來問使用者。

每一輪 agent 看到：
- **indexed tabbed-tree dump**：每個可操作的元素都有一個 `[N]` 數字索引，LLM 把這個數字傳回來當 selector，不用猜 CSS。
- **viewport markers**（`↑` / `↓`）：哪些元素使用者現在看得到、哪些在視窗上下方。
- **可選的 screenshot**（viewport 或 full-page 自動切片）— 預設關閉，DOM dump 表達不出來的視覺內容才打開。

不是 LangChain 的替代品，而是補充。LangChain 跑在 backend（那邊沒有「頁面」這回事），webagent 跑在 frontend（DOM、accessibility tree、route 都是一等公民）。

## 跟其他 agent 框架的差別

| 維度 | Backend agent orchestrator | 廠商隨附的 agent SDK | Headless 瀏覽器測試 agent | **webagent** |
|---|---|---|---|---|
| 跑在哪 | server | server | server 驅動的 browser | **browser 本身（使用者開的那個頁）** |
| 輸入 | text + tool result | text + tool result | DOM（透過 accessibility tree） | DOM + 使用者看得到的視覺 overlay |
| 跨頁面 | 自己處理 | 自己處理 | session-based | **內建 sessionStorage 持久化** |
| 給使用者看的 UI | 沒有（自己接） | 沒有 | 開發者 trace 介面 | **subtitle / overlay / ask_user / Surface 原生支援** |
| 部署 | server + frontend | server + frontend | server + headless browser | **純 frontend SDK，零 server** |

## 三個核心使用情境

### A. In-app 助手（最主要）
使用者在 SaaS 裡按下 dddk 的 space，講「幫我把這份報告的標題改成更專業的」。webagent 讀當前頁面的 DOM、找到標題元素、改掉文字、用 subtitle 告訴使用者改了什麼。

### B. 自動化導覽 / onboarding
新使用者第一次進來，webagent 跑 `/introduce` skill — 自動帶他逛、highlight 重點、用 subtitle 解釋、等使用者按確認再往下走。

### C. 使用者意圖執行
使用者說「幫我訂下週的會議室」。webagent 走到訂房頁、填日期、選會議室。中途缺資訊就呼叫 `ask_user` 跟使用者確認；如果需要結構化表單，host 用 dddk 的 Pieces 系統開一個 Surface（agent 自己不渲染 UI），使用者填完 agent 拿到資料繼續。

## 不做的事

webagent **不做**：
- 跨網站爬蟲（不是 browser automation tool）
- 後端 agent orchestration（那是 LangGraph 的事）
- 模型訓練 / fine-tune
- 工作流的圖形化編輯（那是 runboard 的事）
- Command palette / 觸發機制（那是 dddk 的事）

webagent 只做一件事：**在當前頁面，根據使用者意圖，用 LLM 操作 DOM**。

## 套件範圍

```
@perhapxin/dddk/src
├── orchestrator.ts   # 頂層 DotDotDuck class — 串接 modules + triggers
├── agent/
│   ├── webagent/     # 主要驅動頁面的 agent loop（DOM tools、ask_user、navigate）
│   ├── inline/       # InlineAgent — 可編輯欄位內的選取編輯
│   ├── llm/          # OpenAI + Google providers、LLMRouter、adapter registry
│   ├── sitemap/      # Sitemap 樹 + 導頁策略
│   └── memory/       # Cross-tab session 持久化
├── modules/          # Voice、TTS、Subtitle、Dwell、ImmersiveTranslate、Palette…
├── triggers/         # space 手勢、hotkey、selection-change observer
├── ui/               # 字幕條、indicator、Surface renderer host
├── skills/           # 內建 skill（introduce…）跟註冊 API
├── toolbox/          # host 可重用的 helper（selection、screenshot、dom serialize）
└── utils/            # 共用低階 helper
```

無框架依賴，純 DOM API + event emitter。任何 React / Vue / Svelte / vanilla HTML 都能用。

## 後續閱讀

- [api.md](./api.md) — public API surface
- [plan.md](./plan.md) — 進 loop 前任務規劃 + 結構化 artifact 模組
- [llm/providers.md](../llm/providers.md) — provider 介面
- [actions/catalog.md](./actions/catalog.md) — DOM action 全清單
- [screenshot.md](./screenshot.md) — 跟 DOM dump 一起送出去的視覺截圖
- [modules/overview.md](./modules/overview.md) — immersive-translate、tts、select-agent
- [security.md](./security.md) — 安全模型、API key、auth scope
- [sitemap/tree.md](./sitemap/tree.md) — sitemap declaration、nav 規範
- [prompt-design.md](./prompt-design.md) — system prompt 分層、brand、appendSystemPrompt
- [session-continuity.md](./session-continuity.md) — cross-tab 同步、session 持久化
