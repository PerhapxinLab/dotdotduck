# Overlay helpers

> Agent 只有 `border` 一個 overlay tool 可用 — 但**整套 overlay 工具**都從 `@perhapxin/dddk` export 出來，host 可以直接呼叫。做 onboarding tour、debug selector、從自己的 UI 層 render highlight、或者把 agent 包進自訂 UX shell。dddk 的 orchestrator 在 agent done / error 時就是用 `clearOverlays()`。

## Export 了什麼

```ts
import {
  border,
  highlight,
  spotlight,
  inject,
  removeOverlay,
  clearOverlays,
  listOverlays,
} from '@perhapxin/dddk';
```

五個 **create** 函式都回 overlay id（string）。所有 overlay DOM node 都帶 `data-webagent-overlay="<type>"` 和 `data-overlay-id="<id>"`，方便查。

| Helper | Type tag | 回傳 | 備註 |
|---|---|---|---|
| `border(selector, color?, label?)` | `border` | `id` 或 `''`（selector miss 時） | 目前**唯一**開放給 agent 用的 overlay 工具。 |
| `highlight(selector, color?, label?)` | `highlight` | `id` 或 `''` | 預設黃色底色，label 會浮在上方。 |
| `spotlight(selector)` | `spotlight` | `id` 或 `''` | 用 9999px box-shadow 把其他地方都壓暗。 |
| `inject(selector, text, position?)` | `inject` | `id` 或 `''` | 在目標前/後插入有 style 的文字節點（不是矩形 overlay）。 |
| `removeOverlay(id)` | — | `void` | 移除對應 overlay **加上** 它的 label sibling（`{id}_label`）。 |
| `clearOverlays()` | — | `void` | 移除所有 `[data-webagent-overlay]` 元素。 |
| `listOverlays()` | — | `OverlayItem[]` | 目前 mount 的 overlay snapshot。 |

回空字串代表 selector 沒抓到任何東西。函式不 throw — DOM 還沒長好時 selector 失敗是預期會發生的。

## Host 為什麼要直接呼叫

Agent 自己的視角是「我呼了 `border()`，user 看到一個框」。Host 有其他理由：

- **Onboarding tour** — `border()` + `spotlight()` 配你的 tour state machine，整個過程沒有 agent。
- **Selector debugging** — 在 devtools 的 input 貼 CSS selector，呼 `border()` 直接看會 match 到什麼。
- **自訂 agent shell** — 你 render 自己的 subtitle / sidebar UI，想 highlight 目前 agent 正在處理的元素，不想透過 `agent.executeAction('border', ...)`。
- **Migration** — `listOverlays()` 讓你 snapshot、切換 UI 模式、再 restore。
- **Lifecycle cleanup** — route 切換、agent done、agent error 時呼 `clearOverlays()`。

## `border(selector, color?, label?)`

Agent 預設的 overlay。在目標周圍畫 2px 實線框，可選一個小 label 浮在上方：

```ts
const id = border('#submit-button', '#10b981', 'Click here');
// 之後
removeOverlay(id);
```

預設：`color = #ff9800`，沒 label。Color 接受任何 CSS color 字串（hex、rgb、named）。

Label 是獨立 DOM node，id 是 `{id}_label` — `removeOverlay(id)` 用 prefix match 兩個一起清掉。

## `highlight(selector, color?, label?)`

跟 `border` 同樣的呼叫形狀，但是塗一塊半透明黃色底色，不是畫框。預設 `rgba(255, 235, 59, 0.4)`。

```ts
highlight('.error', 'rgba(239,68,68,0.3)', 'Validation failed');
```

「這列重要」但又不想遮住內容時很好用。

## `spotlight(selector)`

把目標用 9999px box-shadow 圈住、其他地方全部壓暗。沒 label、沒 color 參數 — 故意這樣設計，spotlight 是最強的視覺宣告，在執行中途不該被自訂。

```ts
const id = spotlight('#onboarding-step-2');
// 換下一步
removeOverlay(id);
spotlight('#onboarding-step-3');
```

## `inject(selector, text, position?)`

不是矩形 overlay — 是實際在目標前後插入一個文字節點。有黃色底色 + 橘色左邊框，明顯凸出來：

```ts
inject('input[name="email"]', '請用公司 email', 'after');
inject('h1', '先讀這個 ↓', 'before');
```

`position` 預設 `'after'`。Agent（或 tour）想留個 inline hint 在頁面上時很好用。

## `removeOverlay(id)`

移除 `data-overlay-id` 是**以該 id 開頭**的所有 overlay。這個 prefix match 就是為了一次清掉 label sibling（`{id}_label`）：

```ts
const id = border('#cta', '#10b981', 'Click here');
removeOverlay(id);  // border 跟 label 一起清
```

Id 沒對到就 no-op。

## `clearOverlays()`

最暴力的：移除頁面上所有 `[data-webagent-overlay]` 元素。這就是 dddk orchestrator 在 agent done / error 時呼的，避免半成品 tour 殘留：

```ts
agent.on('done',  () => clearOverlays());
agent.on('error', () => clearOverlays());
```

它只動 webagent overlay — 你 app 自己 absolutely-positioned 的元素不會受影響（它們沒有 `data-webagent-overlay` attribute）。

## `listOverlays()`

回傳目前的集合，形狀是 `OverlayItem[]`：

```ts
interface OverlayItem {
  id: string;
  type: 'border' | 'highlight' | 'spotlight' | 'inject' | 'label';
  selector: string;
  label?: string;
  text?: string;
  position?: 'before' | 'after';
}
```

Debugging（「現在畫面上到底有什麼？」）或 migration（snapshot、換 UI、restore）時很好用。Label node 會以 `type: 'label'` 的獨立 entry 出現。

```ts
console.table(listOverlays());
```

## Resize / scroll 時要重算位置

這些 helper 在 create 時用 `getBoundingClientRect()` 算好位置，**不會**自動更新。如果你的 layout 會 reflow（resize、accordion 打開、virtualized list 滾動），呼 `clearOverlays()` 然後從你的 source-of-truth 重新建立，或者自己包一層 ResizeObserver 把位置重套上去。

故意不做自動 reposition — 大部分 agent flow 都短到 snapshot-at-create-time 就夠用，這也是同時 fit agent + host 兩種使用情境的最小 contract。

## CSS 變數客製化

注入的 stylesheet（`#webagent-overlay-style`）會讀以下 CSS 變數，你可以覆蓋：

| Variable | 預設 | 影響 |
|---|---|---|
| `--webagent-highlight` | `rgba(255, 235, 59, 0.4)` | `highlight` 底色 |
| `--webagent-border` | `#ff9800` | `border` 顏色 |
| `--webagent-label-bg` | `#1a1a1a` | label 底色 |
| `--webagent-inject-bg` | `rgba(255,235,59,0.6)` | `inject` 底色 |
| `--webagent-accent` | `#ff9800` | `inject` 左邊框 |

```css
:root {
  --webagent-border: #10b981;
  --webagent-highlight: rgba(16, 185, 129, 0.2);
}
```

`border` / `highlight` 的 `color` 參數會壓過 CSS 變數 — 變數是預設主題，per-call color 是 override。

## See also

- [Actions catalog](./catalog.md) — 哪些被接到 agent tool（`border` 在內，其他預設只給 host 用）。
- [Public API](../api.md) — `agent.executeAction(name, params)` 讓 host 用名字直接觸發 action。
