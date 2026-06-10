# dotdotduck — Cookbook：寫企業自己的 skill

> 給內部開發者 / 第三方參考。

## 場景 1：客服 SaaS — 一鍵叫出最近訂單

需求：使用者按 ctrl+k 打 `/recent-orders`，顯示最近 10 筆 + 點擊跳轉。

```ts
import type { ActionSkill } from '@perhapxin/dddk';

const recentOrders: ActionSkill = {
  id: 'recent-orders',
  type: 'action',
  name: '最近訂單',
  description: '看最近 10 筆',
  handler: async (ctx) => {
    const orders = await fetch('/api/orders?limit=10').then(r => r.json());
    ctx.palette.replace(orders.map(o => ({
      id: o.id,
      name: `#${o.id} - ${o.customer} - $${o.total}`,
      handler: () => ctx.navigate(`/orders/${o.id}`),
    })));
  },
};
```

## 場景 2：法律 SaaS — 對選取的條款用白話解釋

需求：使用者選取一段法律條款 → 長按 space 講「用簡單話解釋」→ 字幕條跳出簡化版本。

```ts
import type { PromptSkill } from '@perhapxin/dddk';

const simplifyClause: PromptSkill = {
  id: 'simplify',
  type: 'prompt',
  name: '用白話解釋',
  prompt: '把以下法律條款用一般人能懂的中文解釋。重點：實際上會怎麼影響我？\n\n{{selection}}',
};
```

註冊之後，dotdotduck 看到「對選取做事」+ skill `/simplify` 會自動把 `{{selection}}` 替換掉。

## 場景 3：CRM — 用 Surface 表單建立 lead

```ts
import type { SurfaceSkill } from '@perhapxin/dddk';

