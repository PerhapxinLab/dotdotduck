# 從 0.1.2 升級到 0.1.3

**不需要動什麼**。v0.1.3 是加法 — 所有 v0.1.2 host 設定繼續可用。

## 1. 升級套件

```bash
npm install @perhapxin/dddk@0.1.3
```

最低升級就這樣。

## 2. 可選 — 採用 InlineAgent 的 `layout: 'toolbar'`

如果你做的是編輯器類 host（Notion / AFFiNE / Lexical / Tiptap 上層接 dddk），新的 toolbar layout 大概就是你想要的：

```diff
 new InlineAgent({
-  layout: 'two-column',
+  layout: 'toolbar',
   actions: [
-    { id: 'translate', label: 'Translate', row: 2, ... },
+    { id: 'bold',      label: 'Bold',  icon: 'B', group: 'format', handler: applyBold },
+    { id: 'italic',    label: 'Italic', icon: 'I', group: 'format', handler: applyItalic },
+    { id: 'turn-into', label: 'Turn into', icon: '¶', group: 'block', kind: 'dropdown', items: [
+      { id: 'h1', label: 'H1', icon: 'H1', handler: turnToH1 },
+      { id: 'h2', label: 'H2', icon: 'H2', handler: turnToH2 },
+    ]},
+    { id: 'ai', label: 'AI', icon: '✨', group: 'ai', kind: 'dropdown', items: [
+      { id: 'rewrite',   label: 'Rewrite',   instruction: 'Improve writing' },
+      { id: 'translate', label: 'Translate', instruction: 'Translate to English' },
+    ]},
   ],
 })
```

`single-column` / `two-column` 還是繼續支援、行為跟以前完全一樣 — 沒有特別想要 toolbar 就不用 migrate。

## 3. 可選 — 讓 SDK 預設 label 走預設

如果你之前 override `VoiceModule.listeningLabel` / `unsupportedLabel` 只是因為原本太長，新的預設（`'Listening'` / `'Voice input not supported'`）可以直接吃。把 override 拿掉、SDK fallback 就顯示新的短文案。

如果你的 override 是為了**做翻譯（i18n）**，留著 — SDK 故意只 ship 英文 fallback。

## 4. 從 0.1.1 或更早直接升上來

如果你打算跳過 0.1.2 直接升，先看 0.1.1 → 0.1.2 migration guide 跟 0.1.0 → 0.1.1 migration guide。每一步都小、但是累積的。
