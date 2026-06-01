# dotdotduck — Skills SDK

> Skill 就是一個可註冊的「dotdotduck 行為單元」。四種型別涵蓋從純 prompt 模板，到視覺導覽，再到 Surface（結構化 UI）。

## 四種 Skill 型別

### 1. ScriptSkill — 一連串視覺步驟

最適合 onboarding 導覽 / 教學 / 復演。

```ts
import type { ScriptSkill } from '@perhapxin/dddk';

const introduce: ScriptSkill = {
  id: 'introduce',
  type: 'script',
  name: '導覽我們的功能',
  description: '5 分鐘看完所有重點',
  steps: [
    {
      page: '/',
      subtitle: '歡迎！這是首頁。',
      action: (tools) => tools.spotlight('.hero'),
    },
    {
      page: '/pricing',
      subtitle: '這是我們的方案。',
      action: (tools) => tools.highlight('.plans', undefined, '看這裡'),
    },
    {
      page: '/dashboard',
      subtitle: '進來之後會看到儀表板。可以按 ctrl+k 隨時叫我。',
      waitForUser: true,  // 等用戶按 space 才往下
    },
  ],
};
```

每個 step：
- `page`（optional）— 換頁
- `subtitle`（optional）— 字幕條給用戶看的話
- `action`（optional）— 視覺操作（highlight / spotlight / border / inject）
- `waitForUser`（預設 true）— 等用戶按 space 才進下一步

### 2. PromptSkill — 客製 agent system prompt

最適合「同一種任務反覆做」。

```ts
const translate: PromptSkill = {
  id: 'translate',
  type: 'prompt',
  name: '翻譯這頁',
  prompt: '使用 immersive_translate action 把這頁翻成 {{language}}。完成後 show_subtitle 告訴用戶完成。',
};
```

`{{variable}}` 從用戶輸入抽出來。

用戶在 palette 打 `/translate 英文` → variable `language` = `'英文'` → 整段 prompt 套進 agent 的 system prompt → agent 開跑。

### 3. ActionSkill — 純 action，不走 agent

最適合「立即執行、不需要 LLM 判斷」。

```ts
const clipboardHistory: ActionSkill = {
  id: 'clipboard-history',
  type: 'action',
  name: '剪貼簿歷史',
  handler: (ctx) => {
    const items = ctx.storage.get('clipboard') ?? [];
    ctx.palette.replace(items.map(i => ({
      id: i.id,
      name: i.text.slice(0, 50),
      handler: () => navigator.clipboard.writeText(i.text),
    })));
  },
};
```

handler 拿一個 context，你可以：
- `ctx.palette` — 操作 palette
- `ctx.subtitle` — 顯示字幕
- `ctx.storage` — 讀 / 存
- `ctx.llm` — 需要時叫 LLM
- `ctx.agent` — 需要時叫 agent

### 4. SurfaceSkill — 開一個結構化 UI

最適合「需要結構化輸入 / 顯示結構化結果」。回傳一份 `PieceSurface`（根節點 + 可選的資料模型）。dotdotduck 會發 `surface` event，host 用 `PieceRenderer` 渲染。詳見 [surface-renderer](../surfaces/renderer.md)。

```ts
import type { SurfaceSkill } from '@perhapxin/dddk';

const orderStatus: SurfaceSkill = {
  id: 'order-status',
  type: 'surface',
  name: '查訂單狀態',
  build: async (ctx) => ({
    root: {
      kind: 'Card',
      children: [
        { kind: 'Heading',   text: '查詢訂單' },
        { kind: 'TextInput', id: 'orderId', bind: '/orderId', label: '訂單編號' },
        { kind: 'Button',    text: '查詢', action: 'submit' },
      ],
    },
    data: { orderId: '' },
  }),
  onSubmit: async ({ orderId }, ctx) => {
    const order = await fetch(`/api/orders/${orderId}`).then((r) => r.json());
    return {
      // 第二個 surface 顯示結果（多步表單）；回 undefined 就關掉
      root: {
        kind: 'Card',
        children: [
          { kind: 'Heading', text: `${order.id} — ${order.customer}` },
          { kind: 'Metric',  label: '金額', value: `$${order.total}` },
        ],
      },
    };
  },
};
```

