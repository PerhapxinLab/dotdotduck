# Triggers 總覽

**Trigger** 就是把用戶的某個動作翻成 dddk intent 的那一層 — 開 palette、抓 selection、長按錄音、指向某個 DOM 元素。Trigger 是入口；後面的 skills、surfaces、webagent 全都因為某個 trigger 觸發才跑起來。

`@perhapxin/dddk` 裡面總共四種 trigger surface：

| Trigger          | 模組                | 適合做什麼                                                                |
| ---------------- | ------------------ | ----------------------------------------------------------------------- |
| Command palette  | `CommandPalette`   | 可被搜尋的指令清單、prefix routing、附圖、AI fallback。                  |
| Space gestures   | `GestureManager`   | 單擊 → accept · 雙擊 → reject · 長按 → voice · Tab → 下一行 · Ctrl+K → palette。 |
| Spotter          | `Spotter`          | 主動「點 DOM 元素」的流程 — hover 出 ring、按一下 lock、拖一下圈一個 region。 |
| Panel runtime    | `PanelRuntime`     | 頁內常駐側欄，承載 skill / surface / chat 之類的長壽 UI。              |

多數 host 只會直接動 palette，其他三個都是 `DotDotDuck` 內部幫你 new 好。你透過 config（`gestureKey`、`camera`、`webAgent` ...）配置它們，不用自己 `new`。

```ts
import { DotDotDuck } from '@perhapxin/dddk';

const dddk = new DotDotDuck({
  // palette items, skills, camera, tools, ...
});
dddk.mount();

// 真的要直接拿也行：
dddk.palette.addItem({ ... });
dddk.spotter.start();   // 預設 opt-in：ring / lasso 預設關
```

---

## 每篇文件講什麼

- [palette](./palette.md) — 註冊 palette 項目：prefix routing、sub-menu、`searchOnly`、browse mode、agent-tool opt-in。
- [palette-actions](./palette-actions.md) — typed `PaletteAction` union（`copy` / `insert` / `navigate` / `open_url` / `agent_task` / `render_surface` / `run_skill` / `custom`）跟 `runAction()`。
- [palette-attachments](./palette-attachments.md) — 相機 icon（upload / screenshot）、`PaletteAttachment`、圖片怎麼進到 `palette.context.attachments` 再串到 agent 的 `selection.images`。
- [gestures](./gestures.md) — single / double / long-hold space、Ctrl+K、Tab、Escape；`holdThresholdMs` 跟 `shouldIntercept`。
- [spotter](./spotter.md) — ring / lock / lasso，主動指元素的場景；Spotter 跟 [Dwell](../modules/dwell.md) 怎麼選。

---

## 彼此關係

```
                ┌──────────────────────────────────────────┐
                │              DotDotDuck (host)           │
                │  palette · spotter · gestures · skills   │
                └──────────────────────────────────────────┘
                       ▲              ▲              ▲
                       │              │              │
   用戶打              │              │              │  用戶長按
   ⌘K + 一段字        │              │              │  space ≥200ms
                       │              │              │
              ┌────────┴───┐   ┌──────┴────┐   ┌─────┴──────┐
              │   palette  │   │  spotter  │   │  gestures  │
              │   row /    │   │  ring /   │   │  accept /  │
              │   action   │   │  lasso    │   │  voice /   │
              └────────────┘   └───────────┘   └────────────┘
                       │              │              │
                       └──────────────┴──────────────┘
                                      ▼
                               intent / agent task
```

Palette 是**明示**的 trigger（用戶自己打字進去）。Gestures 是**環境**的 trigger（用戶在回應 dddk 剛剛跳出來的東西）。Spotter 是**指示**的 — 用戶在指頁面上的某塊，agent 需要知道是哪一塊。

三個下游都共用同一條 pipeline：一個 `PaletteAction`、一個 skill dispatch、或一個 `webagent` task。中間那層轉接看 [palette actions](./palette-actions.md)。

---

## 怎麼選

- 用戶清楚要什麼 — palette + 註冊好的 item，最快、最可預測。
- 用戶想**用自己的話問** — palette + 一個 `fallback` row 把 query 丟給 agent。
- 用戶在回應 dddk 剛跳的字幕 / prompt — space gestures（沒按鈕可點）。
- 用戶要**指**頁面上某塊給 agent 看 — Spotter（主動指）或 [Dwell](../modules/dwell.md)（直接長按那個元素）。
- 用戶要附圖 — palette 的相機按鈕（看 [attachments](./palette-attachments.md)）。

不要自己發明新的 trigger；上面這幾種大概涵蓋了所有互動需求。如果你發現自己想加一個全域 keybinding，先想想是不是該做成一個有 `shortcut` 提示的 palette item — palette item 找得到，keybinding 找不到。

---

## Export 列表

只有 `@perhapxin/dddk` 上面有的才算 public，不確定就看 `src/index.ts`。Trigger 相關 export：

```ts
import {
  // palette
  CommandPalette, listPrefixMatches, displayPrefix,
  // gestures
  GestureManager,
  // spotter
  Spotter,
  // panel runtime
  PanelRuntime,
  // typed actions
  runAction, defaultIconFor,
} from '@perhapxin/dddk';

import type {
  PaletteItem, PaletteHandle, PaletteContext, PaletteAttachment,
  CameraOptions, CommandPaletteOptions,
  GestureCallbacks, GestureManagerOptions,
  SpotterOptions, SpotterState,
  PaletteAction, CopyAction, InsertAction, OpenUrlAction,
  NavigateAction, AgentTaskAction, RenderSurfaceAction,
  RunSkillAction, CustomAction, ActionRunContext,
} from '@perhapxin/dddk';
```
