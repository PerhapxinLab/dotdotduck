/**
 * AI evals — regression tests for agent prompts.
 *
 * When the host iterates a skill's PromptSkill or agent instructions it's
 * easy to break previously-working interactions. Evals freeze expected
 * behaviour so you catch regressions before users do. Mocks both the LLM
 * and host APIs; host wires the runner into their own CI.
 *
 * Usage:
 *   import { defineEval, runEvals, MockLLM } from '@perhapxin/dddk';
 *
 *   const evals = [
 *     defineEval({
 *       name: 'translate handles empty input',
 *       skill: translateSkill,
 *       userInput: '/translate',
 *       assertions: [{ kind: 'callsTool', tool: 'show_subtitle' }],
 *     }),
 *   ];
 *
 *   const report = await runEvals(evals, { llm: new MockLLM({ responses: [...] }) });
 *   if (report.failures > 0) process.exit(1);
 */

import type { Skill, PromptSkill } from './types';

export type EvalAssertion =
  | { kind: 'includes'; substring: string }
  | { kind: 'matches'; pattern: RegExp }
  | { kind: 'callsTool'; tool: string }
  | { kind: 'doesNotCallTool'; tool: string }
  | { kind: 'meetsCriteria'; description: string; check: (trace: EvalTrace) => boolean | Promise<boolean> };

export interface EvalSpec {
  name: string;
  skill: Skill;
  /** User input as typed in palette (e.g. '/translate en' or 'ask: hi') */
  userInput: string;
  /** Args / variables forwarded to PromptSkill / context. */
  vars?: Record<string, string>;
  /** Assertions — eval passes if ALL pass. */
  assertions: EvalAssertion[];
  /** Optional skip with reason. */
  skip?: string;
}

export function defineEval(spec: EvalSpec): EvalSpec {
  return spec;
}

// ─── Eval trace (what the agent actually did during the run) ──────

export interface EvalTrace {
  /** Final LLM-generated text response (concatenated assistant content). */
  text: string;
  /** Tool calls emitted by the LLM. */
  toolCalls: Array<{ tool: string; args: Record<string, unknown> }>;
  /** Subtitle messages shown. */
  subtitles: string[];
  /** Surfaces emitted by surface-skills (PieceSurface objects). */
  surfaces: unknown[];
  /** Errors thrown. */
  errors: string[];
  /** Raw LLM provider invocations (for debugging). */
  llmCalls: number;
}

// ─── MockLLM — deterministic responses for testing ────────────────

import type { LLMProvider, CompleteOptions, CompleteResult, ToolCall } from '../agent/llm/types';
import { genId } from '../utils/id';

export interface MockLLMOptions {
  /**
   * Either:
   *  - array of responses (returned in order, last one repeated)
   *  - function called per request to compute response
   */
  responses:
    | Array<Partial<CompleteResult> | string>
    | ((opts: CompleteOptions, callIndex: number) => Partial<CompleteResult> | string);
}

export class MockLLM implements LLMProvider {
  readonly name = 'mock';
  private cfg: MockLLMOptions;
  private callCount = 0;

  constructor(cfg: MockLLMOptions) {
    this.cfg = cfg;
  }

  async complete(opts: CompleteOptions): Promise<CompleteResult> {
    const idx = this.callCount++;
    let resp: Partial<CompleteResult> | string;
    if (typeof this.cfg.responses === 'function') {
      resp = this.cfg.responses(opts, idx);
    } else {
      const arr = this.cfg.responses;
      resp = arr[Math.min(idx, arr.length - 1)] ?? '';
    }
    if (typeof resp === 'string') {
      return { content: resp, finishReason: 'stop' };
    }
    return {
      content: resp.content ?? '',
      toolCalls: resp.toolCalls,
      usage: resp.usage,
      finishReason: resp.finishReason ?? 'stop',
    };
  }
}

/** Convenience: build a CompleteResult that emits a single tool call. */
export function mockToolCall(tool: string, args: Record<string, unknown> = {}): Partial<CompleteResult> {
  const toolCall: ToolCall = {
    id: genId('mock'),
    name: tool,
    arguments: args,
  };
  return { content: '', toolCalls: [toolCall], finishReason: 'tool_calls' };
}

// ─── Runner ───────────────────────────────────────────────────────

export interface RunEvalsOptions {
  llm: LLMProvider;
  /** Host can wire its own tool mocks (palette commands etc.). Optional. */
  toolMocks?: Record<string, (args: unknown) => unknown>;
  /** Print to console as evals run. Default true. */
  verbose?: boolean;
}

export interface EvalReport {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: number;  // alias for failed (CI ergonomics)
  results: EvalResult[];
}

export interface EvalResult {
  name: string;
  skipped: boolean;
  passed: boolean;
  failures: string[];
  trace?: EvalTrace;
  durationMs: number;
}