`build` 產第一個 surface，`onSubmit` 收到用戶輸入之後可以回新 surface（多步表單）或 `undefined`（結束）。

## SkillRegistry

```ts
class SkillRegistry {
  register(skill: Skill): void;
  unregister(id: string): void;
  get(id: string): Skill | undefined;
  list(): Skill[];
  match(command: string): Skill | undefined;  // "/introduce" → skill "introduce"
}
```

`SkillRegistry` 是 dotdotduck 內建的，host 透過 config 把 skills 傳進去：

```ts
new DotDotDuck({
  skills: [introduce, translate, orderStatus, clipboardHistory],
});
```

或之後動態加：

```ts
dotdotduck.skills.register(newSkill);
```

## SkillTools（給 ScriptSkill 用）

```ts
interface SkillTools {
  navigate(path: string): void;
  highlight(selector: string, color?: string, label?: string): string;  // 回 overlay id
  border(selector: string, color?: string, label?: string): string;
  spotlight(selector: string): string;
  inject(selector: string, text: string, position?: 'before' | 'after'): string;
  subtitle(text: string): void;
  clearOverlays(): void;
  ask(question: string): Promise<string>;       // 問用戶一段純文字
  wait(ms: number): Promise<void>;
  llm?(prompt: string): Promise<string>;        // 一次性 LLM 呼叫
  runSkill?(id: string, vars?: Record<string, string>): Promise<void>;
  /**
   * 中途開一個 Surface 表單，等用戶送出。
   * - resolve 為用戶送出的 data
   * - 或 `null`（用戶按 Esc / cancel）
   */
  surface(
    surface: PieceSurface,
    opts?: { placement?: 'center' | 'inline' | 'dock' }
  ): Promise<Record<string, unknown> | null>;
}
```

`tools.surface()` 行為跟 `SurfaceSkill` 一樣 — 發 `surface` event，等 host render 完再 call `dddk.submitSurface(data)` / `dddk.cancelSurface()`。差別在 ScriptSkill 可以**中途**插一個臨時表單再繼續跑，不像 SurfaceSkill 整個 skill 就是一個 surface。詳見 [how-to-add-a-skill](./how-to-add-a-skill.md) 的「Mid-script Surface」段落。

## Skill ID 跟 palette 的整合

Skill id 開頭通常用斜線，因為 palette 把以斜線開頭的輸入當 skill：

```
用戶在 palette 打 "/introduce"
  → registry.match("/introduce") → 找到 introduce skill
  → dispatch(introduce, args)
```

不以斜線開頭也行（純 name 搜尋），習慣上 ScriptSkill / PromptSkill 用斜線，ActionSkill / SurfaceSkill 用 name。

## 套件附帶哪些 skill？— **零個**

dotdotduck 不附任何內建 skill。所有 skill 都由企業 / 開發者自己寫、自己 register。

理由：
- skill 是業務行為，沒有 universal 的「合適預設」
- 一附帶就要負責維護、文件、i18n
- 用戶會把它當「應該保留」的東西，反而改不掉

需要寫範例 skill 時，看 [cookbook.md](./cookbook.md)（cookbook 是 doc，不是 export 出去的程式碼）。

## 多 skill 組合

ScriptSkill 的步驟裡可以呼叫其他 skill：

```ts
{
  page: '/dashboard',
  action: async (tools) => {
    await tools.runSkill('translate', { language: 'zh-TW' });
    tools.subtitle('翻譯完成，繼續導覽');
  },
}
```

PromptSkill 在 prompt 裡面也可以引用其他 skill：「先用 /clipboard-history 找最近複製的內容，再 ...」。

## 企業 cookbook

完整範例看 [cookbook.md](./cookbook.md)。
