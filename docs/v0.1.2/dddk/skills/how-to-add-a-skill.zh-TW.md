# 如何加一個 skill

一個 **skill** 就是一件你的產品可以從 palette 叫起來、有名字的事。共有四種 — 看你的任務挑一個：

| 型別 | 什麼時候用 | 範例 |
|---|---|---|
| `ScriptSkill` | 帶使用者走一輪 guided tour | `/introduce` |
| `PromptSkill` | 把一個模板化的 prompt 丟給 LLM | `/translate-prompt` |
| `ActionSkill` | 跑一段 TypeScript callback（不走 LLM） | `/clear-clipboard` |
| `SurfaceSkill` | 開一個用 Piece tree 描述的表單 / dialog | `/new-customer` |

你把 skill 註冊在 `DotDotDuck` config 上。它們會自動以 `/skillId — Name` 出現在 palette 裡。

---

## ScriptSkill — `/introduce`

一段 scripted tour。每一步顯示一段字幕，等使用者按空白鍵繼續（或設 `waitForUser: false` 自動往下走）。

```ts
import { DotDotDuck, type ScriptSkill } from '@perhapxin/dddk';

const introduce: ScriptSkill = {
  id: 'introduce',
  type: 'script',
  name: 'Tour the product',
  description: '1-minute walk-through',
  icon: '▶',
  steps: [
    { subtitle: 'Welcome! Press space to continue.' },
    {
      subtitle: 'This is your dashboard. The top bar is your nav.',
      action: (t) => { t.border('nav', '#ec4899'); },
    },
    {
      subtitle: 'Press Ctrl+K anytime to open the palette.',
    },
    {
      subtitle: 'That`s it. Have fun.',
      waitForUser: false,
    },
  ],
};

const dotdotduck = new DotDotDuck({
  siteName: 'Acme',
  llm: yourProvider,
  skills: [introduce],
});
dotdotduck.mount();
```

使用者在 palette 打 `/introduce`（或你自己 call `dotdotduck.runSkill('introduce')`）就會跑起來。

### Step API（`t` 這個參數）

| Method | 做什麼 |
|---|---|
| `t.subtitle(text)` | 換掉浮動字幕 |
| `t.border(selector, color?, label?)` | 給元素描一個有顏色的邊框 |
| `t.spotlight(selector)` | 把這個元素以外全部變暗 |
| `t.highlight(selector)` | 輕量 highlight（比 spotlight 不打擾） |
| `t.navigate(path)` | 程式化導頁（走你的 `onNavigate` callback） |
| `t.wait(ms)` | 暫停 `ms` 再進下一步 |
| `t.clearOverlays()` | 清掉所有 `border` / `spotlight` 裝飾 |
| `t.ask(question)` | 問一個問題，回 `Promise<string>` 拿使用者答案 |
| `t.surface(surface, opts?)` | 步驟中插一個 Surface；resolve 回表單資料（取消則回 `null`） |

### Script 中途插 Surface（表單 / picker / 確認）

某一步可以暫停整個 script，用 `t.surface(...)` 收一段結構化輸入。SDK 會發 `surface` event 加一份 `PieceSurface` payload；host 拿去 render，然後 call `dddk.submitSurface(data)`（或 `dddk.cancelSurface()`）就會繼續往下跑。

```ts
const onboarding: ScriptSkill = {
  id: 'onboarding',
  type: 'script',
  name: 'Onboard new account',
  steps: [
    { subtitle: 'Welcome — let me grab a couple of details.' },
    {
      action: async (t) => {
        const data = await t.surface({
          root: {
            kind: 'Card',
            children: [
              { kind: 'Heading',   text: 'Your account' },
              { kind: 'TextInput', bind: '/name',    label: 'Name',    required: true },
              { kind: 'TextInput', bind: '/email',   label: 'Email',   required: true },
              { kind: 'Button',    text: 'Continue', action: 'submit' },
            ],
          },
          data: { name: '', email: '' },
        });
        if (!data) return;                     // user cancelled
        await fetch('/api/account', { method: 'POST', body: JSON.stringify(data) });
      },
    },
    { subtitle: 'Done — your account is set up.' },
  ],
};
```

Host 端接線（一次性，就在你原本處理 `surface` event 的地方）：

```ts
dddk.on('surface', ({ surface }) => {
  mountYourRenderer(surface, {
    onSubmit: (data) => dddk.submitSurface(data),
    onCancel: ()      => dddk.cancelSurface(),
  });
});
```

完整 Surface 規格看 [surface-renderer](../surfaces/renderer.md)。

---

## PromptSkill — `/translate-prompt`

把 prompt 丟給 agent。`{braces}` 裡的變數會從你叫起來時傳的 `vars` 填進去。

```ts
import type { PromptSkill } from '@perhapxin/dddk';

