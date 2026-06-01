# 如何註冊 palette 指令

**palette item** 就是命令面板裡的一列。拿來做導航捷徑、快速 toggle，或任何你想讓使用者用 `Ctrl+K + 幾個字` 就能觸發的事情。

```ts
dotdotduck.palette.addItem({
  id: 'go-billing',
  name: 'Open Billing',
  description: 'See invoices and payment history',
  section: 'Navigation',
  icon: '◇',
  handler: (p) => {
    p.close();
    yourRouter.push('/billing');
  },
});
```

這就是最低限。註冊完丟進面板、跟其他項目一起做模糊比對，選到的時候會觸發 `handler`。

---

## 一列長怎樣

```
[icon]  [prefix-pill]  Name  —  description text here          ⌘B
   ◇       nav:        Try It —  立即體驗 — 跑一遍 dotdotduck 的互動    ↵
```

除了 `name` 以外其他都可省略。`description`（破折號後面那段）是淡色的長文字，拿來提醒使用者這列做什麼、會帶去哪裡。

---

## 欄位參考

```ts
interface PaletteItem {
  id: string;                  // unique key; used by HeatRank for usage sorting
  name: string;                // primary label
  description?: string;        // shown after an em-dash, muted
  icon?: string;               // single glyph — monochrome Unicode is the house style
  section?: string;            // groups rows ("Navigation", "Settings", …)
  keywords?: string[];         // extra strings fed to fuzzy match (alt names, path, …)

  prefix?: string | string[] | { match: string | string[]; label?: string };
  prefixAcceptsAnyArg?: boolean;
  fallback?: boolean;

  /** Dynamic resource expansion — see the `Browse` pattern below. */
  browse?: (arg: string) => PaletteItem[];
  /** Section heading used for items returned by `browse`. */
  browseSection?: string;

  /**
   * Hide from the empty state + partial-prefix list; still appears in
   * free-text fuzzy search. Use for deep destinations you want findable
   * by keyword but not crowding the default list — see `searchOnly`
   * pattern below.
   */
  searchOnly?: boolean;

  shortcut?: string;           // visual hint on the far right ("⌘B", "↵", etc.)
  agentTool?: PaletteAgentTool;
  handler?: (handle: PaletteHandle, arg?: string) => void;
  detail?: (arg?: string) => PieceSurface | Promise<PieceSurface>;
}
```

前綴比對是**不分大小寫**的 — `Docs:`、`DOCS:`、`docs:` 全部都會走到同一個 item。挑你覺得對使用者讀起來最順的寫法就好。

handler 會收到：

```ts
interface PaletteHandle {
  close(): void;
  replace(items: PaletteItem[]): void;          // 換 list（子選單）
  input: string;
  setInput(value: string): void;
  context: PaletteContext;                       // selection + 圖片附件
  showResult(surface: ResultSurface): void;      // in-place 結果模式
  clearResult(): void;

  // 劫持頂部輸入框，讓子工具用它當「自己的」input — 給 chat /
  // live-filter / 工具專屬 prompt 用。Palette 關閉或 Esc 退出子選單時
  // 自動還原。
  setInputContext(ctx: {
    placeholder?: string;
    onSubmit: (value: string, handle: PaletteHandle) => void;
    onInput?: (value: string, handle: PaletteHandle) => void;  // 每一個字打進來都觸發
    clearOnSubmit?: boolean;
    hideList?: boolean;                          // 隱藏底下已註冊的 item 列表
  }): void;
  clearInputContext(): void;
}
```

### Worked example：輸入框當自家搜尋框

當 host 要把面板內容做成「我自己的搜尋 UI」（不是 SDK 註冊 item 清單的 filter），用 `showResult()` 接內容、`setInputContext({ onInput })` 接每字觸發。Result mode 保留輸入框可見，每次 keystroke `onInput` 觸發、host 自己重新 render 內容：

```ts
dddk.palette.addItem({
  id: 'invoices',
  name: '/invoices',
  prefix: '/invoices',
  handler: (h) => {
    const invoices = await loadInvoices();           // 你自己的資料來源
    const root = renderList(invoices);                // 自己 own 的 HTMLElement
    h.showResult(root);
    h.setInputContext({
      placeholder: '搜尋 invoice…',
      hideList: false,
      onInput: (q) => {
        const matches = invoices.filter((inv) =>
          inv.number.includes(q) || inv.customer.toLowerCase().includes(q.toLowerCase()),
        );
        root.replaceChildren(...renderList(matches).children);
      },
      onSubmit: (q) => {
        const top = matches[0];
        if (top) goto(`/invoices/${top.id}`);
        h.close();
      },
    });
  },
});
```

