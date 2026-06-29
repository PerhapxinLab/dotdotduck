# Migrating from 0.1.2 to 0.1.3

**Nothing required.** v0.1.3 is additive — every v0.1.2 host config keeps working unchanged.

## 1. Update the package

```bash
npm install @perhapxin/dddk@0.1.3
```

Minimum upgrade ends there.

## 2. Optional — adopt `layout: 'toolbar'` for InlineAgent

If you're shipping an editor-style host (Notion / AFFiNE / Lexical / Tiptap on top of dddk), the new `toolbar` layout is probably what you want:

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

`single-column` / `two-column` are still supported and behave identically — no need to migrate unless you specifically want the toolbar.

## 3. Optional — let the SDK default labels through

If you were overriding `VoiceModule.listeningLabel` / `unsupportedLabel` only because the originals were too long, the new defaults (`'Listening'` / `'Voice input not supported'`) are fine to use as-is. Drop the overrides and the SDK fallback shows the short copy.

Keep your overrides if you have **localised** copy — the SDK still ships English-only fallbacks by design.

## 4. Coming from 0.1.1 or earlier

If you're skipping straight from 0.1.1, read the 0.1.1 → 0.1.2 migration guide and the 0.1.0 → 0.1.1 migration guide first. Each step is small but they're cumulative.