export async function runEvals(
  evals: EvalSpec[],
  opts: RunEvalsOptions
): Promise<EvalReport> {
  const results: EvalResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const spec of evals) {
    if (opts.verbose) console.log(`▶ ${spec.name}`);

    if (spec.skip) {
      if (opts.verbose) console.log(`  ⊘ skipped: ${spec.skip}`);
      results.push({ name: spec.name, skipped: true, passed: false, failures: [], durationMs: 0 });
      skipped++;
      continue;
    }

    const start = Date.now();
    const trace: EvalTrace = {
      text: '',
      toolCalls: [],
      subtitles: [],
      surfaces: [],
      errors: [],
      llmCalls: 0,
    };

    // Wrap the LLM to capture trace
    const trackedLLM: LLMProvider = {
      name: opts.llm.name,
      complete: async (o) => {
        trace.llmCalls++;
        const r = await opts.llm.complete(o);
        if (r.content) trace.text += r.content;
        if (r.toolCalls) {
          for (const tc of r.toolCalls) {
            trace.toolCalls.push({ tool: tc.name, args: tc.arguments });
          }
        }
        return r;
      },
    };

    try {
      await driveSkill(spec, trackedLLM, opts.toolMocks ?? {}, trace);
    } catch (err) {
      trace.errors.push((err as Error).message);
    }

    const failures = await evaluateAssertions(spec.assertions, trace);
    const ok = failures.length === 0;
    if (ok) passed++;
    else failed++;

    results.push({
      name: spec.name,
      skipped: false,
      passed: ok,
      failures,
      trace,
      durationMs: Date.now() - start,
    });

    if (opts.verbose) {
      if (ok) console.log(`  ✓ passed (${results[results.length - 1]!.durationMs}ms)`);
      else for (const f of failures) console.log(`  ✗ ${f}`);
    }
  }

  return {
    total: evals.length,
    passed,
    failed,
    skipped,
    failures: failed,
    results,
  };
}

// ─── private — drive a skill end-to-end with mocked LLM ──────────

async function driveSkill(
  spec: EvalSpec,
  llm: LLMProvider,
  toolMocks: Record<string, (args: unknown) => unknown>,
  trace: EvalTrace
): Promise<void> {
  const skill = spec.skill;

  if (skill.type === 'script') {
    // ScriptSkills don't call LLM directly; treat the step subtitles as outputs.
    for (const step of skill.steps) {
      if (step.subtitle) trace.subtitles.push(step.subtitle);
    }
  } else if (skill.type === 'prompt') {
    // Resolve the prompt template with given vars, then a single LLM round.
    const prompt = resolvePrompt(skill, spec.vars ?? {});
    await llm.complete({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: spec.userInput },
      ],
    });
  } else if (skill.type === 'action') {
    // Build a stub ActionSkillContext with track-and-mock surfaces.
    await skill.handler(buildEvalActionContext(trace, toolMocks));
  } else if (skill.type === 'surface') {
    const surface = await skill.build(buildEvalActionContext(trace, toolMocks));
    trace.surfaces.push(surface);
  }
}

function resolvePrompt(skill: PromptSkill, vars: Record<string, string>): string {
  const merged = { ...skill.variables, ...vars };
  let p = skill.prompt;
  for (const [k, v] of Object.entries(merged)) {
    p = p.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), v);
  }
  return p;
}

function buildEvalActionContext(
  trace: EvalTrace,
  toolMocks: Record<string, (args: unknown) => unknown>
): import('./types').ActionSkillContext {
  return {
    getPreferences: () => ({}) as never,
    palette: {
      close: () => {},
      replace: (items) => trace.toolCalls.push({ tool: 'palette.replace', args: { items } }),
    },
    subtitle: {
      show: (opts) => trace.subtitles.push(opts.text),
      hide: () => {},
    },
    storage: {
      get: () => null,
      set: () => {},
    },
    navigate: (path) => trace.toolCalls.push({ tool: 'navigate', args: { path } }),
    agent: (task) => trace.toolCalls.push({ tool: 'agent', args: { task } }),
    llm: async (prompt) => {
      // Allow eval to mock specific tool calls
      const mock = toolMocks['llm'];
      return mock ? String(mock(prompt)) : '';
    },
  };
}

async function evaluateAssertions(assertions: EvalAssertion[], trace: EvalTrace): Promise<string[]> {
  const failures: string[] = [];
  for (const a of assertions) {
    switch (a.kind) {
      case 'includes':
        if (!trace.text.includes(a.substring) && !trace.subtitles.some((s) => s.includes(a.substring))) {
          failures.push(`expected output to include "${a.substring}"`);
        }
        break;
      case 'matches':
        if (!a.pattern.test(trace.text) && !trace.subtitles.some((s) => a.pattern.test(s))) {
          failures.push(`expected output to match ${a.pattern}`);
        }
        break;
      case 'callsTool':
        if (!trace.toolCalls.some((tc) => tc.tool === a.tool)) {
          failures.push(`expected tool "${a.tool}" to be called (got: ${trace.toolCalls.map((t) => t.tool).join(',') || 'none'})`);
        }
        break;
      case 'doesNotCallTool':
        if (trace.toolCalls.some((tc) => tc.tool === a.tool)) {
          failures.push(`expected tool "${a.tool}" NOT to be called`);
        }
        break;
      case 'meetsCriteria': {
        const ok = await a.check(trace);
        if (!ok) failures.push(`criteria not met: ${a.description}`);
        break;
      }
    }
  }
  if (trace.errors.length > 0) {
    failures.push(`errors during run: ${trace.errors.join('; ')}`);
  }
  return failures;
}
