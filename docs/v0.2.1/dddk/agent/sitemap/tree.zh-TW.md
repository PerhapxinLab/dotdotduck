# webagent — Sitemap Tree（給 agent 用的網站結構）

> 在 20+ 頁的網站上，agent 沒辦法每次都重讀 DOM 摸索。Sitemap 就是「網站給 agent 看的地圖」— **靜態定義**，host 在 config 提供。

## 為什麼要 tree（不是 flat list）

之前 `sitemap: SitemapEntry[]` 是平的：

```ts
sitemap: [
  { path: '/orders', description: 'Orders' },
  { path: '/billing', description: 'Billing' },
]
```

對小網站 OK，**對 20+ 頁就不夠用了**：
- agent 看不出層級關係（`/orders/:id` 是 `/orders` 的子頁）
- 沒有 auth gate 資訊（agent 衝到 `/billing` 才發現要登入）
- 沒有「在這頁可以幹嘛」的線索（actions: refund / ship）

升級成 **tree**：

## SitemapNode 結構

```ts
import type { SitemapNode } from '@perhapxin/dddk';

const sitemap: SitemapNode = {
  title: 'Acme',
  description: '電商後台',
  children: {
    'login': { title: 'Sign in' },
    'dashboard': {
      title: 'Dashboard',
      requiresAuth: true,
      actions: ['view'],
    },
    'orders': {
      title: 'Orders',
      description: '訂單列表',
      requiresAuth: true,
      actions: ['view', 'filter', 'export'],
      keywords: ['order', 'invoice', 'sales', '訂單'],
      children: {
        'new': {
          title: 'New order',
          requiresAuth: true,
          actions: ['create'],
        },
        ':id': {              // ← 動態 segment
          title: 'Order detail',
          requiresAuth: true,
          actions: ['view', 'edit', 'cancel', 'refund', 'ship'],
          notes: 'Refund 必須先 ship 才能做',
        },
      },
    },
    'settings': {
      title: 'Settings',
      requiresAuth: true,
      children: {
        'profile': { title: 'Profile' },
        'billing': {
          title: 'Billing',
          requiresAuth: true,
          requiresAdmin: true,
          actions: ['view', 'upgrade', 'cancel'],
        },
      },
    },
  },
};

new WebAgent({ llm, sitemap });
```

## Sitemap 怎麼進到 agent prompt

`prompt.ts` 會把 tree 序列化成 LLM 友善的縮排大綱（用 `serializeSitemap()`）：

```
## Site map
/                        Acme — 電商後台
  /login                 Sign in
  /dashboard             Dashboard [auth]
    actions: view
  /orders                Orders [auth] — 訂單列表
    actions: view, filter, export
    keywords: order, invoice, sales, 訂單
    /orders/new          New order [auth]
      actions: create
    /orders/:id          Order detail [auth]
      actions: view, edit, cancel, refund, ship
      note: Refund 必須先 ship 才能做
  /settings              Settings [auth]
    /settings/profile    Profile
    /settings/billing    Billing [auth,admin]
      actions: view, upgrade, cancel
```

Agent 看完這份就知道：
- 哪些頁要登入（看 `[auth]` flag）
- 每頁可以做什麼（看 actions）
- 「我要 refund」→ 該去 `/orders/:id`，而且要先 ship
- 動態 segment 用 `:id` 標出來，agent 知道要塞具體值進去

## Helper API

```ts
import {
  serializeSitemap,
  resolvePath,
  searchSitemap,
  listAuthGatedPaths,
  SAAS_SITEMAP_TEMPLATE,
} from '@perhapxin/dddk';

// 1. 序列化成 LLM 字串
const text = serializeSitemap(sitemap);

// 2. 從具體 URL 反查（含 :param resolution）
const r = resolvePath(sitemap, '/orders/12345');
// → { path: '/orders/12345', node: ...orderDetailNode, params: { id: '12345' } }

// 3. 搜尋（使用者說「我要看帳單」→ 找對應路徑）
const matches = searchSitemap(sitemap, '帳單');
// → [{ path: '/settings/billing', node: ..., params: {} }]

// 4. 列所有 auth-gated 路徑
const gated = listAuthGatedPaths(sitemap);
// → ['/dashboard', '/orders', '/orders/new', '/orders/:id', '/settings', ...]

// 5. 通用模板（host 改一改就能用）
const sitemap = SAAS_SITEMAP_TEMPLATE;  // 內附 marketing / auth / orders / settings 結構
```

## 跟 webagent 的整合

Agent 收到 task 後，在「思考」階段：
1. 先看 sitemap（serializeSitemap 的結果已經在 system prompt 裡）
2. 用 `searchSitemap` 找最相關的頁面（host 端在 ask_user 之前可以選擇先主動 resolve）
3. 如果目標頁 requiresAuth 而當前沒登入 → 先去 `/login`（agent 看到 sitemap 自然會這樣計畫）

## 通用模板（給 host 套用）

```ts
import { SAAS_SITEMAP_TEMPLATE } from '@perhapxin/dddk';

// 直接用
const sitemap = SAAS_SITEMAP_TEMPLATE;

// 或基於模板再擴
const sitemap = {
  ...SAAS_SITEMAP_TEMPLATE,
  children: {
    ...SAAS_SITEMAP_TEMPLATE.children,
    'reports': {     // 加自己的
      title: 'Reports',
      requiresAuth: true,
      actions: ['view', 'export', 'schedule'],
    },
  },
};
```

模板已經內含：marketing / auth / dashboard / orders (list+new+detail) / settings (profile+team+billing+api-keys)。

## v1 不做的（避免 over-engineering）

- ❌ Runtime sitemap 學習（agent 走過自動補）— v2 看需求
- ❌ Sitemap auto-crawler（從 nav links 推斷）— v2 看需求
- ❌ 跨 sitemap 圖搜尋演算法（Dijkstra 等）— 用 LLM 自己 reasoning 比較自然

複雜場景（大型 multi-product 平台）host 可以自己處理：
- 寫多個 sitemap 切換
- 在 `systemPrompt` 補強策略提示
- 用 dynamic skill 在 runtime 動態把 sitemap 送給 agent

## Skill 場景：palette as tool 配 sitemap

```ts
dddk.palette.addItem({
  id: 'goto-page',
  name: '前往頁面',
  prefix: ['goto:', '@'],
  prefixAcceptsAnyArg: true,
  agentTool: {
    description: 'Navigate to a page by name. Use sitemap to resolve.',
    parameters: { name: 'string' },
  },
  handler: async (palette, name) => {
    const matches = searchSitemap(sitemap, name ?? '');
    const top = matches[0];
    if (top) {
      palette.close();
      router.push(top.path);
    }
  },
});
```

Agent 想去某頁但不確定 URL → 呼叫 `palette_goto_page({ name: '帳單' })` → palette 用 sitemap 找出 `/settings/billing` → host router 跳轉。**這就是 palette + sitemap + agent 三件套的協作**。
