# Cache + HeatRank

> 兩個小工具：`Cache` 是 sync LRU + 可選的 sessionStorage/localStorage backing；`HeatRank` 用頻率 × 時間衰減幫常用項目排序。dddk 內部跑 palette ordering、minor data caching 都靠它們；host 想做同樣的事不必另外裝。

## `Cache`

```ts
import { Cache } from '@perhapxin/dddk';
import type { CacheOptions, CacheTier } from '@perhapxin/dddk';

const cache = new Cache({
  namespace: 'orders',      // 預設 'dddk'；前綴 backing key
  capacity:  500,           // mem LRU 上限。預設 1000。
  tier:      'session',     // 'memory' | 'session' | 'local'。預設 'memory'
  ttl:       60_000,        // ms。預設 Infinity。
});
```

| Method | |
| --- | --- |
| `get(key): string \| null` | sync。memory miss → 看 backing → 寫回 memory。 |
| `set(key, value: string)` | 寫 memory + backing；超 capacity 淘汰最舊。 |
| `has(key)` | 等同 `get(key) !== null`。 |
| `delete(key)` | 兩層都拔。 |
| `clear()` | 整個 namespace 清掉（memory + backing）。 |
| `size()` | memory 的大小（不包含 backing-only 的）。 |
| `subscribe(handler)` | 訂閱變動，回 unsubscribe。 |

### 為什麼 sync

典型流程：

```ts
const cached = cache.get('user-42');
if (cached) showUser(JSON.parse(cached));        // 立刻畫
fetchUser(42).then((u) => cache.set('user-42', JSON.stringify(u)));  // 背景 refresh
```

`useMemo` / `useState` 需要「現在就有值」，async cache 一個 microtask 後才回就晚了。Cache 只存字串 — host 自己 JSON.stringify / parse。

### Tier

- `'memory'`：純 in-process Map，page reload 後清空。
- `'session'`：寫到 `sessionStorage`；reload 後還在，tab 關了沒了。
- `'local'`：寫到 `localStorage`；跨 tab、跨 session 還在。

memory layer **永遠存在**；tier 只是「另外加一層備援」。讀的時候 memory miss 才會掃 backing；寫的時候 mem 與 backing 同時寫。SSR 安全 — 偵測 `window === undefined` 就跳過 backing。

### TTL

`ttl` 套到全部 entry。過期的 entry 在被 `get` 時懶刪除（不會有背景 GC）。

### 何時 host 會直接用

dddk 內部用 Cache 跑 palette debounce result、recent skills、user prefs；host 通常不必碰 — 但下列情境會用上：

- API response 短期 cache（避免 React rerender 重打）。
- HeatRank 的 persistence backing（見下）。
- Skill handler 想跨 invocation 記 state（`ActionSkillContext.storage` 也可以，但 storage 是 raw KV，Cache 多了 LRU + TTL）。

### `subscribe`

```ts
const unsub = cache.subscribe((key, value) => {
  if (value === null) console.log(`evicted: ${key}`);
  else console.log(`set: ${key} = ${value}`);
});
```

不會被 `get` 觸發 — 只在 set / delete / clear 時叫。

## `HeatRank`

```ts
import { HeatRank, makeCacheAdapter } from '@perhapxin/dddk';
import type { HeatRankOptions, HeatRankAdapter } from '@perhapxin/dddk';

const heat = new HeatRank({
  scope:            'palette',       // 區分多個獨立排名
  halfLifeMs:       7 * 24 * 3600e3, // 一週半衰，預設值
  maxVisitsPerItem: 20,              // 每項只記最近 20 次
  adapter:          makeCacheAdapter(cache),  // optional，預設 in-memory
});
```

### 演算法

每次 `visit(id)` 加一個權重 1 的事件，事件權重隨時間指數衰減：

```
score(now) = Σ over visits of 0.5 ^ ((now - visitedAt) / halfLifeMs)
```

7 天前的 visit 算 0.5 分；14 天前 0.25。最近常用的 + 久遠歷史多次用的都會浮到前面。

### Method

| | |
| --- | --- |
| `visit(id)` | 記一次使用 |
| `score(id, now?)` | 算目前分數 |
| `sort(items, idOf, fallback?)` | 把 items 按 score 由高到低排，同分用 fallback 比較器 |
| `forget(id)` | 砍掉某 item 的歷史 |
| `reset()` | 砍掉整個 scope |

### 典型用法

```ts
// 使用者按 palette skill 時
dddk.events.on('skill_run', ({ id }) => heat.visit(id));

// 列 palette 時把高熱度的拉到前面
const sortedSkills = heat.sort(
  registry.list(),
  (s) => s.id,
  (a, b) => a.name.localeCompare(b.name)  // 同分時字母序
);
```

scope 用來分開不同上下文：

```ts
const palette = new HeatRank({ scope: 'palette',      adapter });
const files   = new HeatRank({ scope: 'recent-files', adapter });
```

### Adapter

```ts
interface HeatRankAdapter {
  read(scope: string): Record<string, number[]>;
  write(scope: string, data: Record<string, number[]>): void;
}
```

沒給 adapter 預設 in-memory（reload 沒了）。要 persistence 就把 Cache 包成 adapter：

```ts
const cache = new Cache({ namespace: 'heatrank', tier: 'local' });
const heat  = new HeatRank({ scope: 'palette', adapter: makeCacheAdapter(cache) });
```

`makeCacheAdapter(kv)` 只需要一個 `{ get(key), set(key, value) }` 的物件 — 不一定要是 dddk 的 Cache，自己接到任何 sync KV（host 的 redux store、indexedDB sync wrapper）都行。

## dddk 內部用在哪

- `Cache`：palette 結果 debounce、最近的 LLM 回應暫存、preference 讀寫的記憶體層。
- `HeatRank`：palette skill ordering（user 常用的浮到頂）、recent commands、模組內 suggestion 排名。

host 不用做任何事就會跑（DotDotDuck 內部自動接好）。如果你想：

- **取代** dddk 預設行為（自家 KV / 自家 score） — 自己 new 一份、自己 subscribe。
- **多用一份** 給自己的 feature（最近瀏覽、最常用的客戶） — 取個新 namespace / scope 就好。

## 跨文件

- [PreferenceStore](../skills/preferences.md) — 也是 sync KV 概念，但 schema-aware。一般 cache 用 Cache，per-skill 設定用 PreferenceStore。
