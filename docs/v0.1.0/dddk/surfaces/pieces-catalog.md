# Extending the Piece catalog

> Piece = 一種 UI 原語（HTML element 的概念，但策展過、CSS-variable 驅動）。dddk 內建 37 個 Piece；host 想加自家業務元件，註冊新 `PieceDefinition` 就行。

## 邊框配置原則 — 「Surface 才有邊框、piece 透明」

巢狀 Card 互相疊邊框是 dddk Pieces 最常被抱怨的視覺問題。處理方式：

- **`Card`** 有 background + radius + shadow — 一個視覺容器，當作「surface envelope」。
- **`Group`** 是 transparent 容器（flex column，無 border / shadow / bg）— 用來在 Card 內部分組相關 children，不會出現「card 中 card」的雙層邊框。
- **`MediaCard`** 是內容塊（image + text），自己也是 transparent 的；放進 `OptionGroup` 才有邊框（選中態），放進 `Card` 就純粹是文字布局。

慣例：**每個 Surface 最多一個 Card**。要再分組就用 `Group`，要凸顯選項用 `OptionGroup` / `ChoiceList`。

## 四個 rich layout piece（v0.1.0 新增）

針對「商品推薦 / 多選項 / 圖+文 + 鍵盤導航」這類場景：

### `Group` (layout)

純粹的 flex 容器，無邊框。用 `direction: 'vertical' | 'horizontal'` + `gap` + `align` 控制。要分組但不想堆邊框就用它。

### `MediaCard` (layout)

```ts
{
  kind: 'MediaCard',
  image: { src: '/img.jpg', alt: 'Hero', aspectRatio: '16/9' },
  title: 'Product name',
  description: 'Short pitch.',
  meta: ['USD$29', 'Free shipping'],
  orientation: 'top' | 'left',   // 預設 'top'
}
```

自己沒有邊框 / shadow — 看起來像個磁磚不是 Card。當作 `OptionGroup.options[]` 的 item shape，或單獨放在 `Card` 裡當 hero 區塊。

### `OptionGroup` (input)

```ts
{
  kind: 'OptionGroup',
  bind: 'pick',                     // selected value 寫到 data.pick
  layout: 'row' | 'column',
  columns: 3,                       // 'row' 模式幾欄（預設 = options 數量）
  options: [
    { value: 'p1', title: 'A', description: '...', image: { src: '...' } },
    { value: 'p2', title: 'B', description: '...', image: { src: '...' } },
    { value: 'p3', title: 'C', description: '...', image: { src: '...' } },
  ],
}
```

每個 option 是 MediaCard-shaped tile。**內建鍵盤導航**：
- `Row` 模式 → ←/→ 切換
- `Column` 模式 → ↑/↓ 切換
- `Enter` / `Space` 選定 → fires `ctx.trigger('choose', { value, index })`
- Click 也可以
- focus ring 給 keyboard user 看得到

用 ARIA `role="radiogroup"` / `role="radio"`，roving tabindex pattern（只有當前選項是 tab-able）。

### `ChoiceList` (input)

純文字版的 `OptionGroup` — 無圖、更密。Confirm-with-options / quick pick 場景用。

```ts
{
  kind: 'ChoiceList',
  bind: 'method',
  orientation: 'row' | 'column',
  options: [
    { value: 'card', label: 'Credit card', description: 'Visa, MC, Amex' },
    { value: 'paypal', label: 'PayPal' },
    { value: 'bank', label: 'Bank transfer', description: '3–5 business days' },
  ],
}
```

同樣鍵盤導航 + click + `trigger('choose', ...)`。

---



## 概念

```
Skill / Surface
  └─ PieceSurface { root: PieceNode, data }
       └─ PieceNode { kind, id?, bind?, ...props }
            ↓
       PieceRenderer  +  PieceCatalog
            ↓
         React tree
```

`kind` 是字串。`PieceCatalog` 把 `kind` 對應到 `PieceDefinition`（render function + 可選 schema/meta）。dddk 內建 catalog 涵蓋常用 SaaS 元件；host 用同一個 API 加自訂 piece。

## `PieceDefinition`

```ts
import type { PieceDefinition, PieceNode, PieceContext } from '@perhapxin/dddk';

interface PieceDefinition<P = Record<string, unknown>> {
  kind: string;
  render(props: P & PieceNode, ctx: PieceContext): ReactNode;
  propsSchema?: Record<string, unknown>;
  meta?: {
    category: 'layout' | 'content' | 'data' | 'input' | 'action' | 'feedback' | 'slot';
    description?: string;
  };
}
```

| 欄位 | |
| --- | --- |
| `kind` | 字串。重複會 warn + overwrite。 |
| `render` | `(props, ctx) => ReactNode`。`props` 就是 PieceNode 本身（含 `kind / id / bind` 與你自訂的欄位）。 |
| `propsSchema` | optional JSON Schema。當 LLM agent 從 envelope 產生 piece 時，schema 給它合約用。 |
| `meta.category` | 文件 / 工具用（palette preview、autodoc）。 |
| `meta.description` | 同上。 |

## `PieceContext`

render function 第二個參數：

```ts
interface PieceContext {
  data: Record<string, unknown>;                  // 目前資料模型
  setBinding(path: string, value: unknown): void; // 寫進去（觸發 React state）
  trigger(actionName: string, payload?: unknown): void;  // 發 named action → onAction
  render(node: PieceNode): ReactNode;             // 遞迴 render 子節點
}
```