同樣的 pattern 也是 dddk demo 站上 live-data UI demo 的核心 — 面板內容是 list / detail 區，輸入框是 host 自己的搜尋輸入，不是 SDK 的 item filter。`hideList: false` 是常見的預設 — 內容跟可能符合的 palette item 並列顯示；要做 chat-panel 那種需要把註冊 item 隱藏的場景，傳 `true`。

> 除了用單純的 `handler`，item 也可以宣告 `actions: PaletteAction[]` — 一個 typed discriminated union（`copy` / `insert` / `open-url` / `navigate` / `agent-task` / `render-surface` / `run-skill` / `custom`），有 primary / secondary / Ctrl+K 子面板的 UX。見 [Palette actions](./palette-actions.md)。

---

## 前綴路由實際怎麼運作

面板過濾列的方式有三種：

### 1. 沒前綴、也沒輸入（空輸入）
所有註冊過的 item 都會顯示，按 `section` 分組。（host 也可以選擇在最上面開一個 *Tips* 區 — 見下方。）

### 2. 沒前綴，但有輸入像 `tri`
拿 `name + description + keywords` 做模糊比對。分數最高的浮到最上面。

### 3. 輸入以已註冊的前綴開頭 — 例如 `nav:`
有三種子情況，按優先順序：

**(a) 比中的 item 有 `browse(arg)`** — 呼叫它。回傳的 `PaletteItem[]` 變成顯示出來的列表（會依 `arg` 做模糊過濾）;如果 `arg` 非空,會把 Ask AI fallback 接在最後。這就是**動態資源展開**模式 — 見下方 *Pattern: Browse*。常見的資源前綴像 `order:` / `customer:` / `doc:`。

**(b) 比中的 item 有 `prefixAcceptsAnyArg: true`** — item 本身變成最上面那列，前綴後面的文字（`arg`）會丟給它的 handler。拿來做自由輸入的 prompt，例如 `ask ai: anything`。

**(c) 沒 `browse`、也沒 `prefixAcceptsAnyArg`（或多個 item 共用同一個前綴）** — 前綴後面的文字拿去跟共用這個前綴的 item 的 *name* 做模糊比對。所以 `nav: try it` 會把 `nav:` 前綴的項目依名稱過濾、撈出 `Try It`，按 Enter 就觸發 *那個* item 的 handler。

```ts
// Multiple items share `nav:` — typing `nav: try` filters to Try It.
const NAV = [
  { id: 'go-home', name: 'Home',    description: '首頁',   path: '/'    },
  { id: 'go-try',  name: 'Try It',  description: '立即體驗', path: '/try' },
  { id: 'go-docs', name: 'Docs',    description: '文件',   path: '/docs' },
];
for (const n of NAV) {
  dotdotduck.palette.addItem({
    id: n.id,
    name: n.name,
    description: n.description,
    prefix: 'nav:',
    section: 'Navigation',
    handler: (p) => { p.close(); router.push(n.path); },
  });
}
```

你（host）自己決定：

- 前綴字串（`nav:`、`@`、`>`、`go:` — 看你的產品適合什麼）
- 哪些 item 名稱會被比對
- 觸發時 handler 做什麼
- 哪些 item 屬於這一組（共用同一個 `prefix` 的就是一組）

dotdotduck 不會內建任何前綴。Tips 區、那組導航 item、`/theme` toggle、`ask ai:` — 全部都是 host 自己註冊的。你不加，就不存在。

---

## Pattern：自由輸入前綴 — `ask ai: ...`

```ts
dotdotduck.palette.addItem({
  id: 'ask-ai',
  name: 'Ask AI',
  description: 'Ask anything — webagent will handle it',
  prefix: 'ask ai:',
  prefixAcceptsAnyArg: true,
  fallback: true,                  // also show when nothing else matches
  icon: '✦',
  section: 'AI',
  handler: (p, arg) => {
    p.close();
    if (arg) dotdotduck.startAgent(arg);
  },
});
```

同一個 item 掛多個前綴：

```ts
prefix: ['/ai', 'ask ai:', '?'],
```

顯示用的標籤跟比對用的 key 不一樣：

```ts
prefix: { match: ['/ai', 'ask:'], label: '/ai' },
```

---

## Pattern：Browse — 在前綴底下做動態資源展開

