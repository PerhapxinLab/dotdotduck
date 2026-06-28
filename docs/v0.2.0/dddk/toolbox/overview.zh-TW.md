# Toolbox 總覽

`@perhapxin/dddk/toolbox/*` 是一組 zero-LLM、zero-server 的 NLP / 檢
索基礎模組,host 直接拉進來組**搜尋**和**推薦**等領域功能 — 不需要後
端、不需要 model。整套跑在瀏覽器內,索引放在記憶體或 IndexedDB。每個
模組都設計成可以直接接 host 自家的資料庫(`sync` connector),並隨
dddk 收集到的 telemetry 持續微調。

> Toolbox 還在優化中,API 可能會動。
>
> 想做 FAQ「使用者打問題、看到答案」的 UX?那塊現在搬到 palette 了:
> `dddk.palette.addQAItems([...])` 會把問題加成 palette row,用方向鍵
> 選到時 detail pane 自動展開答案。要讓 agent 自己查 FAQ(LLM 用 tool
> 查),用 `dddk.tools.registerQA(...)`。
>
> 想要 agent 的長期記憶?用 `@perhapxin/dddk/agent` 的 `Memory` —
> 那是 agent 該管的,不是 toolbox。

## 兩個模組

| 模組 | 文件 | 解決什麼 |
|---|---|---|
| `search`    | [search](./search)       | 站內 / 產品搜尋,per-field BM25、可插拔評分 signals、可直接接 host DB 的 sync connector、吃 telemetry 自動重排 |
| `recommend` | [recommend](./recommend) | Catalog 推薦(`similarTo` / `forCustomer`),按偏好即時重排,catalog 介面化讓 host 自帶後端 |

## 三種使用形態

### A. 直接 SDK import — host 自己呼叫模組

```ts
import { createSearch } from '@perhapxin/dddk/toolbox/search';

const search = createSearch({ adapter, scorers, weights, ... });
await search.init();
await search.addDocs(products);
const hits = await search.query('藍色襯衫', { topK: 10 });
```

當 host 要把結果用在「非 agent」的 UI(搜尋框、推薦欄、…)時走這條。

### B. 透過 `dddk.tools.register*` — 給 agent 當工具

```ts
dddk.tools.registerSearch({ items: products, toDoc });
dddk.tools.registerQA({ items: faqDataset });   // 底層用 toolbox/search
```

LLM 會在 tool list 看到註冊的工具,推理時自己決定何時呼叫。多數
demo / 消費型產品場景都走這條。

### C. A + B 兩種同時

同一份資料,host 一邊註冊成工具給 agent 用、一邊自己用模組接側邊
搜尋欄。資料一份,bind point 兩個。

## 共同原則(所有模組通用)

- **Library 不是 service** — 沒有任何伺服器端依賴。
- **直接接 host DB** — 每個模組都有 `sync` 設定:`bootstrap` 拉初
  始資料,`subscribe` / `fetchDelta` 收增量。Toolbox 自己讓瀏覽器
  內的索引跟你的資料同步,不用在 app 層 polling。
- **吃 dddk telemetry 自我優化** — search 提供 `learnRankingWeights`
  吃點擊 event,自動更新 per-field 權重;recommend 吃偏好訊號
  (`yes` / `no` / `dismiss`)並按 customer 持久化。
- **可插拔 signals** — search / recommend 都是 signal pipeline。內
  建 BM25 / 偏好比對 / recency decay / saturation 是起手套件。Host
  寫自家領域的 signal(退貨率、完成率、編輯精選、…)。
- **Adapter 系統** — host DB schema 不可知,用 adapter 把
  `Row → Doc { id, fields, meta }`。
- **不綁語言** — 內建 Unicode-aware 通用 tokeniser 開箱支援 200+
  種語言(空白分詞語、CJK、泰文 / 寮文 / 高棉文 / 緬甸文等)。如
  果你有領域 tokeniser,塞自己的 `extractFeatures(text)` function
  進來 — SDK 本身不烤任何特定語言包。
- **Recommend 不綁特定 catalog** — `Recommend` 吃任何
  `{ getDoc, allDocs, getFeatures }` 形狀的物件,不一定要傳
  `Search` instance。Host 想自己接 vector store / graph backend 都
  可以,signal pipeline 完全保留。
- **預設無 LLM** — `onLowConfidence` hook 讓 host 在信心低時
  escalate 到 LLM。LLM 完全 opt-in,從不強制。
- **可解釋** — 每個模組都有 `.explain()`,顯示哪些 signal 對哪個分
  數貢獻了多少。

## 從哪篇開始看

- 第一次摸 dddk → 從 [search](./search) 起手(最通用的模組)
- 商品推薦 → [recommend](./recommend)
- FAQ UX → 在 palette setup 裡用 `dddk.palette.addQAItems(...)`,不
  需要動 toolbox。
