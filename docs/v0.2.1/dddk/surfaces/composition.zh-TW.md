# 組合 rich layout

> 圖 + 文 + 互動選項的版型怎麼組 — 同時避開「每個 piece 都是有邊框的 Card 堆疊起來看起來很重」這個 dddk Pieces 最常見的視覺地雷。

SDK 提供的四個 layout piece（`Group`, `MediaCard`, `OptionGroup`, `ChoiceList`）就是為了組合而設計：選對外層、塞對內項，20 行 JSON 就有電商等級的推薦版型。

## 組合規則

1. **一個 Surface 一個 envelope。** 用 `Card` 當外殼（或是 placement 本身的框 — `subtitle` 已經是條 bar，`palette` 已經是個 panel），就不要再塞第二個 Card。
2. **`Group` 是透明 stacking 容器。** 在 envelope 裡分組 children 用 `Group`：無邊框 / 陰影 / 背景，children 邊到邊貼著外殼。
3. **`MediaCard` 是內容、不是容器。** 自己 transparent，放進 `Card` 當 hero 或放進 `OptionGroup` 當 one-of-many。
4. **選中態活在 `data`。** 所有 input piece（`OptionGroup`, `ChoiceList`, `Picker`...）都 bind 到 `data.<key>`，從同一 path 讀回 `trigger('choose', …)` 觸發後的值。

## Pattern 1 — 上圖下選項

常見的 proactive 推薦流程：先說明在推薦什麼，給三個選項，讓使用者選。

```ts
{
  root: {
    kind: 'Card',
    children: [
      {
        kind: 'MediaCard',
        orientation: 'left',
        image: { src: '/recommend.png', alt: '', aspectRatio: '1' },
        title: '根據你最近的閱讀',
        description: '三本我們覺得你會喜歡 — 選一本或跳過。',
      },
      { kind: 'Divider' },
      {
        kind: 'OptionGroup',
        bind: 'pick',
        layout: 'column',
        options: [
          { value: 'b1', title: '書 A', description: '類別 · 320 頁', image: { src: '/b1.jpg' } },
          { value: 'b2', title: '書 B', description: '類別 · 192 頁', image: { src: '/b2.jpg' } },
          { value: 'b3', title: '書 C', description: '類別 · 410 頁', image: { src: '/b3.jpg' } },
        ],
      },
    ],
  },
}
```

外層 `Card` 是唯一有框的容器；`MediaCard` 當開場（左圖右文）；`Divider` 分隔；`OptionGroup` 是 picker。無巢狀邊框。

## Pattern 2 — 三欄橫排推薦

同一份資料，但給更寬的 surface（modal / dock）用：

```ts
{
  root: {
    kind: 'Card',
    children: [
      { kind: 'Heading', text: '挑選你的方案', level: 3 },
      {
        kind: 'OptionGroup',
        bind: 'plan',
        layout: 'row',
        columns: 3,
        options: [
          { value: 'starter', title: 'Starter', description: '個人開發者', meta: ['US$10/mo'], image: { src: '/p-starter.png' } },
          { value: 'pro',     title: 'Pro',     description: '小團隊',     meta: ['US$49/mo'], image: { src: '/p-pro.png' } },
          { value: 'team',    title: 'Team',    description: '成長中組織', meta: ['US$199/mo'], image: { src: '/p-team.png' } },
        ],
      },
    ],
  },
}
```

`layout: 'row'` + `columns: 3` → CSS grid `repeat(3, 1fr)`。每個 option 上圖下文。

## Pattern 3 — 純文字快選

圖太重時用：

```ts
{
  root: {
    kind: 'ChoiceList',
    bind: 'route',
    orientation: 'column',
    options: [
      { value: 'continue', label: '繼續這裡', description: '保持在現在這頁' },
      { value: 'docs', label: '看文件', description: '打開參考手冊' },
      { value: 'demo', label: '試 demo', description: '打開即時 playground' },
    ],
  },
}
```

不需要外層 `Card` — 字幕條 / palette body 本身就是 envelope。

## Pattern 4 — `Group` 分組（不疊邊框）

兩組相關欄位，視覺分群但不要兩個 Card 框：

```ts
{
  root: {
    kind: 'Card',
    children: [
      { kind: 'Heading', text: '帳號設定', level: 4 },
      {
        kind: 'Group',
        children: [
          { kind: 'Text', text: '個人資料' },
          { kind: 'TextField', bind: 'name', placeholder: '顯示名稱' },
          { kind: 'TextField', bind: 'email', placeholder: 'Email' },
        ],
      },
      { kind: 'Divider' },
      {
        kind: 'Group',
        children: [
          { kind: 'Text', text: '通知' },
          { kind: 'Switch', bind: 'emailNotify', label: '回覆通知' },
          { kind: 'Switch', bind: 'digestWeekly', label: '週報' },
        ],
      },
    ],
  },
}
```

## 鍵盤導航

`OptionGroup` 跟 `ChoiceList` 都內建：上下左右鍵 / Enter / Space 確認 / roving tabindex（只有選中那塊 tab-able，Tab 鍵跳出整組）。

依 layout：
- `layout: 'row'` / `orientation: 'row'` → ←/→ 移動，↑/↓ 也行
- `layout: 'column'` / `orientation: 'column'` → ↑/↓ 移動，←/→ 也行

確認永遠是 Enter 或 Space，fires `ctx.trigger('choose', { value, index })`。

## 用在哪

- **Proactive 提示** — 在 `PromptDefinition` 上設 `surface.pieces`（見 [proactive overview](../modules/proactive/overview.md)）。取代預設 yes/no Card。
- **WebAgent** — 設 `WebAgentConfig.allowPresent: true` 開啟，agent 就可以呼叫 `present_surface` action + 一個 piece tree。見 [present-surface.md](../agent/present-surface.md)。
- **Skills / palette** — `dddk.surfaces.render(surface, { placement })` 把任何 piece tree mount 到任何 [placement](./placements.md)。

## 不要做的事

| ❌ 反模式 | ✅ 正解 |
|---|---|
| `Card` 內塞 `Card` | 外層 `Card` 一個就好；內部分組用 `Group` |
| `Card` 包 `OptionGroup`，雙層邊框 | 拿掉外 Card — `OptionGroup` 的 option 自帶選中邊框 |
| 每個 tile 自己是 `Card` | 改用 `MediaCard`（transparent） |
| 為相似選擇混用 `Picker`（原生 select）跟 `ChoiceList`（自製） | 挑一個 — 要描述 / 大點擊區就 `ChoiceList`，要 compact dropdown 就 `Picker` |
| 從 `MediaCard` 直接觸發 action | 包進 `OptionGroup` 給一個選項，或旁邊放 `Button` |
