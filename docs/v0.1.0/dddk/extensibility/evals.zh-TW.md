# Evals — 用決定性 LLM stub 回歸測試 skill

> 改 PromptSkill 文字、改 agent instructions、加 tool — 都可能默默打壞原本會跑的 case。evals 把預期行為凍在 spec 裡，每次 build 跑一次，回歸時馬上抓到。

## 設計

- `defineEval(spec)` — 宣告一個 eval。
- `runEvals(specs, { llm })` — 跑一輪、回 `EvalReport`。
- `MockLLM` — 決定性 LLM provider；給它一串 response（或一個 function），它照順序回。
- `mockToolCall(tool, args)` — 產生一個會吐 tool call 的 `CompleteResult`。

評估走 trace pattern：跑 skill 時把所有 LLM call / tool call / subtitle / surface / error 都記下來，再對 trace 做 assertion。

## EvalSpec

```ts
import { defineEval, runEvals, MockLLM, mockToolCall } from '@perhapxin/dddk';
import type { EvalSpec, EvalAssertion, EvalTrace } from '@perhapxin/dddk';

interface EvalSpec {
  name: string;
  skill: Skill;
  userInput: string;
  vars?: Record<string, string>;
  assertions: EvalAssertion[];
  skip?: string;
}
```

| Assertion kind | 何時通過 |
| --- | --- |
| `{ kind: 'includes', substring }` | `trace.text` 或任何 subtitle 含 substring |
| `{ kind: 'matches', pattern: RegExp }` | 同上但用 regex |
| `{ kind: 'callsTool', tool }` | trace 裡有對應 tool call |
| `{ kind: 'doesNotCallTool', tool }` | trace 裡沒有對應 tool call |
| `{ kind: 'meetsCriteria', description, check(trace) => boolean }` | 自訂 predicate |

`EvalTrace` 暴露：

```ts
interface EvalTrace {
  text: string;
  toolCalls: Array<{ tool: string; args: Record<string, unknown> }>;
  subtitles: string[];
  surfaces: unknown[];
  errors: string[];
  llmCalls: number;
}
```

## 範例：三條 eval 守住一個 skill

假設我們有一個 `translate` PromptSkill：

```ts
import type { PromptSkill } from '@perhapxin/dddk';

const translate: PromptSkill = {
  id: 'translate',
  type: 'prompt',
  name: '翻譯',
  prompt: '把 user 訊息翻譯成 {{language}}。完成後呼叫 show_subtitle 告訴使用者「翻譯完成」。如果 user 訊息空白，呼叫 show_subtitle 提示要翻什麼。',
};
```

寫三條 eval：

```ts
const evals: EvalSpec[] = [
  defineEval({
    name: 'translate: 空白輸入提示要翻什麼',
    skill: translate,
    userInput: '',
    vars: { language: '英文' },
    assertions: [
      { kind: 'callsTool', tool: 'show_subtitle' },
      { kind: 'includes',  substring: '要翻' },
    ],
  }),

  defineEval({
    name: 'translate: 正常輸入會吐翻譯完成 subtitle',
    skill: translate,
    userInput: '你好',
    vars: { language: '英文' },
    assertions: [
      { kind: 'callsTool', tool: 'show_subtitle' },
      { kind: 'includes',  substring: '翻譯完成' },
    ],
  }),

  defineEval({
    name: 'translate: 不該叫到別的 tool',
    skill: translate,
    userInput: '你好',
    vars: { language: '英文' },
    assertions: [
      { kind: 'doesNotCallTool', tool: 'navigate' },
      { kind: 'doesNotCallTool', tool: 'agent' },
    ],
  }),
];
```

跑：

```ts
const llm = new MockLLM({
  responses: [
    // eval #1：空白輸入 → 喊提示
    { ...mockToolCall('show_subtitle', { text: '請輸入要翻譯的文字' }), content: '' },
    // eval #2：「你好」翻成英文 → 喊翻譯完成
    { ...mockToolCall('show_subtitle', { text: '翻譯完成: Hello' }), content: 'Hello' },
    // eval #3：跟 #2 同樣
    { ...mockToolCall('show_subtitle', { text: '翻譯完成: Hello' }), content: 'Hello' },
  ],
});

const report = await runEvals(evals, { llm, verbose: true });
console.log(`${report.passed}/${report.total} passed`);
if (report.failures > 0) process.exit(1);
```

## `MockLLM`

```ts
new MockLLM({
  responses: [
    'plain text',                                       // → { content: 'plain text', finishReason: 'stop' }
    { content: 'hi', usage: { input: 10, output: 2 } }, // 部分 CompleteResult
    mockToolCall('search_catalog', { query: 'shirt' }), // 工具呼叫
  ],
});
```

可改成 function 形式做條件回應：

```ts
new MockLLM({
  responses: (opts, callIndex) => {
    const lastUserMsg = opts.messages.findLast((m) => m.role === 'user')?.content ?? '';
    if (typeof lastUserMsg === 'string' && lastUserMsg.includes('退款')) {
      return mockToolCall('qa_lookup', { question: lastUserMsg });
    }
    return { content: `OK ${callIndex}` };
  },
});
```

陣列模式末項會 repeat — 跑超出陣列長度的 call 一律回最後一筆。

## Runner

```ts
const report = await runEvals(evals, {
  llm,                          // 必填
  toolMocks: {                  // optional：mock ctx.llm 的回覆等
    llm: (prompt) => `mocked llm: ${prompt}`,
  },
  verbose: true,                // 預設 true，console 印每條結果
});

interface EvalReport {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: number;             // 同 failed，CI ergonomics
  results: EvalResult[];        // 每條 EvalResult 帶 trace + failures[]
}
```

`failures` alias 是給 CI 用的（`if (report.failures > 0) process.exit(1)` 比較順）。

## 每種 skill 怎麼 drive

| skill.type | runEvals 做什麼 |
| --- | --- |
| `script` | 不呼 LLM，把每步的 `subtitle` 收進 trace |
| `prompt` | 把 `prompt` 套上 `vars` → 一次 `llm.complete({ system, user: userInput })` |
| `action` | `handler(stubCtx)`；`palette.replace` / `navigate` / `agent` 都會記成 trace.toolCalls |
| `surface` | `build(stubCtx)` → 結果塞進 `trace.surfaces[]` |

PanelSkill 目前 runner 不直接 drive — 它的 lifecycle（onEnter → onInput → onAction）要靠 host 自己組 test harness。

## Skip

```ts
defineEval({ name: '尚未實作', skill, userInput: '...', assertions: [], skip: 'API 還沒部署' });
```

skipped eval 不會跑、不會 fail，但會出現在 report 中。

## eval 還是 integration test？

| 用 eval | 用 integration test |
| --- | --- |
| skill / prompt / tool 行為 | UI 完整流程（palette 開啟、按鍵、render） |
| 純 LLM-driven 判斷 | DOM 互動、CSS、route |
| 想跑很多 case 在幾秒內 | 幾條 happy path 跑分鐘 |
| 沒有真 LLM key 也要跑（CI） | 跑 e2e fixture |
| Mock 確定性 input → output | 真實 user agent |

兩個都需要 — eval 抓「LLM 怎麼用工具」的回歸，integration test 抓「browser 行為」的回歸。

## 跨文件

- [Tools registry](./tools-registry.md) — 你註冊的 tool 多半需要 eval 守住「agent 真的會叫對它」。
- [Skills overview](../skills/overview.md) — Skill 形狀。