打資源前綴像 `order:` 跳出對應的訂單、`customer:` 跳出客戶、`doc:` 跳出文件 — 都不用離開面板。要做自己的版本,就在前綴 item 上掛一個 `browse(arg)` callback,回傳 `PaletteItem[]`。SDK 會自動拿冒號後面的輸入去做模糊過濾。

```ts
palette.addItem({
  id: 'tip-orders',
  name: 'order:',
  description: 'browse orders · 訂單',
  icon: '📦',
  section: 'Tips',
  prefix: 'order:',
  prefixAcceptsAnyArg: true,
  browseSection: 'Orders',         // section header when children render
  browse: (arg) => {
    // arg is whatever the user typed after `order:` (trimmed).
    // SDK fuzzy-filters the returned items by arg automatically — you
    // don't need to filter yourself. Just return the full resource list
    // (cache fetches; this fires on every keystroke under the prefix).
    return orders.map((o) => ({
      id: `order-${o.id}`,
      name: o.number,
      description: `${o.customer} · $${o.total}`,
      icon: '◇',
      handler: (h) => {
        h.close();
        router.push(`/orders/${o.id}`);
        // — or render inline in the palette instead of navigating:
        //   h.showResult(renderOrderDetail(o));
      },
    }));
  },
  // Enter on the tip itself seeds the prefix so refilter re-routes here
  // and `browse('')` lights up the full list.
  handler: (p) => { p.setInput('order:'); },
});
```

**兩層結構**（`Section › Page` 的麵包屑模式）:在 `browse()` 內部判斷 `arg`,再決定回什麼。偵測開頭的 "package" / "category" token,回傳那個底下的子項目並把麵包屑寫進名稱:

```ts
browse: (arg) => {
  const lower = arg.trim().toLowerCase();
  const drill = PACKAGES.find((p) => lower === p || lower.startsWith(`${p} `));
  if (drill) {
    // Second level — chapter / item list under the selected package.
    return chaptersOf(drill).map((c) => ({
      id: `${drill}-${c.slug}`,
      name: `docs › ${drill} › ${c.title}`,   // breadcrumb in the row name
      description: c.slug,
      handler: (h) => { h.close(); router.push(`/docs/${drill}/${c.slug}`); },
    }));
  }
  // First level — package rows; activating one seeds the input to drill.
  return PACKAGES.map((p) => ({
    id: `pkg-${p}`,
    name: `docs › ${p}`,
    description: `${chaptersOf(p).length} chapters`,
    handler: (h) => { h.setInput(`docs:${p} `); },
  }));
},
```

`browse` 是**同步的** — host 自己把資料 cache 起來，然後從 cache 出資料。要做非同步 / 分頁抓取的話，改用父層 item 的 `showResult(...)`（在面板內塞完全自訂的 UI）。

---

## Pattern：searchOnly — 可被搜到的深層目的地

純文字一打下去就讓所有深層目的地浮出來 — 打 `policy` 出現 `Settings › Traffic Policies`、打 `dns` 出現 `Networking › DNS Policies`,完全不用前綴。把每一個深層目的地註冊成一個扁平的 `PaletteItem`、`name` 寫成麵包屑,然後加 `searchOnly: true` 讓它不會在空狀態時塞滿列表。

```ts
for (const c of allChapters) {
  palette.addItem({
    id: `doc-${c.id}`,
    name: `docs › ${c.pkg} › ${c.title}`,
    description: c.slug,
    icon: '◈',
    section: 'Docs',
    keywords: [c.pkg, c.slug],
    searchOnly: true,                       // hidden in empty state
    handler: (h) => { h.close(); router.push(`/docs/${c.id}`); },
  });
}
```

結果：
- 空狀態 — 乾淨，只有 Tips 加上扁平的最上層項目。
- 使用者打 `react` — `docs › dddk › React adapter` 會靠對 `name + description + keywords` 的模糊比對浮上來，比中的字元會用暖黃色 highlight。
- 同一個目的地也可以同時透過 `docs:` browse tip 走到；兩條路徑並存。

---

## Pattern：快速 toggle

```ts
let darkMode = false;

dotdotduck.palette.addItem({
  id: 'toggle-dark',
  name: 'Toggle light / dark mode',
  description: '切換暗色 / 亮色',
  section: 'Settings',
  icon: '◐',
  handler: (p) => {
    p.close();
    darkMode = !darkMode;
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
  },
});
```

