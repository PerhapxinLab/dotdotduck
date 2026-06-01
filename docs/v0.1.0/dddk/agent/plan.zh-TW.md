# Plan — LLM 驅動的結構化 artifact 模組

> 獨立模組，掌管 in-memory 的結構化 artifacts（todos 清單、markdown 文件），讓 LLM 對它們做 read / create / edit / delete。Webagent 用它做進 turn loop 前的任務規劃；其他 host 介面也可以拿來做任何 LLM 驅動的結構化 CRUD。

Opt-in。跟 `InlineAgent` / `ImmersiveTranslate` 一樣的 attach 模式 — 用 `LLMSource` 建構、呼叫 `attachTo(dddk)`、然後 wire 進需要它的 consumer。Webagent 的 `planner` config 是最常見的 consumer。

## 什麼時候用

- **Webagent 進 loop 前的規劃**：turn loop 開始前先發一次 planning call 把 master todos 列好。後面每個 turn 都把這份 plan 當作 context、靠 `todo_adjust` 做變更 — 不會再出現 nano 模型「邊跑邊發明新 todo」的失控。
- **LLM 驅動的內容創作**：webagent 不該做的事 — 會議記錄、email 草稿、KB 文章，host 想讓模型寫進註冊的 artifact 而不是 dump free text。
- **跨 flow 狀態**：artifacts 在 Plan instance 的生命週期內持續存在；接 storage adapter 就能跨 reload 保留。

不要用 Plan 當：
- 你只是要一次性 LLM 輸出（單次改寫、單次翻譯）— 直接 call provider 就好。
- 你想讓 LLM 呼叫 tool 改 page state — 那是 webagent 的事。

## Import

```ts
import { Plan, type PlanConfig, type TaskPlan } from '@perhapxin/dddk';
```

## 最小設定

```ts
import { Plan } from '@perhapxin/dddk';

const plan = new Plan({
  llm,                 // 單一 LLMProvider 或 LLMRouter (用 plan role)
  agentName: 'YourAgent',
  appendSystemPrompt: `# Sitemap 心智模型
- /commercial — 價格 / 商業授權
- /try — 互動 demo
- /docs — API 文件

# Tour playbook
「介紹 X 頁」= navigate (if needed) + 2-4 個 narrate todo + finish。
`,
});

plan.attachTo(dddk);   // 暴露 dddk.plan 給 host 全域用

// Wire 進 webagent，每次 run 開始前先 planning：
new DotDotDuck({
  // ...
  webAgent: {
    planner: (input) => plan.makeTodos(input),
    announcePlan: true,  // stream task_summary + 等用戶按 Space
  },
});
```

## 為什麼要進 loop 前 planning

沒 planner 的 webagent：模型每 turn 要同時處理 DOM context、action 結果、自己的 memory（已經 narrate 什麼） — 對小模型（nano 級）會漂移，憑空多出 todo 或忘了講過的。症狀就是重複 narrate、提早 `task_finish`、漏 turn。

有 planner 的 webagent：開頭一次 LLM call（不帶 DOM、純 task + sitemap context）一口氣交出 `task_summary` + 有順序的 `todos[]`。後面每 turn 把 plan 當 context，**只能透過新 envelope 明寫變更**：

- `turn_planning` — 這 turn 做什麼（綁某個 todo id）、會不會是最後一輪
- `todo_adjust` — `remove` 上輪完成的 ids / `replace` 跟現實對不上的 ids
- `actions` — 跟之前一樣（narrate / tool / task_finish）

模型不能在 loop 中途新增 todo，只能 remove / replace。Webagent 行為穩定下來，因為 run 的上界在 planning 時就定死。

`planner` + `announcePlan` 怎麼插進 `WebAgentConfig` 看 [WebAgent API 文件](./api.md)。

## Config

```ts
interface PlanConfig {
  llm: LLMSource;                      // 單一 provider 或 router (plan role)
  appendSystemPrompt?: string;         // 策略 context — sitemap、路由規則、tour playbook
  systemPrompt?: string;               // 硬替換 SDK 預設（罕用）
  agentName?: string;                  // planner 自介用
  storage?: PlanStorageAdapter;        // 跨 reload 持久化（選填）
}
```

策略 context（sitemap 心智模型、「用戶問 X 帶去 /Y」這種路由規則、tour playbook）放 `appendSystemPrompt`。這段文字只在每次 run 的 planning 階段送出一次 — 不會在每 turn 都重發。所以這裡可以寫得詳細沒關係，per-turn prompt 仍會保持精簡。

## Artifacts

一個 `Plan` instance 有兩個 artifacts。兩個都有 CRUD、都會在 mutate 時 fire `onChange`、都能透過 storage adapter 持久化。

### `plan.todos` — `TodosArtifact`

