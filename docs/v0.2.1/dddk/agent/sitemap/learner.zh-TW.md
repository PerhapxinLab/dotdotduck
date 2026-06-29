# Sitemap learner

> 靜態 sitemap 只蓋到「你記得寫下來」的路由。實際 app 一定有作者漏掉的 route，加上一堆 `/orders/:id` 動態頁有上千個 instance。`SitemapLearner` 觀察 navigation、把動態 segment 收斂、再把觀察到的東西 merge 到你靜態 base 上 — 這樣 agent 的 site map 隨著時間越來越完整，不需要你手動維護。

## 什麼時候用（什麼時候不用）

| 網站形狀 | 建議 |
|---|---|
| 小型靜態網站（< 10 routes）、結構穩定 | **手寫** `SitemapNode` 就好。Learner 只會帶來雜訊。 |
| 中型 SaaS（10–30 routes）、大致穩定 | 手寫。可能在 dev 開 learner 找出你漏掉的 route。 |
| 大型動態 catalog / admin（30+ routes、很多 `/:id`） | **Learner 蓋在手寫骨架之上。** |
| 接手別人的 app 要 agent-ify | Learner + 最小 base。讓 user 走過的路自然把結構長出來。 |

Learner 是 **opt-in** — `WebAgent` 不會自動建一個給你。要自己把它接進 router 的 navigation hook。

## Quick start

```ts
import { WebAgent, SitemapLearner, SAAS_SITEMAP_TEMPLATE } from '@perhapxin/dddk';

const learner = new SitemapLearner({
  base: SAAS_SITEMAP_TEMPLATE,
  storage: {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
  },
});

// SPA 每次換頁，告訴 learner
router.afterEach((to) => {
  learner.observePath(to.path, { title: document.title });
});

// 用 augmented 過的 tree 建 WebAgent
const agent = new WebAgent({
  llm,
  sitemap: learner.materialize(),
});
```

`materialize()` 很便宜（就是 base 的 `structuredClone` 加一次 merge），所以你可以在每次 `agent.run()` 前重呼，把上次以來新學到的 route 帶進來。

## Constructor 選項

```ts
interface SitemapLearnerOptions {
  base: SitemapNode;
  storage: SitemapLearnerStorage;
  storageKey?: string;
  maxLearnedPerParent?: number;
  isDynamicSegment?: (segment: string) => boolean;
}
```

| 選項 | 預設 | 備註 |
|---|---|---|
| `base` | — | 你的手寫靜態 sitemap。Learned data merge 在上面 — 衝突時 `title` / `description` 以 base 為準，`actions` 會 union。 |
| `storage` | — | 同步 K/V — `{ get(k): string \| null; set(k, v): void }`。包 `localStorage`、`sessionStorage` 或 dddk Cache 都行。 |
| `storageKey` | `'webagent.sitemap.learned'` | `storage` 裡的 key。如果你跑 multi-tenant 記得加 namespace。 |
| `maxLearnedPerParent` | `50` | 單一 parent 下 learned children 的上限 — 防止 hostile input（例如 `/search/<every-query>`）把樹炸開。 |
| `isDynamicSegment` | UUID / 純數字 / 長 opaque（≥12 字元）id | 回 `true` 表示這個 segment 該收斂成 `:id`。你 slug 形狀特別就 override。 |

### 預設動態 segment pattern

```ts
const DEFAULT_DYNAMIC_PATTERNS = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID
  /^\d+$/,                          // 純數字 id
  /^[A-Za-z0-9_-]{12,}$/,           // 長 opaque id（≥12 字元）
];
```

如果你的 slug 長 `green-widget-2024` 這種，預設的 `≥12 chars` 抓得到。如果短到像 `abc123`，catalog 頁就會被學成 100 個不同 leaf node — 自己塞個 matcher 修掉：

```ts
new SitemapLearner({
  base,
  storage,
  isDynamicSegment: (seg) => /^[a-z0-9]{6,}$/.test(seg) || /^\d+$/.test(seg),
});
```

## 方法

| Method | 用途 |
|---|---|
| `observePath(path, info?)` | 記錄一次 navigation。`info` = `{ title?, description?, actions? }`。Path 進來會先過 `isDynamicSegment` normalize。 |
| `materialize()` | 回傳一個 `SitemapNode` = `base` 的 deep clone merge 上目前為止觀察到的全部。傳給 `WebAgent`。 |
| `reset()` | 把學到的全部丟掉（base 留著）。給「重置 agent memory」按鈕用。 |
| `inspect()` | 回傳原始 learned tree（path → `{ visitCount, lastVisited, title?, description?, actions? }`）方便 debug / export。 |

## Storage 形狀

存在 `storageKey` 下面的就是一個 JSON object：

```json
{
  "/orders": { "visitCount": 12, "lastVisited": 1714123456000, "title": "Orders" },
  "/orders/:id": { "visitCount": 47, "lastVisited": 1714125000000, "title": "Order detail", "actions": ["view", "refund"] },
  "/settings/api-keys": { "visitCount": 2, "lastVisited": 1714000000000, "title": "API keys" }
}
```

Key 是 **normalize 過的 path**（動態 segment 已經收斂）。`actions` 在多次觀察之間會 union — 你先 `observePath('/orders/:id', { actions: ['view'] })`、後 `observePath('/orders/:id', { actions: ['refund'] })`，最終 merge 出來的 node 兩個都有。

Storage 在 constructor 讀一次、每次 `observePath` 寫一次。如果你的 `storage.set` 很貴，在 host 層 debounce — learner 不會幫你 debounce。

## Merge 怎麼跑

`materialize()` 走過儲存的 path，把每一條摺進 cloned base：

- Path 在 base 已存在 → metadata merge（title / description 只在 base 沒有時填；actions union）。
- Path 不存在 → 沿路建新 child node，每個 parent 上限 `maxLearnedPerParent`。

所以**手寫 base 訂出 canonical 形狀**（title、auth flag、notes）、**learner 把你忘了寫的形狀**補上去。Auth flag / `requiresAdmin` 不會被 infer 出來 — 只有 host 在 `info` 明確傳進來的才算。

## 各 framework 怎麼接

### SvelteKit

```ts
import { afterNavigate } from '$app/navigation';

afterNavigate(({ to }) => {
  if (!to) return;
  learner.observePath(to.url.pathname, { title: document.title });
});
```

### Next.js（app router）

```tsx
'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export function LearnerHook({ learner }: { learner: SitemapLearner }) {
  const pathname = usePathname();
  useEffect(() => {
    learner.observePath(pathname, { title: document.title });
  }, [pathname, learner]);
  return null;
}
```

### React Router

```ts
const location = useLocation();
useEffect(() => {
  learner.observePath(location.pathname, { title: document.title });
}, [location.pathname]);
```

## 按需 re-materialize

`agent.config.sitemap` 是 agent 為 run 建 prompt 時讀一次。要讓新學到的 route 生效：

```ts
agent.config.sitemap = learner.materialize();
await agent.run(task);
```

或者包成 helper：

```ts
function startAgent(task: string) {
  agent.config.sitemap = learner.materialize();
  return agent.run(task);
}
```

Clone 很便宜 — 沒量出問題就不用 cache。

## See also

- [Sitemap tree](./tree.md) — `SitemapNode` 形狀、helper（`serializeSitemap`、`resolvePath`、`searchSitemap`）。
- [Public API](../api.md) — `WebAgentConfig.sitemap` 欄位。
- [Prompt design](../prompt-design.md) — materialize 過的 tree 怎麼進 system prompt。