這個 toggle 有更順手的內建版本 — 用 `ThemeToggleModule`，見 [modules overview](../modules/overview.md)。

---

## Pattern：開放給 agent 當工具用

幫 palette item 標上 `agentTool`，webagent 就可以在任務中途呼叫它。

```ts
dotdotduck.palette.addItem({
  id: 'refund-order',
  name: 'Refund order',
  prefix: 'refund:',
  prefixAcceptsAnyArg: true,
  icon: '↩',
  agentTool: {
    description: 'Refund the order whose ID is passed as `arg`. Requires confirmation.',
    parameters: {
      type: 'object',
      properties: { arg: { type: 'string', description: 'Order ID like ORD-1002' } },
      required: ['arg'],
    },
    requireConfirmation: true,
  },
  handler: async (p, arg) => {
    p.close();
    if (!arg) return;
    await fetch(`/api/orders/${arg}/refund`, { method: 'POST' });
  },
});
```

如果 agent 接到「退 Bob 的訂單」這種任務，它可以先找到訂單，再用 `arg='ORD-1002'` 呼叫 `refund-order`。`requireConfirmation: true` 會先跳一個確認 dialog。

沒掛 `agentTool` 的 item 不會變成 agent 看得到的**獨立 tool**。如果你希望 agent 也能透過這個 item 完成某個任務，最乾淨的方式是另外**註冊 semantic intent tool**（見下節） — agent 看到的就是一個語意明確的 tool，handler 內部再去 drive palette UI 動畫。

要完全藏起來不讓 agent 看到，設 `searchOnly: true`（也會藏空狀態），或乾脆別放進 palette、走別的 surface 抵達同一段 code path。

---

## Agent 接 palette item 的兩條路

`open_palette` 這個泛用「打開 palette 讓 agent 自己 click」的 tool 在 v0.1.0+ **已移除** — 多層 UI 規劃對小模型不可靠（會錯 selector / 漏 click sub-menu / 重複開）。現在剩兩條乾淨路線：

| 機制 | 什麼時候 | 怎麼做 |
|---|---|---|
| **`agentTool` opt-in** | 單層、handler 該**靜默執行** (不顯示 palette UI) 的場景 — destructive、背景計費 mutation、QA 查詢這類。 | 在 item 加 `agentTool: { description, parameters, requireConfirmation? }`。變成 top-level tool 叫 `palette_<id>`，agent call → handler 直接跑、不開 palette。 |
| **Semantic intent tool（`dddk.tools.register`）** | 多層 palette 流程 (`/immersive_translate → 語言子選單`) 或你**要 agent 看得到 palette 動畫**作為視覺回饋。 | `dddk.tools.register({...})` 註冊一個語意 tool（例 `immersive_translate({language})`）。Handler 內部 `dddk.palette.open()` → `activateById(parent)` → `activateById(child)` 走完視覺流程，再 resolve。Agent 看到的就是「一個明確意圖的 tool」，不需要規劃 UI 步驟。 |

範例見 `dddk-frontend/src/lib/agent-tools.ts` — 把 `/immersive_translate` 兩層 palette 包成 `immersive_translate({language})`、把 `docs:` 搜尋包成 `search_docs({query})` 回 JSON。

---

## 給 agent 看的 `description` 怎麼寫

`agentTool.description` 跟一般 palette item 的 `description` agent 都會讀。寫的時候要想著 agent 的選擇邏輯，不只是用戶可發現性。

**Agent 用 description 比對用戶意圖來挑工具**。好的 description 告訴 agent：

1. **動詞開頭**：講工具**做**什麼。「退指定訂單 ID 的款」— 不是「退款工具給用戶用」。
2. **具體 input / output**：`arg` 是什麼、`parameters` 接什麼、回傳什麼。模型看到 arg 形狀挑得更準。
3. **什麼時候用、什麼時候不要用**：跟其他工具容易搞混的話加「DO NOT use for X」。Agent 對工具排序靠 description 相似度，相近的工具要解消歧義。
4. **副作用**：會 navigate / 寄信 / 改資料庫的講清楚 — agent 才會在呼叫前 narrate「我要退這筆訂單了…」。
5. **不要寫實作細節**：別提內部服務 / RPC 名稱 / 資料表。停在「用戶動作」這層就好。

### 好 vs 壞

```ts
// 壞
description: '退款'

// 好
description: '退指定訂單 ID 的款（`arg` 帶 ORD-NNNN 格式的訂單 ID）。送 refund 請求到 billing API，發 `refund_issued` event。會 require confirmation — runtime 會 gate 在用戶 Space-accept。用戶明確要求退某一張訂單時用；DO NOT 用在 partial refund（那個走 `partial-refund:`）。'
```

