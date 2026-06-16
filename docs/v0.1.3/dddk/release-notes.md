# v0.1.3 release notes

Additive minor release on top of v0.1.2. **No breaking changes.** New `InlineAgent` layout, smaller SDK polish.

## TL;DR

- **InlineAgent `layout: 'toolbar'`** — a horizontal, icon-only floating bar (AFFiNE / Notion style) anchored above the selection. Pairs with new `InlineAction.group` / `kind: 'dropdown'` / `items` so editor-style hosts can compose `format buttons + Turn-into dropdown + AI dropdown` in one thin bar.
- **Voice module default labels trimmed** — `listeningLabel` default `'Listening — release to send'` → `'Listening'`; `unsupportedLabel` default also shortened. Hosts overriding either are unaffected.
- **Proactive empty-registry tick skip** — when no prompts are registered, `proactive.tick()` early-returns instead of running fatigue + palette checks for nothing.
- **README polish** — number counts removed from copy ("12 built-in actions" etc. → catalog-style phrasing); `4-axis LLM router` properly described; corner-bubble framing replaced with "not behind a sidebar".

## What changed

### InlineAgent toolbar layout

New `layout: 'toolbar'` alongside the existing `'single-column'` / `'two-column'`. Toolbar mode anchors a horizontal icon-only bar above the selection (flips below when there isn't room), and Three new fields on `InlineAction` let hosts compose grouped clusters with collapsible sub-menus:

- `group` — a string key. Adjacent buttons with different `group` values get a thin vertical divider drawn between them (e.g. `'format'` / `'block'` / `'ai'` → three visually separated clusters).
- `kind: 'dropdown'` — renders the button with a small ▾ chevron; clicking opens a vertical sub-menu populated from `items` instead of running the action directly.
- `items: InlineAction[]` — sub-menu entries. Each item runs through the normal `runAction` pipeline (handler → build → instruction) when picked.

Use case: a Notion / AFFiNE / Lexical-style floating bar with a Bold / Italic / H1 row, a `Turn into` dropdown collapsing the block-type picker, and an `AI` dropdown holding rewrite / translate / summarise — all in one bar.

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

`single-column` / `two-column` behaviour unchanged. Hosts on those layouts upgrade with no code change.

### Voice module default label trim

SDK defaults shortened so hosts who don't override don't ship a sentence-length pill.

```diff
- this.listeningLabel = config.listeningLabel ?? 'Listening — release to send';
- this.unsupportedLabel = config.unsupportedLabel ?? 'This browser does not support voice input';
+ this.listeningLabel = config.listeningLabel ?? 'Listening';
+ this.unsupportedLabel = config.unsupportedLabel ?? 'Voice input not supported';
```

i18n is still the host's responsibility — the SDK ships English-only fallbacks deliberately. Hosts who already pass `listeningLabel` / `unsupportedLabel` see no change.

### Proactive empty-registry tick skip

`proactive.tick()` now early-returns when `prompts.size === 0`, skipping the fatigue and palette-mode checks. Hosts that scaffold proactive infrastructure but don't yet register any prompts no longer pay tick overhead on a 5s interval.

### README polish

Copy improvements following a v0.1.x review:

- Number counts removed from descriptions ("12 built-in actions" / "Seven default actions" / "Three customisation layers" / "Four physical ways" → catalog-style phrasing) so adding new actions / gestures doesn't drift the prose.
- LLM model description rewritten to acknowledge the **4-axis router** (`webagent` / `vision` / `utility` / `plan`) instead of implying one model handles every role.
- Skill SDK clarification — "most hosts only need Script + Prompt" so readers don't think they need to learn all five skill types upfront.
- "not in a corner bubble" replaced with "not behind a sidebar" — the shipped mobile FAB is technically a corner element, but a sidebar is what dddk's positioning actually opposes.

## Compatibility

- All v0.1.2 host config keeps working.
- `InlineAgent` layouts `'single-column'` and `'two-column'` behave identically.
- Hosts overriding `listeningLabel` / `unsupportedLabel` see no change.
- Proactive tick is functionally equivalent — skip kicks in only when there's nothing to evaluate.

## Install

```bash
pnpm add @perhapxin/dddk@0.1.3
# or: npm i @perhapxin/dddk@0.1.3
```