```ts
interface TodoItem {
  id: string;                          // 't1', 't2', ... — create 時自動配發
  intent: 'navigate' | 'narrate' | 'click' | 'fill' | 'ask' | 'finish' | string;
  description: string;                 // 用戶感知的描述
  expected_turn?: number;              // planner 的預測（1-based）
}

plan.todos.list(): TodoItem[];
plan.todos.get(id: string): TodoItem | null;
plan.todos.create(item: Omit<TodoItem, 'id'>): TodoItem;
plan.todos.createMany(items: Array<Omit<TodoItem, 'id'>>): TodoItem[];
plan.todos.edit(id: string, patch: Partial<TodoItem>): TodoItem | null;
plan.todos.delete(id: string): boolean;
plan.todos.reset(items?: TodoItem[]): void;     // 全清重種
```

Webagent 不會直接 call 這些 method — runtime 把 `todo_adjust.remove` 翻譯成 `delete(id)`、`todo_adjust.replace` 翻譯成 `edit(id, patch)`。Host 端要為了非 webagent 流程檢查或種 todos 也可以直接呼叫。

### `plan.markdown` — `MarkdownArtifact`

```ts
interface MarkdownDoc {
  id: string;                          // 'm1', 'm2', ... — create 時自動配發
  title: string;
  content: string;
  updatedAt: number;                   // ms epoch — create + 每次 edit 都會更新
}

plan.markdown.list(): MarkdownDoc[];
plan.markdown.read(id: string): MarkdownDoc | null;
plan.markdown.create(input: { title; content }): MarkdownDoc;
plan.markdown.edit(id: string, patch: { title?; content? }): MarkdownDoc | null;
plan.markdown.editWithInstruction(id: string, instruction: string): Promise<MarkdownDoc | null>;
plan.markdown.delete(id: string): boolean;
```

`edit` 是直接覆蓋（host 已經知道新內容）。`editWithInstruction` 是 LLM 路徑 — 傳一句指令像「把第三段濃縮成一句」，模型對著當前內容改寫、回傳新 doc。用同一個 Plan-level `llm` source (`plan` role)。

Webagent 不會用 markdown artifact。它是給 host 介面做 LLM 驅動寫作用的（筆記編輯器、草稿器）— 不用自己再刻一遍 prompt-edit loop。

## `makeTodos(input)` — planning call 本體

```ts
interface PlanInput {
  task: string;                        // 用戶原始 query
  sitemap?: SitemapConfig;
  brand?: BrandPrompt;
  persona?: PersonaInput;
  locale?: string;                     // BCP-47 — 控制 task_summary 語言
  selection?: SelectionContext;        // 用戶 Dwell / drag 選取
  hostContext?: string;                // 自由 host context
}

const plan: TaskPlan = await plan.makeTodos(input);

interface TaskPlan {
  task_summary: string;                // 一句、用戶的語言
  todos: TodoItem[];                   // 有順序、ids 已配發
}
```

回傳的 `todos` 同時會種進 `plan.todos`（call `reset(todos)`），所以這個 call 結束的瞬間 artifact 就已經是最新狀態。

失敗：planner 回不來解析的 JSON（小模型偶爾會發生），`makeTodos` 直接 throw。當 wire 在 webagent 的 `planner` 上時，webagent 會 emit 一個 `error` AgentEvent、run 中止 — fail-loud、不做靜默 degrade。Host 自己決定要不要 retry 或 fallback 到非 planned 模式。

## Storage adapter — 跨 reload 持久化

跟 ImmersiveTranslate 的 `cache` 同 shape：

```ts
interface PlanStorageAdapter {
  load(): Promise<PlanSnapshot | null> | PlanSnapshot | null;
  save(snapshot: PlanSnapshot): Promise<void> | void;
}

interface PlanSnapshot {
  todos: TodoItem[];
  markdownDocs: MarkdownDoc[];
}
```

Hydration 在第一次 `attachTo(dddk)` 時 lazy 跑。Persist 在每次 artifact mutation 後跑（debouncing 是 host 的事）。

```ts
new Plan({
  llm,
  storage: {
    load: () => {
      const raw = localStorage.getItem('plan-snapshot');
      return raw ? JSON.parse(raw) : null;
    },
    save: (snap) => localStorage.setItem('plan-snapshot', JSON.stringify(snap)),
  },
});
```

## 失敗處理

- **Planning LLM call 失敗（timeout、network、parse）**：`makeTodos` throw。Webagent 露出 `AgentEvent { kind: 'error' }` 後中止。沒有自動 fallback — host 自己決定下一步。（SDK 立場：fallback policy 是 host 的事，模組不該幫忙做；同 `onLoopEnd` 的設計哲學。）
- **`todo_adjust.remove` 指到不存在的 id**：靜默忽略（runtime 用 predicate 過濾）。
- **`todo_adjust.replace` 指到不存在的 id**：靜默忽略。
- **沒有 `todo_adjust.insert`**：刻意拿掉。Master plan 在 run 開始時鎖死；loop 中途模型只能 `remove`（標完成）或 `replace`（在地改寫一個錯的 todo）。原始 plan 真的歪掉的話，模型可以連鎖 `replace` 把現有 entries 改成對的。這逼模型在 planning 時負起責任、避免「plan 永遠長大」這種 pathology。

## 跨文件

- [WebAgent API — `planner` + `announcePlan`](./api.md#config)
- [LLM router — `plan` role](../llm/router.md)
- [Agent 總覽](./overview.md)
