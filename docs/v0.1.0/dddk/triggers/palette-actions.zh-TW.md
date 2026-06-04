# Palette actions

Palette item 可以放一個原本的 `handler`，也可以放一個 typed **actions** 陣列。Action 是一個 discriminated union — 每種 kind 有自己的 payload、dddk 自動帶對應 icon、副作用（剪貼簿、導航、agent dispatch）由 runner 處理，命令的人不必每次自己寫。

```ts
import { runAction } from '@perhapxin/dddk';
import type { PaletteAction } from '@perhapxin/dddk';
```

當 item 帶了 `actions: PaletteAction[]`：

- **Primary**（第一個）按 `⏎` 跑。
- **Secondary**（第二個，如果有的話）按 `Ctrl+⏎` 跑。
- 其他的按 `Ctrl+K` 展開 sub-panel。

只需要一個效果，就放一個 entry — 體驗跟 `handler` 差不多，但能拿到正確的 icon 跟對應的副作用。

---

## 八種 kind

| kind             | payload                                | 做什麼                                                                      |
| ---------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| `copy`           | `content: string`                      | `navigator.clipboard.writeText(content)`。                                  |
| `insert`         | `text: string`                         | 在頁面當下 focus 的 `<input>` / `<textarea>` / contenteditable 的游標位置插字。 |
| `open-url`       | `url: string, target?: 'self' \| 'new'`| `window.open(url, target)`。預設 `new`。                                    |
| `navigate`       | `path: string`                         | 呼叫 host 的 `onNavigate(path)`（SPA 友善）。                               |
| `agent-task`     | `task: string`                         | 把字串丟給 webagent — 等同 `dddk.startAgent(task)`。                        |
| `render-surface` | `surface: PieceSurface, placement?`    | 發出一個 Surface，host 用 `PieceRenderer` render。                         |
| `run-skill`      | `skillId: string, vars?`               | 從 registry 找 skill 來跑，帶 template vars。                              |
| `custom`         | `onActivate(ctx)`                      | 逃生口 — 任意 callback，拿到一樣的 `ActionRunContext`。                    |

共用欄位（所有 kind）：

| field         | type              | 預設     | 做什麼                                                       |
| ------------- | ----------------- | -------- | ----------------------------------------------------------- |
| `title`       | `string`          | —        | action panel 上的 label。                                    |
| `icon`        | `string`          | auto     | 字形；沒給就用 `defaultIconFor(kind)`。                      |
| `shortcut`    | `string`          | —        | 只是顯示的鍵盤提示，例如 `'⌘C'`，不會真的 bind。              |
| `destructive` | `boolean`         | `false`  | 顯示成紅色；要 confirm 的話自己在 host 層加。                |

---

## Quick start — 一個 item，多個 action

```ts
import { DotDotDuck } from '@perhapxin/dddk';
import type { PaletteAction } from '@perhapxin/dddk';

const actions: PaletteAction[] = [
  { kind: 'copy',       title: '複製發票編號', content: 'INV-2042' },
  { kind: 'open-url',   title: '在 Stripe 開啟', url: 'https://dashboard.stripe.com/invoices/INV-2042' },
  { kind: 'agent-task', title: '問 AI 為什麼失敗', task: '為什麼 INV-2042 這張發票失敗？查 payment log。' },
  { kind: 'navigate',   title: '跳到客戶',     path: '/customers/cus_42' },
];

dddk.palette.addItem({
  id: 'invoice-INV-2042',
  name: '發票 INV-2042',
  description: 'Failed · $84.20',
  section: 'Billing',
  actions,
});
```

`⏎` 複製，`Ctrl+⏎` 開 Stripe，`Ctrl+K` 展開 sub-panel 看 agent task 跟 navigate 那兩列。

---

## 各 kind 細節

### `copy`

```ts
{ kind: 'copy', title: '複製 API key', content: 'sk_live_…', concealed: true }
```

`concealed: true` 是給 host 端剪貼簿歷史紀錄的 hint — dddk 自己不存歷史。

### `insert`

```ts
{ kind: 'insert', title: '插入簽名', text: '— Sent from dddk' }
```

對象是 `document.activeElement`。`<input>`、`<textarea>`、contenteditable 都吃。沒人 focus 就什麼都不會發生。最常拿來做文字片段展開那種 palette item。

### `open-url`

