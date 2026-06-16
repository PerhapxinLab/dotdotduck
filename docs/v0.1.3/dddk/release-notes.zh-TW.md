# v0.1.3 釋出說明

加法為主的小改版，疊在 v0.1.2 上。**沒有破壞性改動**。新增 InlineAgent 一種 layout，加上一些 SDK 小修。

## 一句話總結

- **InlineAgent `layout: 'toolbar'`** — AFFiNE / Notion 風格的浮動水平 icon bar，反白後浮在選取上方。配上新的 `InlineAction.group` / `kind: 'dropdown'` / `items`，編輯器類 host 可以擺成「format buttons + Turn-into dropdown + AI dropdown」一條 bar。
- **Voice module 預設 label 截短** — `listeningLabel` 預設從 `'Listening — release to send'` 變 `'Listening'`；`unsupportedLabel` 也跟著縮。host 自己有 override 的不受影響。
- **Proactive tick 空 registry skip** — 沒有註冊任何 prompt 時 `proactive.tick()` 直接 early-return，不再跑 fatigue / palette 那一輪檢查。
- **README 文案 polish** — 拿掉具體數字（"12 built-in actions" 之類 → 改成 catalog 風格）、把 4-axis LLM router 講清楚、把 "not in a corner bubble" 改成 "not behind a sidebar"。

## 改動內容

### InlineAgent toolbar layout

原本只有 `'single-column'` / `'two-column'`，現在多了 `'toolbar'`。toolbar 模式把水平 icon-only bar 浮在選取**上方**（空間不夠就翻下方），加三個新欄位讓 host 可以把按鈕分群 + 收摺子選單：

- `group` — 字串 key。相鄰兩顆 group 不同就插一條垂直分隔線（例如 `'format'` / `'block'` / `'ai'` 三群）。
- `kind: 'dropdown'` — 按鈕帶 ▾ chevron、點下去開垂直 sub-menu（不直接執行 action）。
- `items: InlineAction[]` — sub-menu 子項目。每個 item picker 後走原本的 `runAction` pipeline（handler → build → instruction）。

使用場景：Notion / AFFiNE / Lexical 那種編輯器 host 想做一條浮動 toolbar — Bold / Italic / H1 在 format 群、一顆 `Turn into` dropdown 收掉 block-type picker、一顆 `AI` dropdown 收掉 rewrite / translate / summarise。

```ts
new InlineAgent({
  layout: 'toolbar',
  actions: [
    { id: 'bold', label: 'Bold', icon: 'B', group: 'format', handler },
    { id: 'italic', label: 'Italic', icon: 'I', group: 'format', handler },
    { id: 'turn-into', label: 'Turn into', icon: '¶', group: 'block', kind: 'dropdown', items: [
      { id: 'h1', label: 'H1', icon: 'H1', handler },
      { id: 'h2', label: 'H2', icon: 'H2', handler },
      { id: 'quote', label: 'Quote', icon: '"', handler },
    ]},
    { id: 'ai', label: 'AI', icon: '✨', group: 'ai', kind: 'dropdown', items: [
      { id: 'rewrite', label: 'Rewrite', instruction: '...' },
      { id: 'translate', label: 'Translate', instruction: '...' },
    ]},
  ],
})
```

`single-column` / `two-column` 行為不動。原本走那兩種 layout 的 host 直接升不用改 code。

### Voice module 預設 label 截短

SDK 預設字串縮短，host 沒 override 也不會吃到整句長 pill 文字。

```diff
- this.listeningLabel = config.listeningLabel ?? 'Listening — release to send';
- this.unsupportedLabel = config.unsupportedLabel ?? 'This browser does not support voice input';
+ this.listeningLabel = config.listeningLabel ?? 'Listening';
+ this.unsupportedLabel = config.unsupportedLabel ?? 'Voice input not supported';
```

i18n 還是 host 自己負責 — SDK 故意只 ship 英文 fallback。已經有 override 的 host 完全不變。

### Proactive empty-registry tick skip

`proactive.tick()` 在 `prompts.size === 0` 時直接 early-return，省掉 fatigue 跟 palette mode 兩段檢查。host 有把 proactive 基礎建設接好、但還沒註冊任何 prompt 的情況，不會再每 5 秒空跑一輪。

### README polish

v0.1.x 檢視後的文案修整：

- 拿掉具體數字（「12 built-in actions」/「Seven default actions」/「Three customisation layers」/「Four physical ways」→ catalog 風格的描述），之後加東西不用 drift 文案。
- LLM 模型描述改成講清楚 **4-axis router**（`webagent` / `vision` / `utility` / `plan`），不再讓人誤以為一顆 model 包山包海。
- Skill SDK 補充 — 「多數 host 只需要 Script + Prompt」，不會嚇到讀者以為五種 skill type 都要學。
- 「not in a corner bubble」改成 「not behind a sidebar」 — dddk 自己手機版有 FAB 算是 corner element，但**真正反對的對象**是 sidebar widget，文案改回對。

## 相容性

- 所有 v0.1.2 host 設定繼續可用。
- `InlineAgent` 的 `'single-column'` / `'two-column'` 行為一樣。
- 有 override `listeningLabel` / `unsupportedLabel` 的 host 完全不變。
- Proactive tick 邏輯等價 — skip 只在 0 prompt 的時候才生效。

## 安裝

```bash
pnpm add @perhapxin/dddk@0.1.3
# or: npm i @perhapxin/dddk@0.1.3
```