`bind` 走 JSON Pointer（`'/customer/name'`）或單純 key（`'name'`）。讀值用 `resolveValue(node, ctx)`（dddk 出口的 helper），寫值用 `ctx.setBinding(node.bind!, newValue)`。

## 端到端範例：寫一個 `BadgeRow` piece

需求：一行多個 colored badge，每個可以帶 emoji + label，會發 `select` action 告訴 host 點到哪一個。

### 1. 定義 props 形狀

```ts
type BadgePropsItem = { value: string; label: string; emoji?: string; tone?: 'neutral' | 'positive' | 'warning' };

interface BadgeRowProps {
  kind: 'BadgeRow';
  items: BadgePropsItem[];
  /** Optional action name，預設 'select'。 */
  actionName?: string;
}
```

### 2. 寫 render function

```tsx
import type { PieceDefinition, PieceNode, PieceContext } from '@perhapxin/dddk';

const BadgeRow: PieceDefinition = {
  kind: 'BadgeRow',
  meta: { category: 'content', description: '一列 badge，可點' },
  render: (node, ctx) => {
    const items = (node.items as BadgePropsItem[]) ?? [];
    const actionName = (node.actionName as string) ?? 'select';
    return (
      <div data-dddk-piece="badge-row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {items.map((it) => (
          <button
            key={it.value}
            onClick={() => ctx.trigger(actionName, { value: it.value })}
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              background: toneBg(it.tone),
              color: toneFg(it.tone),
            }}
          >
            {it.emoji ? <span style={{ marginRight: 4 }}>{it.emoji}</span> : null}
            {it.label}
          </button>
        ))}
      </div>
    );
  },
};

function toneBg(t?: string) {
  if (t === 'positive') return 'var(--dddk-tone-positive-bg, #d6f5d6)';
  if (t === 'warning')  return 'var(--dddk-tone-warning-bg,  #fff1c2)';
  return 'var(--dddk-tone-neutral-bg, #ececec)';
}
function toneFg(t?: string) {
  if (t === 'positive') return 'var(--dddk-tone-positive-fg, #1f6f1f)';
  if (t === 'warning')  return 'var(--dddk-tone-warning-fg,  #6b5300)';
  return 'var(--dddk-tone-neutral-fg, #333)';
}
```

### 3. 註冊到 catalog

```ts
import { createBuiltinCatalog } from '@perhapxin/dddk';

const catalog = createBuiltinCatalog();   // 34 個 builtin
catalog.register(BadgeRow);               // 加上你的
```

### 4. 在 skill 用

```ts
const surface = {
  root: {
    kind: 'Stack',
    children: [
      { kind: 'Heading', text: '訂單狀態' },
      {
        kind: 'BadgeRow',
        items: [
          { value: 'pending',  label: '待付款', emoji: '⏳', tone: 'warning'  },
          { value: 'paid',     label: '已付款', emoji: '✓',  tone: 'positive' },
          { value: 'shipped',  label: '已出貨', emoji: '🚚', tone: 'neutral'  },
        ],
      },
    ],
  },
};

// host 渲染
<PieceRenderer
  surface={surface}
  catalog={catalog}
  onAction={(name, payload) => {
    if (name === 'select') console.log('使用者選了', payload);
  }}
/>;
```

## `PieceCatalog` API

```ts
class PieceCatalog {
  constructor(initial?: PieceDefinition[]);
  register(piece: PieceDefinition): void;
  get(kind: string): PieceDefinition | undefined;
  list(): PieceDefinition[];
  /** Merge：other 贏，蓋掉同名 builtin。 */
  extend(other: PieceCatalog | PieceDefinition[]): void;
}
```

兩種建構模式：

```ts
// A. 從空白開始
const catalog = new PieceCatalog([BadgeRow, MyChart, MyMap]);

// B. 從 builtin 開始
const catalog = createBuiltinCatalog();
catalog.register(BadgeRow);
catalog.extend([MyChart, MyMap]);
```

## 何時加到 catalog vs 用 Slot

dddk 內建一個 `Slot` piece — 直接吐 host 提供的 React component，不走 catalog 註冊：

```ts
{ kind: 'Slot', name: 'CustomerCard', props: { id: 42 } }
```

host 在 renderer config 帶一張 `slots: { CustomerCard: (props) => <CustomerCard {...props} /> }`。

| 用 catalog 註冊 | 用 Slot |
| --- | --- |
| 重複用 (≥ 3 處) | 一次性 |
| LLM agent 可能會自己 author 出來 | 純 host 自己 emit |
| 想 propsSchema 限制 props | props 隨便傳 |
| 想 meta.category 出現在 palette / docs | 不想曝光 |
| 跨 catalog 共用（base + 不同 product line override） | 只在這個 host |

Catalog 是「dddk world 的 element」，Slot 是「逃生口」。新建議：先用 Slot 開發，反覆用了再升級成 PieceDefinition。

## 覆寫 builtin

`register` 同名直接覆蓋（會在 console warn 一次）。如果想客製內建 `Button` 樣式：

```ts
catalog.register({
  ...builtinPieces.find((p) => p.kind === 'Button')!,
  render: (node, ctx) => <MyDesignSystemButton {...node} onClick={() => ctx.trigger(String(node.action))} />,
});
```

## 跨文件

- [Surface renderer](./renderer.md) — `PieceRenderer` 怎麼吃 `PieceSurface + PieceCatalog`。
- [Placements](./placements.md) — 把 renderer 的 root element 放到哪個 slot。
- [PanelSkill](../skills/panel-skill.md) — 在 panel 裡 render piece 的 host 接點。