const translateSkill: PromptSkill = {
  id: 'translate-prompt',
  type: 'prompt',
  name: 'Translate clipboard',
  prompt: 'Translate the following to {target}: {args}',
  icon: '文',
};

dotdotduck.registerSkill(translateSkill);
// User: /translate-prompt es Hello world
//   → prompt becomes "Translate the following to es: Hello world"
```

skill 名稱後面的參數會被串起來變成 `{args}`。想要更細的控制，skill 可以把使用者第一個 positional arg 當成具名變數讀進來 — 看 SkillRegistry 的 `parseArgs`。

---

## ActionSkill — `/clear-clipboard`

跑一段 TypeScript callback。完全不走 LLM。

```ts
import type { ActionSkill } from '@perhapxin/dddk';

const clearClipboard: ActionSkill = {
  id: 'clear-clipboard',
  type: 'action',
  name: 'Clear clipboard',
  icon: '✕',
  handler: async (ctx) => {
    await navigator.clipboard.writeText('');
    ctx.subtitle.show({ text: 'Clipboard cleared.', type: 'info', autoHide: 1500 });
  },
};
```

`ctx` 給你：
- `ctx.palette.close()` / `ctx.palette.replace(items)`
- `ctx.subtitle.show(...)` / `ctx.subtitle.hide()`
- `ctx.storage.get(key)` / `ctx.storage.set(key, value)`（預設存在 localStorage）
- `ctx.getPreferences<T>()`（如果你的 skill 有宣告 `preferences`）
- `ctx.agent(task)` 把任務丟給 webagent
- `ctx.navigate(path)`

---

## SurfaceSkill — `/new-customer`

回傳一份 `PieceSurface` — 一棵 UI primitive tree 加一份選用的 data model。dotdotduck 會發 `surface` event；host 用 `PieceRenderer` 來 render。完整 rendering 規格看 [surface-renderer](../surfaces/renderer.md)。

```ts
import type { SurfaceSkill } from '@perhapxin/dddk';

const newCustomer: SurfaceSkill = {
  id: 'new-customer',
  type: 'surface',
  name: 'New customer',
  icon: '◉',
  build: async (ctx) => ({
    root: {
      kind: 'Stack',
      children: [
        { kind: 'Heading',   text: 'New customer' },
        { kind: 'TextInput', id: 'name',  bind: '/name',  label: 'Name',  required: true },
        { kind: 'TextInput', id: 'email', bind: '/email', label: 'Email', required: true },
        {
          kind: 'Select', id: 'plan', bind: '/plan', label: 'Plan',
          options: [
            { value: 'free',       label: 'Free' },
            { value: 'pro',        label: 'Pro' },
            { value: 'enterprise', label: 'Enterprise' },
          ],
        },
        { kind: 'Button', text: 'Create', action: 'submit' },
      ],
    },
    data: { name: '', email: '', plan: 'free' },
  }),
  onSubmit: async (values, ctx) => {
    const { name, email, plan } = values;
    await fetch('/api/customers', { method: 'POST', body: JSON.stringify({ name, email, plan }) });
    ctx.subtitle.show({ text: `Created ${name}.`, type: 'info', autoHide: 2000 });
  },
};
```

---

## 每個 skill 自己的 preferences（設定）

skill 可以宣告幾個欄位，要求使用者在第一次跑之前先設好。dotdotduck 會自動跳出設定表單，並把值存進 storage。

```ts
const summarizeSkill: ActionSkill = {
  id: 'summarize',
  type: 'action',
  name: 'Summarize selection',
  preferences: [
    { name: 'targetLang', label: 'Target language', type: 'select', options: ['en', 'zh-TW', 'ja'], default: 'en' },
    { name: 'tone', label: 'Tone', type: 'text', default: 'professional' },
  ],
  handler: async (ctx) => {
    const prefs = ctx.getPreferences<{ targetLang: string; tone: string }>();
    // use prefs.targetLang / prefs.tone
  },
};
```

第一次跑這個 skill 時 dotdotduck 會顯示設定表單。之後每次跑就直接從 storage 讀。

---

## 構造後才註冊

如果你的 skill 在 `new DotDotDuck` 當下還不知道：

```ts
const dotdotduck = new DotDotDuck({ /* …no skills yet… */ });
dotdotduck.skills.register(introduce);
dotdotduck.skills.register(clearClipboard);
dotdotduck.mount();
```

執行時也可以 `dotdotduck.skills.remove('introduce')` 拔掉。
