# Surface — render 結構化 UI

**Surface** 是 dotdotduck 對 SDK 吐出的任何結構化 UI 的統稱 — 設定表單、確認框、agent 自己組出來的 panel 都算。內部這些是 `PieceSurface` 物件（一棵有型別的 UI primitive tree，加一個可選的 data model）；外部也可以以 flat surface envelope 的形式進來，由 webagent 或其他來源發出。

這篇講：

- 資料格式
- host 怎麼 render 一個 surface
- 三種 placement（`center` / `inline` / `dock`）
- `SurfaceSkill` 怎麼接上 palette
- 擴 catalog cookbook（精簡版）
- 用 surface envelope bridge
- 主題化

---

## 資料格式

```ts
import type { PieceSurface, PieceNode } from '@perhapxin/dddk';

const surface: PieceSurface = {
  root: {
    kind: 'Card',
    children: [
      { kind: 'Heading', text: 'Refund this order?' },
      { kind: 'Text',    text: 'Order ORD-1002 — $990 — Bob Lin' },
      {
        kind: 'Row',
        children: [
          { kind: 'Button', text: 'Refund',  action: 'submit' },
          { kind: 'Button', text: 'Cancel',  action: 'cancel' },
        ],
      },
    ],
  },
  data: { /* optional initial data model for `bind:` fields */ },
};
```

每個 `PieceNode` 有：

- `kind` — 會去 `PieceCatalog` 查表
- `id` — optional，給 by-id 局部更新用
- `bind` — optional，給 input 用的 JSON Pointer，指向 `data`
- 其他 kind 專屬的 props（`text`、`children`、`action`、…）