```ts
// 壞
description: '找客戶'

// 好
description: '用姓名 / email / 訂單 ID 查找客戶。`arg` 帶查詢字串。回傳第一個 match 的客戶 id（**先呼叫這個再呼叫 refund-order 之類修改客戶的工具**，才知道在動哪個客戶）。沒 match 回 null — fallback 用 `ask_user_choice` 給前 3 個候選。'
```

### Description 長度

每個 tool 抓 2–4 句。Agent 整個 prompt 有 token 預算 — 每個 tool 的 description 都要塞進去。內建 ~12 個 action + N 個 palette item，每個 item 大概 80–150 tokens 內為宜。狠狠刪，**具體 > 完整**。

---

## Pattern：附加圖片（相機按鈕）

面板可以收圖片附件（上傳或頁面截圖），透過 `palette.context.attachments` 帶進下一次的 handler 呼叫。

> 相機附件以及 `attachments` context 移到獨立的一頁 — 見 [Palette attachments](./palette-attachments.md)。

---

## Tips 區 — host 自己挑，不會自動生

dddk 不會自動生 Tips 區。要的話，就跟其他區一樣，把 item 註冊到 `section: 'Tips'`。慣例是：

- `name === prefix label`（這樣 SDK 會把多餘的粗體 name 槽藏起來，整列讀起來就是 `<prefix> — <desc>`）
- `handler: (h) => h.setInput(prefix)` 這樣點下去是把前綴塞進輸入框，而不是真的執行什麼

```ts
const TIPS = [
  { prefix: 'nav:',    desc: 'jump to a page' },
  { prefix: 'ask ai:', desc: 'free-form question to the agent' },
  { prefix: 'order:',  desc: 'browse orders' },        // pair with browse()
  { prefix: '#',       desc: 'full-text site search' },// pair with browse()
];
for (const t of TIPS) {
  palette.addItem({
    id: `tip-${t.prefix}`,
    name: t.prefix,
    description: t.desc,
    prefix: t.prefix,
    prefixAcceptsAnyArg: true,
    section: 'Tips',
    handler: (h) => h.setInput(t.prefix),
  });
}
```

**空狀態行為** — tips 會顯示，而 SDK 會自動把任何「前綴已經被某個 Tip 代表」的非 Tips item 隱藏。所以你如果同時註冊一個 `prefix: '/theme'` 的 tip 跟一個放在 `section: 'Settings'` 的真正 `/theme` 指令，空狀態只會 render Tip。使用者一開始打字，Tips 就消失、真正的指令接手。沒掛前綴的 item（Skills、Go-to 列、純指令）在空狀態一定會出現 — Tips 不會把它們擠掉。

**打字過程中的行為** — Tips 不會進到自由文字模糊搜尋或部分前綴比對。它們只有在輸入完全為空時才出現。

---

## Pattern：`#` 找這頁文字 — 當前頁面 DOM 搜尋

SDK export 了 `searchPageText(query)`，做的是「在目前這頁可見的 DOM body 文字裡找關鍵字」 — 跟「搜整個 docs / 資料庫 corpus」是兩件事。掛在一個 `#` Tip 底下，使用者就能直接在面板裡 grep 當前畫面：

```ts
import { searchPageText } from '@perhapxin/dddk';

palette.addItem({
  id: 'tip-find',
  name: '#',
  description: 'find on this page',
  prefix: '#',
  prefixAcceptsAnyArg: true,
  section: 'Tips',
  browseSection: 'On this page',
  browse: (arg) => {
    const q = arg.trim();
    if (!q) return [];
    // 走訪所有可見的文字節點，最多回 20 個命中，附上對應的 parent element。
    return searchPageText(q).map((hit, i) => ({
      id: `pagehit-${i}`,
      name: hit.text,             // 已經被截到 ~80 字
      handler: (h) => {
        h.close();
        hit.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
    }));
  },
  handler: (p) => { p.setInput('#'); },
});
```

`searchPageText` 故意做得很簡單 — 純 DOM walker、沒做 fuzzy、沒做 stemming、沒建 index。要對 corpus（docs / 商品 / 訂單）做搜尋，用 `browse` 接你自己的資料源（見上面的 Browse Pattern）。

---

## Pinned context — 開啟之前先把 chip bar 載好

