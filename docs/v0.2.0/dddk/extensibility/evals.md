# Evals — regression-test skills with deterministic LLM stubs

> Tweaking a PromptSkill, adjusting agent instructions, or adding a tool can silently break previously-working cases. Evals freeze expected behaviour in a spec, run on every build, and catch regressions immediately.

## Design

- `defineEval(spec)` — declare an eval.
- `runEvals(specs, { llm })` — run a batch and return an `EvalReport`.
- `MockLLM` — deterministic LLM provider; give it a sequence of responses (or a function) and it returns them in order.
- `mockToolCall(tool, args)` — produce a `CompleteResult` that emits a tool call.

Evals use a trace pattern: while running the skill, every LLM call, tool call, subtitle, surface, and error is recorded; assertions run against the trace.

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

| Assertion kind | Passes when |
| --- | --- |
| `{ kind: 'includes', substring }` | `trace.text` or any subtitle contains the substring |
| `{ kind: 'matches', pattern: RegExp }` | Same, but with a regex |
| `{ kind: 'callsTool', tool }` | A matching tool call appears in the trace |
| `{ kind: 'doesNotCallTool', tool }` | No matching tool call appears |
| `{ kind: 'meetsCriteria', description, check(trace) => boolean }` | Custom predicate |

`EvalTrace` exposes:

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

## Example: three evals guarding one skill

Suppose we have a `translate` PromptSkill:

```ts
import type { PromptSkill } from '@perhapxin/dddk';

const translate: PromptSkill = {
  id: 'translate',
  type: 'prompt',
  name: 'Translate',
  prompt: 'Translate the user message into {{language}}. When done, call show_subtitle to inform the user that the translation is complete. If the user message is empty, call show_subtitle to ask what they want translated.',
};
```

Three evals to hold the behaviour:

```ts
const evals: EvalSpec[] = [
  defineEval({
    name: 'translate: empty input prompts the user',
    skill: translate,
    userInput: '',
    vars: { language: 'English' },
    assertions: [
      { kind: 'callsTool', tool: 'show_subtitle' },
      { kind: 'includes',  substring: 'translate' },
    ],
  }),

  defineEval({
    name: 'translate: normal input emits "done" subtitle',
    skill: translate,
    userInput: '你好',
    vars: { language: 'English' },
    assertions: [
      { kind: 'callsTool', tool: 'show_subtitle' },
      { kind: 'includes',  substring: 'complete' },
    ],
  }),

  defineEval({
    name: 'translate: should not invoke other tools',
    skill: translate,
    userInput: '你好',
    vars: { language: 'English' },
    assertions: [
      { kind: 'doesNotCallTool', tool: 'navigate' },
      { kind: 'doesNotCallTool', tool: 'agent' },
    ],
  }),
];
```

Run it:

```ts
const llm = new MockLLM({
  responses: [
    // eval #1: empty input → prompt
    { ...mockToolCall('show_subtitle', { text: 'Please type what to translate' }), content: '' },
    // eval #2: "你好" translated to English → done subtitle
    { ...mockToolCall('show_subtitle', { text: 'Translation complete: Hello' }), content: 'Hello' },
    // eval #3: same as #2
    { ...mockToolCall('show_subtitle', { text: 'Translation complete: Hello' }), content: 'Hello' },
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
    { content: 'hi', usage: { input: 10, output: 2 } }, // partial CompleteResult
    mockToolCall('search_catalog', { query: 'shirt' }), // a tool call
  ],
});
```

Functions are also supported for conditional responses:

```ts
new MockLLM({
  responses: (opts, callIndex) => {
    const lastUserMsg = opts.messages.findLast((m) => m.role === 'user')?.content ?? '';
    if (typeof lastUserMsg === 'string' && lastUserMsg.includes('refund')) {
      return mockToolCall('qa_lookup', { question: lastUserMsg });
    }
    return { content: `OK ${callIndex}` };
  },
});
```

In array mode the last entry repeats — calls beyond the array length all return the last item.

## Runner

```ts
const report = await runEvals(evals, {
  llm,                          // required
  toolMocks: {                  // optional: mock ctx.llm and other ambient helpers
    llm: (prompt) => `mocked llm: ${prompt}`,
  },
  verbose: true,                // default true; prints each result
});

interface EvalReport {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: number;             // alias of failed; convenient for CI
  results: EvalResult[];        // each EvalResult carries trace + failures[]
}
```

The `failures` alias exists for CI ergonomics (`if (report.failures > 0) process.exit(1)` reads more naturally).

## How each skill type is driven

| skill.type | What runEvals does |
| --- | --- |
| `script` | No LLM call; collects each step's `subtitle` into the trace. |
| `prompt` | Substitutes `vars` into `prompt`, then makes one `llm.complete({ system, user: userInput })` call. |
| `action` | Calls `handler(stubCtx)`; `palette.replace` / `navigate` / `agent` calls are captured as `trace.toolCalls`. |
| `surface` | Calls `build(stubCtx)`; the result lands in `trace.surfaces[]`. |

PanelSkill isn't driven directly by the runner — its lifecycle (onEnter → onInput → onAction) needs a host-supplied test harness.

## Skip

```ts
defineEval({ name: 'not implemented yet', skill, userInput: '...', assertions: [], skip: 'API not deployed' });
```

Skipped evals don't run, don't fail, and still appear in the report.

## Eval vs integration test

| Use eval | Use integration test |
| --- | --- |
| Skill / prompt / tool behaviour | Full UI flow (palette open, key press, render) |
| Pure LLM-driven decisions | DOM interaction, CSS, routing |
| Want many cases in seconds | A few happy paths over minutes |
| Run without a real LLM key (CI) | Run end-to-end fixtures |
| Mock deterministic input → output | Real user agent |

You need both — evals catch "how the LLM uses tools," integration tests catch browser behaviour.

## See also

- [Tools registry](./tools-registry.md) — most tools you register should have an eval guarding "the agent does call this when expected".
- [Skills overview](../skills/overview.md) — skill shape.
