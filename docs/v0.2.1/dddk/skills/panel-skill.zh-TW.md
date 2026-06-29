# PanelSkill — 上輸入下面板的 runtime

> `PanelSkill` 是四種 skill 中唯一有「自己的 runtime」的那一種。它在 palette 之外開出一個獨立的兩段式 overlay（上面 input、下面 panel），navigation stack 讓使用者一邊打字一邊探索多層內容。

## 何時用 PanelSkill

| Skill 種類 | 何時 |
| --- | --- |
| `script` | 一連串步驟、走完就結束 |
| `prompt` | 把 user input 套到 system prompt 給 agent |
| `action` | 一次性 handler，沒有持續 UI |
| `surface` | 一次性表單，submit 一次就關掉 |
| **`panel`** | **持續互動：使用者邊打字邊看結果（search、chat、recommend、瀏覽）** |

PanelSkill 的特徵：
- input 一直在上面，使用者隨時可以改字。
- 每次輸入改變都會呼叫 `onInput(text, ctx)`（debounce 預設 200ms）。
- 可以 push 子層 panel，breadcrumb 會自動顯示，Esc / Backspace（空字串時）pop 一層。
- 不會自己消失，使用者要主動關（×、Esc 到底、點 backdrop）。

## Skill 形狀

```ts
import type { PanelSkill } from '@perhapxin/dddk';

interface PanelSkill extends BaseSkill {
  type: 'panel';
  inputMode: 'palette' | 'takeover';
  inputPlaceholder?: string;
  onEnter?: (ctx: PanelSkillContext) => Promise<unknown> | unknown;
  onInput:  (text: string, ctx: PanelSkillContext) => Promise<unknown> | unknown;
  onSubmit?: (text: string, ctx: PanelSkillContext) => Promise<unknown> | unknown;
  onAction?: (action: string, data: unknown, ctx: PanelSkillContext) => Promise<unknown> | unknown;
  onLeave?: () => Promise<void> | void;
}
```

| 欄位 | 用途 |
| --- | --- |
| `inputMode: 'palette'` | 保留 `/command` 解析與 ask-AI fallback；自由文字才走 `onInput`。適合 search / qa / classify。 |
| `inputMode: 'takeover'` | input 全部交給 `onInput`，不解析 slash 命令。適合 chat / 連續 webagent。 |
| `inputPlaceholder` | 進入時 input 的 placeholder 文字。 |
| `onEnter` | 進入時跑一次（input 還空白）。通常拿來 `ctx.render(...)` 預設畫面。 |
| `onInput` | 每次輸入改變（debounced）。 |
| `onSubmit` | 使用者按 Enter。多數 live panel 用 `onInput` 就夠，這個可以不填。 |
| `onAction` | panel 內 Piece 按鈕 / 行 click 觸發的 named action。 |
| `onLeave` | 從 stack 被 pop 時。做清理（取消請求、解綁 listener）。 |

## PanelSkillContext

```ts
interface PanelSkillContext extends ActionSkillContext {
  render(surface: unknown): void;        // 把 PieceSurface 畫到 panel
  back(): void;                          // pop 本層
  setPlaceholder(text: string): void;    // 動態改 input placeholder
}
```

繼承 `ActionSkillContext` 的 `palette / subtitle / storage / getPreferences / llm / agent / navigate`，再加三個 panel 專屬方法。

## 端到端範例：兩層 browse（清單 → 詳情）

```ts
import type { PanelSkill } from '@perhapxin/dddk';

const ordersBrowse: PanelSkill = {
  id: 'orders',
  type: 'panel',
  name: '訂單',
  inputMode: 'palette',
  inputPlaceholder: '輸入訂單編號或客戶名稱…',

  onEnter: async (ctx) => {
    // 進來先列最近 10 筆
    const recent = await fetch('/api/orders?limit=10').then((r) => r.json());
    ctx.render(listSurface(recent));
  },

  onInput: async (text, ctx) => {
    if (!text) {
      const recent = await fetch('/api/orders?limit=10').then((r) => r.json());
      ctx.render(listSurface(recent));
      return;
    }
    const hits = await fetch(`/api/orders?q=${encodeURIComponent(text)}`).then((r) => r.json());
    ctx.render(listSurface(hits));
  },

  onAction: async (action, data, ctx) => {
    if (action === 'open_order') {
      const id = (data as { id: string }).id;
      const order = await fetch(`/api/orders/${id}`).then((r) => r.json());
      void runtime.enter(orderDetailPanel(order));
    }
  },
};

function listSurface(orders: Array<{ id: string; customer: string; total: number }>) {
  return {
    root: {
      kind: 'Stack',
      children: orders.map((o) => ({
        kind: 'Card',
        children: [
          { kind: 'Heading', text: `${o.id} — ${o.customer}` },
          { kind: 'Text',    text: `$${o.total}` },
          { kind: 'Button',  text: '查看', action: 'open_order', data: { id: o.id } },
        ],
      })),
    },
  };
}
```