const newLead: SurfaceSkill = {
  id: 'new-lead',
  type: 'surface',
  name: '新增 lead',
  build: async () => ({
    root: {
      kind: 'Card',
      children: [
        { kind: 'Heading',   text: '新增 Lead' },
        {
          kind: 'Stack',
          children: [
            { kind: 'TextInput', id: 'name',   bind: '/name',   label: '姓名',  required: true },
            { kind: 'TextInput', id: 'email',  bind: '/email',  label: 'Email', required: true },
            {
              kind: 'Select',    id: 'source', bind: '/source', label: '來源',
              options: [
                { value: 'web',      label: '官網' },
                { value: 'expo',     label: '展會' },
                { value: 'referral', label: '推薦' },
                { value: 'other',    label: '其他' },
              ],
            },
            { kind: 'Button', text: '建立', action: 'submit' },
          ],
        },
      ],
    },
    data: { name: '', email: '', source: 'web' },
  }),
  onSubmit: async (data, ctx) => {
    const lead = await fetch('/api/leads', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then((r) => r.json());

    ctx.subtitle.show({
      text: `Lead #${lead.id} 已建立`,
      type: 'info',
      autoHide: 2000,
    });
    return undefined; // 關閉 surface
  },
};
```

## 場景 4：影視製作 — ScriptSkill 帶使用者逛新功能

```ts
import type { ScriptSkill } from '@perhapxin/dddk';

const tourScriptingMode: ScriptSkill = {
  id: 'tour-scripting',
  type: 'script',
  name: '介紹劇本模式',
  steps: [
    {
      page: '/project/123/script',
      subtitle: '這是劇本模式。每場戲是獨立區塊。',
      action: (t) => t.spotlight('.scene-list'),
    },
    {
      subtitle: '按 + 加新場景，或拖拉換順序。',
      action: (t) => t.highlight('.add-scene-btn', '#ff9900', '從這裡'),
      waitForUser: true,
    },
    {
      subtitle: '每場戲可以指定演員、場景、道具，按 ctrl+k 也找得到。',
      action: (t) => t.border('.scene-card', '#00aaff'),
      waitForUser: true,
    },
    {
      page: '/project/123/storyboard',
      subtitle: '完成劇本之後，這裡可以畫故事板。完成。',
      autoHide: 3000,
    },
  ],
};
```

## 場景 5：會計 SaaS — 動態 ActionSkill 顯示異常

```ts
const findAnomalies: ActionSkill = {
  id: 'anomalies',
  type: 'action',
  name: '本月帳目異常',
  handler: async (ctx) => {
    ctx.palette.replace([{ id: 'loading', name: '分析中...', handler: () => {} }]);

    const issues = await ctx.llm(
      '檢查最近 30 天交易，列出可疑項目（金額異常、重複、跳號等）。回 JSON array。',
      // ctx.llm 內部從 ctx 拿 sheet data
    );

    const parsed = JSON.parse(issues);
    ctx.palette.replace(parsed.map(issue => ({
      id: issue.id,
      name: `⚠️ ${issue.desc}`,
      description: issue.amount + ' on ' + issue.date,
      handler: () => ctx.navigate(`/ledger/${issue.id}`),
    })));
  },
};
```

## 場景 6：翻譯 / 出版 — 多個 skill 串起來

```ts
const fullTranslateWorkflow: ScriptSkill = {
  id: 'translate-book',
  type: 'script',
  name: '翻譯整本書',
  steps: [
    {
      subtitle: '開始翻譯流程。先讓我看一下章節結構。',
      action: async (t) => {
        await t.runSkill('extract-chapters');
      },
    },
    {
      subtitle: '抽取詞彙表中...',
      action: async (t) => {
        await t.runSkill('build-glossary');
      },
    },
    {
      subtitle: '正式翻譯，使用詞彙表。',
      action: async (t) => {
        await t.runSkill('translate-with-glossary', { lang: 'zh-TW' });
      },
    },
    {
      subtitle: '✓ 完成！',
      autoHide: 3000,
    },
  ],
};
```

## 場景 7：ERP — Skill 走後端做權限

```ts
const approveExpense: SurfaceSkill = {
  id: 'approve-expense',
  type: 'surface',
  name: '審核費用',
  build: async (ctx) => {
    // 後端會檢查使用者身分
    const pending = await fetch('/api/expenses/pending', {
      headers: { Authorization: `Bearer ${ctx.storage.get('token')}` },
    }).then((r) => r.json());

    if (pending.length === 0) {
      ctx.subtitle.show({ text: '沒有待審核項目', type: 'info', autoHide: 2000 });
      return undefined;
    }

    return {
      root: {
        kind: 'Card',
        children: [
          { kind: 'Heading', text: `${pending.length} 筆待審` },
          { kind: 'Listing', bind: '/items' },
        ],
      },
      data: { items: pending },
    };
  },
};
```

## 共通模式

### Skill 自動發現
企業 monorepo 通常把 skills 集中放：

```
src/dotdotduck-skills/
  ├── index.ts          # export *
  ├── orders.ts
  ├── leads.ts
  ├── translate.ts
  └── ...
```

```ts
// index.ts
export * from './orders';
export * from './leads';
// ...

// app.tsx
import * as skills from '@/dotdotduck-skills';

<DddkProvider skills={Object.values(skills)}>
```

### 依權限隱藏
ActionSkill / SurfaceSkill 可以根據使用者角色決定 build 行為，或讓 host 直接過濾掉 skills list：

```tsx
const allSkills = [adminSkill, userSkill, ...];
const visibleSkills = allSkills.filter(s => s.visible?.(currentUser) ?? true);

<DddkProvider skills={visibleSkills}>
```

### A/B 測試 skills
host 自己決定要載入哪些。dotdotduck 不管。

## 不建議的模式

- ❌ 把 API key / secret 寫在 skill prompt 裡 — 永遠走 host fetch
- ❌ skill 裡 setTimeout 跑很久 — 改用 dock placement 的 Surface 顯示進度
- ❌ skill 裡呼叫 alert / confirm — 改用 subtitle 或 inline Surface
- ❌ skill 裡存 global state — 改用 ctx.storage
