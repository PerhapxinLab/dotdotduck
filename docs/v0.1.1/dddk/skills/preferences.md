# Skill preferences — `PreferenceStore`

> 每個 skill 都可以宣告自己的 preferences（API key、語言、預設 topK…），dddk 會自動把 schema 渲染成 setup form、在 storage 裡存值，並在 `required` 欄位沒填時拒絕跑 skill。

## 為什麼

很多 skill 需要 per-user 設定：

- `/translate` 要知道預設目標語言。
- `/summarize` 要連到使用者自己的 OpenAI key。
- `/jira-search` 要知道使用者要看哪個 project。

不想在每個 skill 自己刻一套 settings UI / migration / 預設值處理。`PreferenceStore` 把這層抽出來。

## 流程

1. Skill 在自己的定義上宣告 `preferences: PreferenceField[]`。
2. Host 在 boot 時 `new PreferenceStore(storage)`。
3. dddk dispatch skill 前檢查 `isComplete()`；缺欄位就先用 `buildSetupSurface(schema)` 開 setup form。
4. Skill handler 透過 `ctx.getPreferences<T>()` 拿到當前值。

## API

```ts
import { PreferenceStore } from '@perhapxin/dddk';
import type {
  PreferenceField,
  PreferenceSchema,
  PreferenceKind,
  PreferenceContext,
} from '@perhapxin/dddk';

class PreferenceStore {
  constructor(storage: StorageAdapter);

  read(skillId: string): Record<string, unknown>;
  write(skillId: string, values: Record<string, unknown>): void;
  remove(skillId: string): void;

  contextFor(schema: PreferenceSchema): PreferenceContext;
  buildSetupSurface(schema: PreferenceSchema): /* flat envelope */;
}
```

| Type | |
| --- | --- |
| `PreferenceKind` | `'text' \| 'password' \| 'number' \| 'checkbox' \| 'select'` |
| `PreferenceField` | `{ name, title, kind, description?, required?, default?, placeholder?, options? }` |
| `PreferenceSchema` | `{ skillId, fields: PreferenceField[] }` |
| `PreferenceContext` | `{ get<T>(), set(values), isComplete(), missingRequired() }` |

## 1. 在 skill 上宣告 schema

```ts
import type { ScriptSkill, PreferenceField } from '@perhapxin/dddk';

const translatePrefs: PreferenceField[] = [
  {
    name: 'targetLang',
    title: '預設目標語言',
    kind: 'select',
    required: true,
    default: 'zh-TW',
    options: [
      { value: 'zh-TW', label: '繁體中文' },
      { value: 'en',    label: 'English' },
      { value: 'ja',    label: '日本語' },
    ],
  },
  {
    name: 'apiKey',
    title: 'DeepL API key',
    kind: 'password',
    required: true,
    placeholder: 'xxxxxxxx-xxxx-xxxx',
  },
  {
    name: 'preferFormal',
    title: '使用正式語氣',
    kind: 'checkbox',
    default: false,
  },
];

const translate: ScriptSkill = {
  id: 'translate',
  type: 'script',
  name: '翻譯這頁',
  preferences: translatePrefs,
  steps: [/* ... */],
};
```

`preferences` 是 `BaseSkill` 的欄位 — 四種 skill 都能宣告。

## 2. 在 host 建 `PreferenceStore`

`PreferenceStore` 要一個 `StorageAdapter`（dddk 內部有 default，host 也可以塞自己的 — 例如 cloud-synced 設定）：

```ts
import { PreferenceStore } from '@perhapxin/dddk';

const prefs = new PreferenceStore({
  get:    (k)    => localStorage.getItem(k),
  set:    (k, v) => localStorage.setItem(k, String(v)),
  remove: (k)    => localStorage.removeItem(k),
});
```

## 3. dddk 自動 gate skill

當 skill 帶 `preferences`，dddk 在 dispatch 前：

```
contextFor(schema).isComplete()  ?
  yes → run skill, ctx.getPreferences<T>() 拿到目前值
  no  → buildSetupSurface(schema) → 開 setup form → 使用者填 → write → 再跑 skill
```

skill handler 不用知道這件事 — 它只看 `ctx.getPreferences<{ targetLang: string; apiKey: string; preferFormal: boolean }>()`。

```ts
const translate: ActionSkill = {
  id: 'translate',
  type: 'action',
  name: '翻譯',
  preferences: translatePrefs,
  handler: async (ctx) => {
    const { targetLang, apiKey, preferFormal } = ctx.getPreferences<{
      targetLang: string;
      apiKey: string;
      preferFormal: boolean;
    }>();
    await translateWithDeepL({ targetLang, apiKey, formality: preferFormal ? 'more' : 'default' });
  },
};
```

## 4. 直接呼叫 setup form

需要在 settings 頁面顯式展示「重新設定 `/translate`」按鈕時，自己組 surface：

```ts
const schema: PreferenceSchema = { skillId: 'translate', fields: translatePrefs };
const envelope = prefs.buildSetupSurface(schema);

// envelope 是 flat 格式（{ version, updateComponents, updateDataModel }）。
// 用 envelopeToSurface 轉成 PieceSurface 後丟給 PieceRenderer 畫。
import { envelopeToSurface } from '@perhapxin/dddk';
const surface = envelopeToSurface(envelope);

renderSurface(surface, { onSubmit: (data) => prefs.write('translate', data) });
```

setup form 預設有：
- 每個欄位一個對應的 `TextField` / `Checkbox` / `Picker` piece（透過 `bind: /<name>`）。
- 一個 `Button` action=`'submit'`。
- 預填值來自 `read(skillId)`，fallback 到欄位的 `default`。

## 5. Programmatic 用法（PreferenceContext）

要在不渲染 setup form 的情況下讀寫 / 檢查 completeness：

```ts
const ctx = prefs.contextFor({ skillId: 'translate', fields: translatePrefs });

ctx.get<{ targetLang: string }>();        // 現值
ctx.set({ targetLang: 'ja' });            // 合併寫入（不會清掉其他欄位）
ctx.isComplete();                         // 所有 required 都有值？
ctx.missingRequired();                    // 缺哪些欄位（PreferenceField[]）
```

`set` 是 **merge**，不是 replace — 只覆蓋你帶的 key。

## 何時要 host 自己刻設定 UI

`PreferenceStore` 適合「每個 skill 自己的 per-instance 設定」。當設定是：

- 跨 skill 共用（語言、主題、字級） → 走 host 自己的 settings store，別塞進 skill preferences。
- 結構複雜（巢狀、條件欄位、需要 live preview） → schema-driven form 表達力不夠，host 自己用 React / Vue 寫。
- 需要驗證 backend（test connection、verify token） → 自己 onSubmit 加 async 驗證，schema 沒有 hook。

簡單規則：**只有「這個 skill 沒這個值就不能跑」的東西放 preferences**。其他放 host settings。

## Storage key 格式

`PreferenceStore` 用 `prefs.<skillId>` 為 key 存 JSON-stringified 值。重置某個 skill：`prefs.remove('translate')`。

## 跨文件

- [Skills overview](./overview.md) — `preferences` 在 `BaseSkill` 哪。
- [Pieces / Surface renderer](../surfaces/renderer.md) — `buildSetupSurface` 回傳的 envelope 要走 renderer 才能畫。