```ts
{ kind: 'open-url', title: 'Docs', url: 'https://docs.example.com', target: 'new' }
```

預設 `target: 'new'`。真的要離開 SPA 才用 `'self'`。

### `navigate`

```ts
{ kind: 'navigate', title: '開 billing', path: '/billing' }
```

呼叫 host 的 `onNavigate`（在 `DotDotDuckConfig` 傳的）。沒接的話這個 action 等於什麼都沒做 — 看 [palette](./palette.md) 的 config 怎麼接。

### `agent-task`

```ts
{ kind: 'agent-task', title: '幫我整理這頁', task: '用三點摘要這一頁。' }
```

效果跟 `dddk.startAgent(task)` 一樣。Palette 會先關，pinned context（selection、附件）會自動帶進 agent。看 [webagent api](../agent/api.md)。

### `render-surface`

```ts
{
  kind: 'render-surface',
  title: '顯示方案卡片',
  surface: {
    root: {
      kind: 'Card',
      children: [
        { kind: 'Heading', text: 'Pro plan' },
        { kind: 'Metric', label: '每月', value: '$29' },
      ],
    },
  },
  placement: 'center',
}
```

發 `surface` event，host 用 `PieceRenderer` 渲染。Placement 可以是 `'center' | 'inline' | 'dock'` — 看 [pieces / surfaces](../surfaces/renderer.md)。

### `run-skill`

```ts
{ kind: 'run-skill', title: '翻譯這頁', skillId: 'translate', vars: { language: '英文' } }
```

從 `SkillRegistry` 撈出來跑。`vars` 會 template-substitute 進 skill 的 prompt / steps。

### `custom`

```ts
{
  kind: 'custom',
  title: '重新整理儀表板',
  onActivate: (ctx) => {
    refreshAll();
    ctx.startAgent('告訴使用者儀表板資料已更新。');
  },
}
```

`onActivate` 拿到一個 `ActionRunContext`：

```ts
interface ActionRunContext {
  navigate(path: string): void;
  startAgent(task: string): void;
  runSkill(skillId: string, vars?: Record<string, string>): void;
  emitSurface(surface: unknown, placement?: SurfacePlacement): void;
}
```

沒有任何 typed kind 能塞才用 `custom`。「開 URL + 然後做 X」這種應該用兩個 typed action 串起來 — action panel 就是為這個生的。

---

## 直接呼叫 `runAction()`

要在 palette 以外的地方跑 action（例如某個 toolbar 按鈕），就 call `runAction`：

```ts
import { runAction } from '@perhapxin/dddk';

await runAction(
  { kind: 'copy', title: '複製', content: 'hello' },
  {
    navigate:     (path) => goto(path),
    startAgent:   (task) => dddk.startAgent(task),
    runSkill:     (id, vars) => dddk.runSkill(id, vars),
    emitSurface:  (surface, placement) => dddk.emitSurface(surface, placement),
  },
);
```

在 palette 裡 dddk 會自動把 context 接好，你只有在 palette 外面想復用同一個 action 的時候才需要自己呼叫 `runAction`。

---

## 哪一種 kind 該選哪個

- **不用扯 LLM？** `copy` / `insert` / `open-url` / `navigate`。瞬發、可預測、不耗 token。
- **要交給 agent？** `agent-task`。
- **有結構化表單 / 結果 UI？** `render-surface` 配一個 `SurfaceSkill` — 看 [skills](../skills/overview.md)。
- **多步驟反覆做？** `run-skill` 接 `ScriptSkill` 或 `PromptSkill`。
- **以上都不對？** `custom`。但先想兩次 — 多半「custom」其實是兩個 typed action 串起來。

---

## `actions` vs `handler`

`handler` 適合「一列一個效果」。如果那一列永遠只做一件事，又難用 typed action 表達（例如要動 `PaletteHandle.replace(...)` 推一個動態資料的 sub-menu），繼續用 `handler` 就好。

下面這幾種情況才換成 `actions`：

- 同一列有不只一種合理的 Enter 行為。
- 那個效果剛好是某個 typed kind — 免費拿到對的 icon + 對的行為。
- 想讓人發現所有可用動作（`Ctrl+K` 開 side-panel）。

兩個不互斥 — 但只要 `actions` 有設，typed kind 就會走 `runAction()`，`handler` 會被忽略。