host module（Dwell、Spotter、「選一個元素」這類功能）可以丟一段 context 字串 + 一個 selector 給面板，這樣下次開啟時就會顯示出來：

```ts
dddk.palette.setPinnedContext('The selected order: ORD-1002 — Bob Lin — $990', '#row-ORD-1002');
// later — user hits Ctrl+K:
//   chip-bar shows "CONTEXT: The selected order: ORD-1002 — Bob Lin — $990"
//   palette.context.selectionText / .selectionElement available to skill handlers
```

這個 pin 會跨多次開啟都黏著。來源狀態結束的時候要清掉：

```ts
dddk.palette.clearPinnedContext();
```

（Dwell module 已經透過它的 `onSelect` / `onClear` callback 自動接好了 — 見 [modules overview](../modules/overview.md)。）

### 有 context 時自動把 Ask AI fallback 推到第一列

只要 chip bar 裡有東西（即時的選取文字、pinned element、圖片附件），SDK 就會假設使用者把它釘上去就是為了讓 AI 來處理。所以**已註冊的 `fallback` item 會自動跑到列表第一列、鍵盤 cursor 落在它身上** — 直接按 Enter 就把這份 context 送給 agent，不用先按過 nav 列、設定列那些不相干的東西。

**預設打開**（`contextPromotesFallback: true`）。如果你產品裡的 context 不是用來餵 AI（例如純導航或純搜尋用途），在初始化時關掉：

```ts
new DotDotDuck({
  // …
  paletteOptions: {
    contextPromotesFallback: false,  // fallback 維持在最底，跟一般情況一樣
  },
});
```

只有「使用者沒在打已註冊的前綴」（`docs:`、`order:` 之類）時才會推進。當他們在 drill 一個資源時,意圖是「瀏覽 / 挑」,不是「問 AI」,這時 fallback 不會跳出來搶位置。

fallback 的 description 會自動換成它實際要送出去的內容：空輸入時顯示「送選取的內容給 AI」、有輸入時顯示 `"<你打的字>"`。

---

## 純文字 + Enter — Ask AI fallback 列

掛 `fallback: true` 的 item,會在使用者打了一串東西時當 catch-all。只要輸入非空、又沒被路由到任何前綴,SDK **一定會把 fallback 列 render 在列表最下面** — 一個固定釘住的 `Ask AI — "<query>"` 列。description 會自動換成即時的 query,讓使用者直接看到送出去的會是什麼。

| fallback 數量 | UX |
| --- | --- |
| 0 | 純文字按 Enter 不會發生任何事 — host 沒接 Ask AI handler。 |
| 1（推薦） | 每一份搜尋結果列表最下面都會釘一列 `Ask AI — "<query>"`。Enter 就用打的字觸發它。 |
| 2+ | 全部 render 成列讓使用者選（例如 `ask ai:` 跟 `web search:`）。 |

```ts
palette.addItem({
  id: 'ask-ai-fallback',
  name: 'Ask AI',
  description: 'Send the typed text to the agent',
  icon: '✦',
  fallback: true,
  section: 'AI',
  handler: (p, arg) => {
    p.close();
    if (arg) dddk.startAgent(arg);
  },
});
```

註冊這一個 item 就好，之後隨便打字按 Enter 就會直接走到 `dddk.startAgent(...)`。

---

## 內嵌結果 — 面板裡塞自訂 UI

handler 可以透過 `handle.showResult(...)` 把列表整個換成 host 自己 render 的東西。result 模式會把輸入框留在最上面；底下整塊都交給你。

```ts
palette.addItem({
  id: 'chat',
  name: '/chat',
  prefix: '/chat',
  handler: (p) => {
    const root = document.createElement('div');
    root.innerHTML = `<my-chat-panel />`;  // or any DOM you want
    p.showResult(root);
  },
});
```

`showResult` 吃 `string | HTMLElement | AsyncIterable<string> | (() => Promise<…>)`。應用場景：

- **聊天面板** — host 自己 render 一個聊天介面、接好輸入跟 LLM 來回
- **產品 / 訂單列表** — 在面板裡 render 結果卡片
- **AI 串流回答** — 丟一個 `AsyncIterable<string>`，SDK 會把每段 chunk 接上去
- **多區設定面板** — 左邊 sidebar + 右邊 pane，整塊都你的

host 也可以清掉結果、回到列表：

```ts
p.clearResult();
```

---

## 子選單模式 — `replace()`（只能一層）

