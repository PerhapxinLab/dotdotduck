# WebAgent — `present_surface` action

> Opt-in 工具，讓 agent 可以渲染結構化的 PieceSurface（圖+文推薦卡、選項網格、確認摘要）並等用戶選。預設 `off` — host 沒開的話 agent 就只走 narrate / DOM 操作。

## 為什麼要 opt-in

Rich surface 很強 — agent 可以秀 3 欄商品網格、日期挑選器、含描述的選項列表 — 但風險也不同：

- Agent 自己挑 image `src`、選項標題、描述。胡謅的內容（編造的商品、錯誤的價格）會以「漂亮的 UI」呈現而不是明顯有問題的文字。用戶對 UI 的信任度比對文字高。
- Host 能 constrain UI 的手段少 — agent 一旦吐出 piece tree，renderer 就照畫。

預設 `off` 讓 host 可以放心採用 SDK 其他部分不用先想這個風險。要做推薦流程的 host 明確 opt-in，並調整 [persona](./prompt-design.md) + brand prompt 把模型框住。

## 開啟

兩步：

```ts
new DotDotDuck({
  // …
  webAgent: {
    allowPresent: true,                       // 1. 打開 flag
    // …
  },
});

// Orchestrator 內部會幫你做（buildAgent 時）：
agent.setSurfaceMounter(({ surface, placement, resolve }) => {
  // 2. 接 mounter — render surface、聽用戶選擇、resolve({ value, cancelled })
});
```

Orchestrator 出廠就有預設 mounter，依 `placement` render 到字幕條 / modal / dock。要自製路由就 override。

## Tool shape

```ts
present_surface({
  surface: {
    root: PieceNode,
    data?: Record<string, unknown>,
  },
  placement?: 'subtitle' | 'modal' | 'dock' | 'inline',  // 預設 'subtitle'
}): Promise<{ value: string | null; cancelled: boolean }>
```

Agent 每個「讓用戶選一個」的節奏點呼叫一次。Loop 拿回選的 `value`，或 `cancelled: true` 如果用戶 dismiss。

`placement` 限 4 個值（不是 8 個 slot 的完整 `PlacementSlot` enum）。Agent 不能選 `fab` / `banner` / `toast` / `indicator` — 那些是 host 的語意。

## Agent 什麼時候挑 `present_surface` vs 其他工具

| 用戶意圖 | 對的工具 |
|---|---|
| 「Yes / No — 確認?」 | `ask_user_choice({ question, options: ['yes', 'no'] })` |
| 「你的 email?」 | `ask_user({ question })` |
| 「從這 3 個商品挑一個」(有圖) | **`present_surface`** |
| 「從這 3 個方案挑一個」(有描述) | **`present_surface`**（或 `ask_user_choice` 純文字版若夠簡單） |
| Delete / submit / pay → 確認 | Runtime auto-confirm，不用特別 action |

Host 的 palette 命令（主題切換、翻譯、搜尋等）改用 `dddk.tools.register({...})` 註冊一個 **semantic intent tool**（例：`immersive_translate({language})`、`set_theme({mode})`），handler 內部 drive palette UI 動畫。詳見 `triggers/palette.md` § 「Agent 接 palette item 的兩條路」。v0.1.0+ 已移除舊的 `open_palette` 工具。

判斷準則：如果**選擇的視覺**重要（商品圖、方案分層帶 metadata）就用 `present_surface`；2-6 個短文字夠用就 `ask_user_choice`。

## 例子 — agent 吐出推薦網格

用戶問「幫我找一個給愛喝咖啡的人的禮物」。Agent 推理，呼叫 `present_surface`：

```json
{
  "tool": "present_surface",
  "args": {
    "surface": {
      "root": {
        "kind": "OptionGroup",
        "bind": "pick",
        "layout": "row",
        "columns": 3,
        "options": [
          {
            "value": "g1",
            "title": "手沖組",
            "description": "陶瓷濾杯 + 濾紙 + 玻璃壺",
            "meta": ["US$45"],
            "image": { "src": "/catalog/pour-over.jpg" }
          },
          {
            "value": "g2",
            "title": "錐刀磨豆機",
            "description": "40 段無段刻度",
            "meta": ["US$120"],
            "image": { "src": "/catalog/grinder.jpg" }
          },
          {
            "value": "g3",
            "title": "單品咖啡組",
            "description": "三款不同產區",
            "meta": ["US$60"],
            "image": { "src": "/catalog/sampler.jpg" }
          }
        ]
      }
    },
    "placement": "modal"
  }
}
```

用戶點磨豆機 → tool resolve `{ value: 'g2', cancelled: false }` → agent 下一輪知道用戶選了 g2，可以 `navigate('/cart/add?sku=g2')` 之類。

## 鎖死 surface schema

電商場景會想限制 agent 能吐什麼（只能用你真實商品圖片，不要亂編 URL）。兩個選擇：

### 選擇 1 — `appendSystemPrompt` 加 constraint

```ts
appendSystemPrompt: `
# Surface 限制（呼叫 present_surface 時）

- 圖片 \`src\` 必須來自 /catalog/<sku>.jpg。不要編 URL。
- 可用 SKU：g1, g2, g3, g4, g5（不確定就先 \`list_catalog\`）。
- 每個 option 的 \`value\` 必須是上述 SKU 之一。
`,
```

最快上手；靠模型遵守。

### 選擇 2 — 自訂 catalog 覆寫

把 builtin `MediaCard` / `OptionGroup` 用只吃 `sku` 的版本蓋掉（image URL + 價格由 host 內部解析）。模型沒辦法亂吐 `image.src`，因為 schema 根本沒這個欄位。

```ts
catalog.register({
  kind: 'MediaCard',
  // 覆寫 — 只吃 sku，不吃 src
  render: (node, ctx) => {
    const product = lookupBySku(node.sku as string);
    if (!product) return null;
    return <ProductTile product={product} />;
  },
});
```

電商流程比較安全的 pattern。

## 流程 — surface → action

`present_surface` 是 turn-boundary action — agent 吐出來、用戶互動、下一輪看到結果。**不要**在同 envelope 內 narrate 前後加東西：前面 narrate 會 auto-pause（picker 出現前打斷很煩），後面 narrate 會在 picker dismiss 後執行（混亂）。

## Intent stream

每次 surface 互動都會 fire intents：

- `palette_activated` **不會** fire（這不是 palette 命令）。
- `agent_answered` **會** fire，帶 `via: 'gesture' | 'text'` 跟 `answer: <選中的 value 或空字串>`。
- Cancel 時：`agent_answered` 帶 `answer: ''`。

所以 dashboard 不管用戶從字幕條 picker 還是 rich surface 選的，都會看到同一個 `agent_answered` 聚合。

## 跨文件

- [composition.md](../surfaces/composition.md) — piece tree 怎麼組
- [pieces-catalog.md](../surfaces/pieces-catalog.md) — 完整 piece 列表
- [prompt-design.md](./prompt-design.md) — 用 persona + brand 加 constraint