第二層子 panel 用同一個 PanelSkill 結構，只是 `onEnter` 直接畫詳情，`onInput` 可以是「在這筆訂單裡搜尋商品」：

```ts
function orderDetailPanel(order: Order): PanelSkill {
  return {
    id: `order:${order.id}`,
    type: 'panel',
    name: order.id,
    hidden: true,                // 不要出現在 palette 列表
    inputMode: 'palette',
    inputPlaceholder: '搜尋這筆訂單的商品…',
    onEnter: (ctx) => ctx.render(detailSurface(order)),
    onInput: (q, ctx) => ctx.render(detailSurface(order, q)),
    onAction: (action, data, ctx) => {
      if (action === 'refund') ctx.agent?.(`refund order ${order.id}`);
    },
  };
}
```

按 Esc 或在空 input 按 Backspace 會 pop 回清單；breadcrumb 顯示「← orders › ORD-12345」。

## Lifecycle

```
host 呼叫 runtime.enter(skill)
  └─ overlay mount（如果是第一層）
  └─ stack.push(frame)
  └─ skill.onEnter(ctx)            ← 一次

使用者打字
  └─ debounce 200ms
  └─ skill.onInput(text, ctx)      ← 每次

使用者點 Piece 的 Button[action]
  └─ skill.onAction(action, data, ctx)

使用者按 Enter
  └─ skill.onSubmit?(text, ctx)

使用者按 Esc / Backspace-on-empty / 點 breadcrumb
  └─ skill.onLeave?()
  └─ stack.pop()
  └─ overlay unmount（如果 stack 空了）
```

## 跟 ScriptSkill / PromptSkill 的差別

| | ScriptSkill | PromptSkill | PanelSkill |
| --- | --- | --- | --- |
| 持續 UI | 每步 subtitle | 沒有 | 有，自己的 overlay |
| 使用者 input | step 之間 `ask()` | 一次性（變數展開） | 持續打字 |
| Navigation stack | 沒有 | 沒有 | 有 |
| 適合 | 教學 / 導覽 | 同樣任務反覆做 | 探索式互動 |

## Runtime：`PanelRuntime`

PanelSkill 不會「自己跑」 — host 要建一個 `PanelRuntime` 並把 skill 推進去：

```ts
import { PanelRuntime } from '@perhapxin/dddk';

const runtime = new PanelRuntime({
  host: {
    llm: (prompt) => myLLM.complete(prompt),
    navigate: (path) => router.push(path),
    renderPiece: (container, surface, onAction) => {
      mountReact(container, <PieceRenderer surface={surface} catalog={catalog} onAction={onAction} />);
    },
  },
});

// 從某個入口（palette item、外部 button、其他 skill）push 一個 panel
await runtime.enter(ordersBrowse);
```

| API | |
| --- | --- |
| `runtime.enter(skill)` | push 並 mount |
| `runtime.back()` | pop 頂層 |
| `runtime.close()` | 全部 pop、unmount |
| `runtime.isOpen()` | overlay 是否在畫面上 |
| `runtime.stackDepth()` | stack 層數 |

`renderPiece` 是 optional。沒給的話 runtime 用內建 fallback，認得 `Stack / Row / Card / Heading / Text / Markdown / Tag / Button` 八種 piece（夠你 demo，不夠 production）。production 一定要把 `renderPiece` 接到完整的 [PieceRenderer](../surfaces/renderer.md)。

## 跨文件

- [SkillTools / SurfaceSkill](./overview.md) — 其他三種 skill。
- [Pieces catalog](../surfaces/pieces-catalog.md) — panel 裡畫什麼由 Piece 系統決定。
- [Placements](../surfaces/placements.md) — PanelRuntime 自己 mount 一個 overlay，沒用 placement slot；自訂版可以改成 `applyPlacement(el, 'palette')`。