```ts
palette.addItem({
  id: 'language',
  name: '/language',
  prefix: '/language',
  handler: (p) => {
    p.replace([
      { id: 'en',    name: 'English',        handler: (h) => { setLocale('en');    h.close(); } },
      { id: 'zh-TW', name: '繁體中文',       handler: (h) => { setLocale('zh-TW'); h.close(); } },
    ]);
  },
});
```

Esc 會把子選單退回上一層列表（子選單會堆疊）。關掉再重開面板一律回到根。

---

## 移除或更新 item

```ts
dotdotduck.palette.removeItem('go-billing');
dotdotduck.palette.setItems(newList);    // full replace
dotdotduck.palette.addItem({ id, ... }); // add OR upsert by id
```

**`addItem` 會依 `id` 做 upsert** — 已經註冊過相同 `id` 的 item，新的會就地取代它（位置會保留）。所以更新一個 item 就是再 `addItem` 一次同樣的 `id`，不用先 `removeItem` 再加回去。要做整個根的替換時才用 `setItems`（例如路由切換時的整批註冊）。

`HeatRank`（用「最常用浮到最上面」的使用頻率追蹤）是用 `id` 在記，所以用同樣 `id` 重新註冊，使用者的使用歷史會跨更新保留。

---

## 國際化（i18n）

SDK **不綁任何 i18n framework** — 你自己帶（i18next / paraglide / vue-i18n / 一個小小的 `tr(loc, en, zh)` helper 都行）。dotdotduck 開出來的契約，只是剛好夠讓 locale 切換做得乾淨。

**三條規則：**

1. **`id` 跟 locale 無關。** 用穩定的英文 ID 像 `'theme'`、`'language'`、`'go-billing'`。`id` 裡絕對不要塞翻譯過的文字。
2. **`name` / `description` 跟著 UI locale 走。** 在註冊的時候用你的 i18n framework 解出來。
3. **`keywords` 是個多語言搜尋池。** 把名稱的翻譯跟同義詞通通塞進 `keywords`，這樣使用者不管用哪種語言打字都能比中 — 即使顯示出來的是另一種 locale。

```ts
// Build items for a given UI locale. Re-run on locale change.
function buildItems(loc: Locale, palette: PaletteAPI) {
  palette.addItem({
    id: 'theme',                           // ← locale-agnostic identity
    name: '/theme',                        // ← prefix slug, ASCII so anyone can type it
    description: t(loc, 'cmd.theme.desc'), // ← UI-locale display string
    prefix: '/theme',
    icon: ICONS.cog,
    section: t(loc, 'section.settings'),
    // Searchable across every language you support — users type whichever
    // word they know, the same item surfaces. One-time write, grows linearly
    // with new languages (no rewriting existing items).
    keywords: [
      'theme', 'appearance', 'mode', 'dark', 'light',  // en
      '主題', '外觀', '暗色', '亮色', '深色',             // zh
      'テーマ', '外観', 'ダーク', 'ライト',               // ja
      '테마', '모양',                                     // ko
      'tema', 'apariencia',                              // es
      'thème', 'apparence',                              // fr
      'Design', 'Erscheinungsbild',                      // de
    ],
    handler: (p, arg) => toggleTheme(arg),
  });
  // …rest of items
}

// Wire it to the host's locale store.
locale.subscribe((loc) => buildItems(loc, dotdotduck.palette));
// `addItem` upserts by id, so the second pass replaces the first cleanly.
// HeatRank usage by id is preserved across the locale swap.
```

**為什麼 SDK 不自己出一套 i18n**

每個 host 本來就有一套了（i18next、@formatjs/intl、paraglide、vue-i18n、自己刻的 `tr()`）。SDK 再加一套平行的 i18n 等於兩邊都要記帳：每一條翻譯都要在兩個地方寫一遍，而且資源載入 / 拆 chunk / SSR 預載這些都是 host framework 的事。上面那份契約已經是 SDK 需要對外開出的最小集，剛好夠讓你既有的 i18n 直接接上。

**反模式：雙語字串**

```ts
// DON'T — fine for 2 languages, breaks at 3+.
description: 'switch light / dark · 切換亮暗',
```

```ts
// DO — resolved per locale, scales to any language count.
description: t(loc, 'cmd.theme.desc'),
keywords: [...all_locales_synonyms],
```

---

## palette 一列的 theming

一列裡的每一個視覺元件都是 CSS custom property — 在 host 的 stylesheet 蓋掉就行，不用重 build。（預設值已經跟 dotdotduck 其他地方一起 theme 好了；這份清單是逐列的拆解。）

