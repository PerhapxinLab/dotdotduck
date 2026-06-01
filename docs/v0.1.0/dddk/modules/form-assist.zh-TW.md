# FormAssist — 在每個 form 旁邊放「AI 幫填」按鈕

> 偵測頁面上的 `<form>`，在每個 form 右上角加一顆浮動的「AI 幫填」按鈕，點下去用 form 的 inspect 結果 fire 一個 host callback。Host 把 callback 串到 `dddk.startAgent(...)`，agent 任務用 webagent 的 `fill_input` action 來實際填寫。

Opt-in。預設關掉；要 instantiate `FormAssistModule` 並 call `start()` 才會啟用。

## 什麼時候用

- 內部 admin 頁，有很多同類 form（CRM 客戶資料、發票項目、客服 ticket triage）
- 用戶在別處貼了原始資料、只想把它分類到欄位的 UGC 流程
- onboarding wizard 裡每個欄位都能從前面那個大「自我介紹」textarea 推得出來的場景

不要用：

- form 只有 1-2 個欄位 — 自訂 palette command 更好找
- form 有 security 影響（登入、付款）— agent 不該 autofill 這些，而預設 skip 清單**沒有**包含它們，你必須自己明確傳 `skipSelector`

## Import

```ts
import { FormAssistModule, inspectForm } from '@perhapxin/dddk';
import type { FormAssistConfig, FormAssistInfo } from '@perhapxin/dddk';
```

## 最小設定

```ts
import { FormAssistModule } from '@perhapxin/dddk';

const formAssist = new FormAssistModule({
  onAssist: (info) => {
    // info.fields: [{ name, label, type, required }, ...]
    const fieldList = info.fields
      .map((f) => `- ${f.label || f.name} (${f.type}${f.required ? ', required' : ''})`)
      .join('\n');
    dddk.startAgent(
      `Fill the form at selector "${info.selector}". Fields:\n${fieldList}\n\nUse the conversation context to decide what to fill.`,
    );
  },
});

formAssist.start(dddk.subtitle);
```

「✨ 幫填」按鈕會出現在每個 `<form>` 的 `top: 8px; right: 8px`（如果 form 目前是 `static` 會被推成 `position: relative`）。

## 設定

| Option | Default | 說明 |
| --- | --- | --- |
| `formSelector` | `'form'` | CSS selector，要 attach 按鈕的 form。 |
| `skipSelector` | — | 符合的 form 跳過。給登入 / 付款 / opt-out 用。 |
| `autoShow` | `true` | 監看 DOM，新加入的 form 自動 attach。 |
| `onAssist` | — | `(info: FormAssistInfo) => void`（必填）。按按鈕時 fire。 |

## `FormAssistInfo` shape

```ts
interface FormAssistInfo {
  form: HTMLFormElement;
  selector: string;
  fields: Array<{
    name: string;     // input.name || input.id || label || '(unnamed)'
    label: string;    // <label for=…>、包覆 <label>、aria-label、或 placeholder
    type: string;     // input.type 或 tag name
    required: boolean;
  }>;
}
```

Hidden input 跟 submit / button input 會自動濾掉。

你也可以直接對任何 `HTMLFormElement` call `inspectForm(form)` 拿同樣 shape，不用走 module：

```ts
import { inspectForm } from '@perhapxin/dddk';

const info = inspectForm(document.querySelector('form')!);
```

## 跳過登入 / 付款 / opt-out 表單

預設行為是**所有** form 都 attach。永遠記得設 `skipSelector`：

```ts
new FormAssistModule({
  skipSelector: 'form#login, form[data-no-ai-fill], form.payment',
  onAssist: (info) => { /* ... */ },
});
```

慣例上的 `data-no-ai-fill` 屬性是 host 很好用的 pattern，但不是魔術 — 你還是要自己把它放進 `skipSelector`。

## Runtime API

```ts
formAssist.attachTo(form, dddk.subtitle); // 手動單一 form attach
formAssist.detachFrom(form);              // 移除按鈕 + 清掉追蹤
formAssist.stop();                        // disconnect MutationObserver + 移除所有按鈕
```

`attachTo` 是 idempotent — 對已 attach 的 form 再 call 一次是 no-op。

## Agent 實際怎麼填 form

這個 module 只是浮出意圖。實際填寫是透過 webagent 的 `fill_input` action（或 host 自己接的 script skill）。一個典型 agent 任務長這樣：

```
Fill the form at selector "form#customer-1024". Fields:
- Customer name (text, required)
- Email (email, required)
- Phone (tel)
- Notes (textarea)

Use the conversation context — the customer mentioned their name is Acme Corp,
email is hello@acme.com, and they have no phone on file.
```

Agent 每個欄位 call 一次 `fill_input(selector, value)`。AgentCursor 有 attach 的話會把每次填寫視覺化。填寫期間建議把 Dwell 關掉 — 游標在欄位間快速移動，長按偵測會增加延遲。

## Tear-down

```ts
formAssist.stop();
```

Disconnect `MutationObserver`，並從頁面上移除所有 `data-dddk-ui="form-assist-btn"`。

也看：[./agent-cursor.md](./agent-cursor.md) 把 agent 填欄位視覺化；[../skills/cookbook.md](../skills/cookbook.md) 端到端的 form-fill skill 食譜；[./overview.md](./overview.md) module 索引。
