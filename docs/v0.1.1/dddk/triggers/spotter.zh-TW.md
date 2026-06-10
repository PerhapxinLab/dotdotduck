# Spotter

`Spotter` 是**主動指元素**的 picker。使用者移動滑鼠，dddk 把 hover 到的元素框起來，按一下 lock，或拖一個 region 來 lasso。Agent 就清楚知道使用者在說哪一個 DOM node。

`DotDotDuck` 內部會建一個 `Spotter`，但預設 `enableRing: false` — Spotter 在你 start 之前什麼都不會 render。

```ts
import { DotDotDuck } from '@perhapxin/dddk';

const dddk = new DotDotDuck({ /* ... */ });
dddk.mount();

// 開啟 hover ring（例如使用者按了「選一個元素」按鈕）：
dddk.spotter.start();

// 用完：
dddk.spotter.destroy();
```

---

## 三個狀態

| State    | 使用者看到的                          | 怎麼結束                                                |
| -------- | ----------------------------------- | ------------------------------------------------------ |
| `idle`   | 什麼都沒有。                        | —                                                      |
| `ring`   | hover 元素周圍會有粉紅色動畫框。     | 滑鼠移走（框消失）或按一下 lock。                       |
| `lock`   | 選定元素被框 pin 住。               | host 呼叫 `unlock()` 或使用者開始新動作。                |
| `lasso`  | 游標下面拖出一個虛線框。            | mouseup commit 那個 region；< 5px 取消。               |

狀態轉換：

```
idle ─(hover 200ms)→ ring ─(click)→ lock ─(unlock)→ idle
  └─(beginLasso)→ lasso ─(endLasso)→ idle
```

Ring 要 hover 200ms 才出現，免得使用者看哪段就閃哪段框。`ringDelay` 可調。

---

## Constructor：`SpotterOptions`

| field             | type                                          | 預設    | 做什麼                                                       |
| ----------------- | --------------------------------------------- | ------- | ----------------------------------------------------------- |
| `ringDelay`       | `number`                                      | `200`   | hover 要停多久（ms）ring 才出來。                            |
| `enableRing`      | `boolean`                                     | `true`  | hover-to-frame。`DotDotDuck` 預設覆寫成 `false`。           |
| `enableLasso`     | `boolean`                                     | `true`  | 拖框選 region。                                              |
| `ignoreSelector`  | `string`                                      | —       | 永遠不要框的 CSS selector。dddk 預設帶 `[data-dddk-ui]`，避免框到自己的 palette / subtitle。 |
| `onRingShow`      | `(info: { selector, element, rect }) => void` | —       | 換 ring 對象的時候 fire。                                   |
| `onRingHide`      | `() => void`                                  | —       | ring 消失的時候 fire。                                      |
| `onLock`          | `(info: { selector, element }) => void`       | —       | 使用者把當前 ring pin 成 lock 的時候 fire。                   |
| `onLassoComplete` | `(info: { elements, bounds }) => void`        | —       | lasso 鬆手且 region 有效時 fire。                           |

Orchestrator 上的 `dddk.spotter` 已經把四個 callback 都接成 dddk 事件（`pointer_ring_show`、`pointer_ring_hide`、`pointer_lock`、`pointer_lasso`），所以大多時候你只要 `dddk.on(...)`，不必自己 new。

---

## 直接 API

```ts
spotter.start();              // 接 mousemove
spotter.destroy();            // 拔 listener + 清 ring + 取消 lasso
spotter.getState();           // 'idle' | 'ring' | 'lock' | 'lasso'

spotter.lockCurrent();        // 把當下 ring 的東西 pin 起來；回
                              // { selector, element } 或 null

spotter.beginLasso(x, y);     // 從 hotkey 等地方主動起 lasso
spotter.updateLasso(x, y);    // 一般 mousemove 自動呼叫
spotter.endLasso(commit);     // commit:true 才 fire onLassoComplete

spotter.unlock();             // 放掉 lock，回 idle
```

`lockCurrent()` 通常會接在 `GestureManager.onVoiceStart` — hover + 長按就把當下元素 pin 給 agent。

---

## 接到 app 裡的範例

### 場景 A — 「選一個元素」mode

使用者按 toolbar 按鈕 → ring 開 → 點一個元素 → 拿到 selector 做事：

```ts
import type { SpotterOptions } from '@perhapxin/dddk';

function startElementPick() {
  dddk.spotter.start();
  const off = dddk.on('pointer_lock', ({ selector }) => {
    off();
    dddk.spotter.destroy();
    dddk.startAgent(`告訴我這個元素是做什麼的。`, {
      selection: { element: selector },
    });
  });
}
```

### 場景 B — Lasso 一個 region 給 agent

```ts
function startLasso() {
  dddk.spotter.start();
  // 自訂 hotkey 從游標起 lasso（自己抓 cursor 位置）。
  document.addEventListener('mousedown', (e) => {
    if (!e.shiftKey) return;
    dddk.spotter.beginLasso(e.pageX, e.pageY);
    const upOnce = (ev: MouseEvent) => {
      dddk.spotter.endLasso(true);
      document.removeEventListener('mouseup', upOnce);
    };
    document.addEventListener('mouseup', upOnce);
  });

  dddk.on('pointer_lasso', ({ elements, bounds }) => {
    const selectors = elements.map((el) => el.tagName.toLowerCase()).join(', ');
    dddk.startAgent(`使用者圈了這塊區域：${selectors}（${bounds.width}×${bounds.height}）。`);
  });
}
```

`pointer_lasso` 帶的是完全被包住的 `HTMLElement` 陣列跟那個 `DOMRect`。實作目前是 O(n) 掃全 DOM — 主動的 gesture 沒問題，不要每秒 fire 60 次。

---

## Spotter 跟 Dwell 怎麼選

兩個都讓使用者「指某個元素」，差在 gesture：

| Surface | 觸發              | 適合場景                                                                   |
| ------- | ----------------- | -------------------------------------------------------------------------- |
| Dwell   | 長按那個元素       | 手機 + 桌面。使用者直接按住*那個元素本身*，沒有切換模式的概念。看 [Dwell](../modules/dwell.md)。 |
| Spotter | hover ring + 點擊 | power user 的 pick 流程，使用者要明確進入「我要指東西」mode（toolbar 按鈕、`/inspect` skill）。 |

判斷：gesture 是**順手**做的（使用者在看東西，看到了就長按），用 Dwell。Gesture 是**使用者切到的 mode**（「幫我選一個元素」），用 Spotter。

兩個共存可以 — Dwell 吃長按、Spotter 吃 hover+click — 但兩個一起開的話最好有文件說明，不然使用者會搞混為什麼兩個類似手勢的行為微妙地不一樣。

---

## 什麼時候**不要**用 Spotter

- **選取文字** — 直接用 `window.getSelection()`。Palette 開的時候 chip-bar 會自動讀。
- **確認 agent 一個 step** — 那是 [gestures](./gestures.md) 的 `onAccept`。
- **長按 pin** — 用 [Dwell](../modules/dwell.md)。Spotter 的 ring 是「滑鼠停下我幫你框」，不是長按 pin。
- **hover tooltip** — 用 HTML `title` 或自己 tooltip lib。Spotter 重，而且帶 app 級別的狀態。