```css
:root {
  /* row container */
  --dddk-palette-row-padding:        9px 16px;
  --dddk-palette-row-gap:            12px;
  --dddk-palette-row-radius:         6px;
  /* Neutral grey tint, NOT the brand accent — keeps the row signal calm
     regardless of how loud the host's accent colour is. Auto-flips to
     white-on-dark in dark mode. */
  --dddk-palette-row-bg-hover:       rgba(0, 0, 0, 0.04);
  --dddk-palette-row-bg-active:      rgba(0, 0, 0, 0.06);
  /* `→` indicator at the right edge of the focused row. */
  --dddk-palette-row-arrow-color:    var(--dddk-text-muted);

  /* icon */
  --dddk-palette-icon-size:          16px;
  --dddk-palette-icon-color:         var(--dddk-text-muted);
  --dddk-palette-icon-color-active:  var(--dddk-accent);

  /* prefix (`nav:`, `/theme`, …) — rendered as plain inline text in the
     row font, NOT a coloured pill. Calmer when many commands share a
     prefix family. Hosts wanting the pill style can override these. */
  --dddk-palette-prefix-font:        inherit;
  --dddk-palette-prefix-font-size:   var(--dddk-font-size-md);
  --dddk-palette-prefix-bg:          transparent;
  --dddk-palette-prefix-color:       var(--dddk-text-muted);
  --dddk-palette-prefix-radius:      0;
  --dddk-palette-prefix-padding:     0;

  /* name */
  --dddk-palette-name-color:         var(--dddk-text);
  --dddk-palette-name-color-active:  var(--dddk-text);
  --dddk-palette-name-font-size:     14px;
  --dddk-palette-name-font-weight:   500;

  /* — dash between name and description — */
  --dddk-palette-dash-color:         var(--dddk-text-muted);
  --dddk-palette-dash-opacity:       0.55;

  /* description */
  --dddk-palette-desc-color:         var(--dddk-text-muted);
  --dddk-palette-desc-color-active:  var(--dddk-text-muted);
  --dddk-palette-desc-font-size:     13px;
  --dddk-palette-desc-opacity-active: 1;

  /* search-match highlight inside name / description (warm yellow
     marker — kept distinct from the brand accent so it always reads as
     "this is the part your query matched") */
  --dddk-palette-match-bg:           rgba(250, 204, 21, 0.35);
  --dddk-palette-match-color:        inherit;
  --dddk-palette-match-radius:       2px;
  --dddk-palette-match-weight:       600;

  /* shortcut hint on the far right */
  --dddk-palette-shortcut-color:     var(--dddk-text-muted);
  --dddk-palette-shortcut-font:      var(--dddk-font-mono);
  --dddk-palette-shortcut-font-size: 12px;
  --dddk-palette-shortcut-opacity:   0.6;

  /* section header ("Navigation", "Settings", …) — sentence-case, no
     letter-spacing. Headers are `position: sticky` so they pin to the
     top of the scrolling list; `bg` MUST be opaque (defaults to the
     palette body). */
  --dddk-palette-section-color:           var(--dddk-text-muted);
  --dddk-palette-section-font-size:       12px;
  --dddk-palette-section-font-weight:     500;
  --dddk-palette-section-letter-spacing:  0;
  --dddk-palette-section-padding:         14px 16px 6px;
  --dddk-palette-section-text-transform:  none;
  --dddk-palette-section-bg:              var(--dddk-bg-elevated);

  /* footer kbd chips (↑ ↓ ⏎ esc hints) — borderless, low-contrast
     surface tile so the hint strip reads as ambient help. */
  --dddk-palette-kbd-bg:             rgba(0, 0, 0, 0.05);
  --dddk-palette-kbd-color:          var(--dddk-text-muted);
}
```

有 active 變體的（`-active` 後綴）只會套在當下被 highlight 的那一列 — 不想要顏色變化的話，把它跟非 active 的姊妹欄位設成一樣的值就好。

暗色模式會自動把 `--dddk-palette-row-bg-hover/active` 切到白色 tint（`rgba(255,255,255,0.05)` / `0.08`）、把比對 highlight 換成比較柔的琥珀色、把 kbd chip 背景也換成白色 tint — host 不用再多寫 CSS。

dotdotduck 其他介面（面板外框本身、字幕條、Dwell 描邊）的 theming 見 [theming](../theming.md)。