內建 catalog 涵蓋：`Heading`、`Text`、`Markdown`、`Code`、`Image`、`Metric`、`Tag`、`Divider`、`Card`、`Stack`、`Row`、`Grid`、`Split`、`Tabs`、`Listing`、`Slot`。Host 可以擴 catalog 加自訂 widget — 見下方 [Extending the catalog](#extending-the-catalog-cookbook)。

---

## 在 host 內 render 一個 surface

只要 skill 或 webagent 產生 surface，dotdotduck 就會 emit `surface` event。render 由 host 負責：

```tsx
import { useEffect, useState } from 'react';
import { PieceRenderer, createBuiltinCatalog, type PieceSurface } from '@perhapxin/dddk';

const catalog = createBuiltinCatalog();

function App({ dotdotduck }) {
  const [active, setActive] = useState<{ surface: PieceSurface; placement: string } | null>(null);

  useEffect(() => {
    const handler = (payload: { surface: unknown; placement: string }) =>
      setActive({ surface: payload.surface as PieceSurface, placement: payload.placement });
    dotdotduck.on('surface', handler);
    return () => dotdotduck.off('surface', handler);
  }, [dotdotduck]);

  if (!active) return null;
  return (
    <SurfaceShell placement={active.placement} onDismiss={() => setActive(null)}>
      <PieceRenderer
        surface={active.surface}
        catalog={catalog}
        onAction={(action, data) => {
          // submit / cancel / your custom action names
          if (action === 'cancel') setActive(null);
        }}
      />
    </SurfaceShell>
  );
}
```

`SurfaceShell` 是你自己的 — 可以是 modal wrapper、固定 dock、inline 細條。dotdotduck 三種 placement 的重點就是：*host* 決定每一個要落在哪；SDK 只把 tree 交給你。

---

## Placement

orchestrator 會 emit `placement: 'center' | 'inline' | 'dock'`，讓 host 不用改 catalog 就能在三種模式間切：

| Placement | 用途                                                 | 會搶 focus？ |
| --------- | --------------------------------------------------- | ------------- |
| `center`  | 完整 form / 確認 modal                                | 會 — 有 backdrop，點外面取消 |
| `inline`  | 字幕條上方的短確認條                                   | 不會 — 使用者可以繼續看頁面 |
| `dock`    | 常駐側邊 panel（進度追蹤、任務清單）                    | 不會 — 使用者工作時一直在 |

dotdotduck 的 preferences 設定表單（當 `SurfaceSkill` 宣告 `required: true` 的 pref 還沒填時會自動 render）預設用 `center`。host 在叫 renderer 時可以傳不同的 `placement`。

---

## SurfaceSkill — 由 palette 觸發的 surface

```ts
import type { SurfaceSkill } from '@perhapxin/dddk';

const orderStatus: SurfaceSkill = {
  id: 'order-status',
  name: 'Order status',
  description: 'Look up an order',
  type: 'surface',

  async build(ctx) {
    return {
      root: {
        kind: 'Stack',
        children: [
          { kind: 'Heading', text: 'Order status' },
          { kind: 'TextInput', id: 'orderId', bind: '/orderId', placeholder: 'ORD-1002' },
          { kind: 'Button',    text: 'Look up', action: 'submit' },
        ],
      },
      data: { orderId: '' },
    };
  },

  async onSubmit(data, ctx) {
    const order = await fetch(`/api/orders/${data.orderId}`).then((r) => r.json());
    // Return another surface for a multi-step flow, or `undefined` to close.
    return {
      root: {
        kind: 'Card',
        children: [
          { kind: 'Heading', text: `${order.id} — $${order.total}` },
          { kind: 'Text',    text: `Customer: ${order.customer}` },
        ],
      },
    };
  },
};
```

生命週期：

1. 使用者在 palette 打 `/order-status` 按 Enter
2. dotdotduck 呼叫 `skill.build(ctx)` → 拿到一個 `PieceSurface`
3. dotdotduck emit `surface` event，placement 是 `center`
4. host 用 `PieceRenderer` render（見上）
5. 使用者填表，按下 `submit`-action 的按鈕
6. host 呼叫 `skill.onSubmit(formData, ctx)`
7. 回傳值：再一個 surface（多步），或 `undefined`（關掉）

---

## <a id="extending-the-catalog-cookbook"></a>擴 catalog — cookbook

> 這是精簡的「最少能 grok 概念」版。完整深入版 — `PieceCatalog` class、`PieceContext`、`propsSchema`、覆寫 builtin、Slot vs. catalog 的取捨 — 見 [pieces-catalog](./pieces-catalog.md)。

Catalog 就是一張用字串當 key 的對照表：節點裡的 `kind: 'EmployeeCard'` 會被解到 `PieceDefinition.render(props, ctx)`。加一個自己的 piece 就三步。

### 1. 定義 piece props 的 TS 形狀

```ts
import type { PieceNode } from '@perhapxin/dddk';

interface EmployeeCardProps extends PieceNode {
  kind: 'EmployeeCard';
  name: string;
  title: string;
  avatarUrl?: string;
}
```

純 interface，沒有 runtime 成本。dddk 故意把 node bag 型別放鬆，這樣 host 不用重新產 type 就能擴。

### 2. 寫 render function

```tsx
import type { PieceDefinition } from '@perhapxin/dddk';

const EmployeeCard: PieceDefinition = {
  kind: 'EmployeeCard',
  meta: { category: 'content', description: 'Employee summary card' },
  render: (node, ctx) => {
    const p = node as EmployeeCardProps;
    return (
      <div data-dddk-piece="employee-card" className="emp-card">
        {p.avatarUrl && <img src={p.avatarUrl} alt="" />}
        <strong>{p.name}</strong>
        <span>{p.title}</span>
      </div>
    );
  },
};
```

兩個參數：`node`（`PieceNode` 本身 — kind、id、你的自訂 props）跟 `ctx`（`{ data, setBinding, trigger, render }`）。要遞迴 render 子節點，呼叫 `ctx.render(childNode)`。要 fire 一個會被 `PieceRenderer` 的 `onAction` 接到的 action，呼叫 `ctx.trigger('actionName', payload)`。要讀寫綁了 `bind` 的 data 路徑，用 `ctx.setBinding`。

### 3. 註冊到 catalog

```ts
import { createBuiltinCatalog, PieceRenderer } from '@perhapxin/dddk';

const catalog = createBuiltinCatalog();   // 34 個 builtin
catalog.register(EmployeeCard);

// 同一個 catalog 傳給每一個 PieceRenderer：
<PieceRenderer surface={surface} catalog={catalog} onAction={handleAction} />
```

自訂 piece 跟 builtin 並存 — 同一個 renderer 兩種都吃。任何 surface（skill 吐的、agent 寫的、host 手刻的）用到 `kind: 'EmployeeCard'` 都會 resolve 到你的 render function。

整個流程就這樣。需要更細的控制 — 覆寫 `Button`、宣告 JSON Schema 給 LLM agent author、選 catalog-register vs `Slot` 逃生口 — 打開 [pieces-catalog](./pieces-catalog.md)。

---

## 用 surface envelope bridge

**Surface envelope** 是 flat 的 wire format，用在 surface 要跨 process 邊界的時候（例如 webagent 在 worker 裡跑，把 UI 描述 post 回 host）。它是一個 id-keyed 的 component 列表，加一個 data model。我們的 `PieceSurface` 則是 renderer 想吃的巢狀 tree。Bridge 就是兩者之間的轉換。

dddk 在 [`pieces/surface-bridge.ts`](../../../dddk/src/pieces/surface-bridge.ts) 提供兩個 helper：

```ts
import { envelopeToSurface, surfaceToEnvelope } from '@perhapxin/dddk';
```

### Use case：agent 從 worker post envelope，host 接住 render

```ts
// Worker 端 — agent 寫好了 UI 要給使用者看
self.postMessage({
  type: 'render-surface',
  envelope: {
    version: 'v0.10',
    updateComponents: {
      surfaceId: 'agent-result',
      components: [
        { id: 'root', component: 'Card', children: ['heading', 'body'] },
        { id: 'heading', component: 'Heading', text: 'Found 3 matches' },
        { id: 'body',    component: 'Listing', items: [/* … */] },
      ],
    },
    updateDataModel: {
      surfaceId: 'agent-result',
      data: { /* … */ },
    },
  },
});
```

```tsx
// Host 端 — 收、轉、render
import { envelopeToSurface, PieceRenderer, createBuiltinCatalog } from '@perhapxin/dddk';

const catalog = createBuiltinCatalog();

worker.onmessage = (e) => {
  if (e.data.type !== 'render-surface') return;
  const surface = envelopeToSurface(e.data.envelope);
  if (!surface) return;          // 空的 / 壞的 envelope
  setActive(surface);            // 丟給你的 renderer state
};

// PieceRenderer 跟之前一樣呼叫 — bridge 給你的就是普通的 PieceSurface
<PieceRenderer surface={active} catalog={catalog} onAction={handleAction} />;
```

`envelopeToSurface` 做粗活：

- 拿 `id: 'root'` 那個 component 當 tree 根，沒有的話 fallback 到第一個 component。
- 把 `children: string[]`（id list）解成巢狀 `PieceNode` 物件。
- Cycle 保護：envelope 裡 A 列 B 是子，B 又列 A 回來，descent 會停下不會 stack overflow。

如果 envelope 沒 components，回 `null`。

### 反方向 — host 把 surface 還回 agent

當 host 手寫好 surface 要 cross-process 送出去（要 log、要在測試裡 replay、要交給跑 wire format 的 server-side agent），用 `surfaceToEnvelope`：

```ts
import { surfaceToEnvelope } from '@perhapxin/dddk';

const envelope = surfaceToEnvelope(surface, 'order-status');
// envelope 就是 flat 格式 — JSON-safe、postMessage-safe、fetch-body-safe
worker.postMessage({ type: 'surface-snapshot', envelope });
```

第二個參數是要蓋進 envelope 的 `surfaceId`（預設 `'default'`）。Node 本來就有 `id` 的會保留；沒有的拿 `auto_1`、`auto_2`、…，這樣 children-by-id 的 reference 才會 resolve 對。

### 什麼時候**不**需要 bridge

如果一切都在 dddk 內部 — skill emit `PieceSurface`、host 用 `PieceRenderer` render、使用者按 button、host 呼叫 `skill.onSubmit(data)` — 你完全不用碰 envelope 格式。Bridge 是給 boundary 用的；boundary 之內，直接用 tree。

---

## 主題化

Renderer 用 dotdotduck 的 design token。host 在某個父元素（通常是 `:root`）上用一般 CSS 變數設主題：

```css
:root {
  --dddk-bg-elevated: #fff;
  --dddk-text:        #111;
  --dddk-radius:      10px;
  --dddk-accent:      #6366f1;
}
```

完整 token 清單在 [theming](../theming.md)。
