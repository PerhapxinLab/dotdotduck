/**
 * v0.2.0 ROADMAP 2.6 — multi-step transaction skill pattern.
 *
 * Some product flows aren't a one-shot agent task. They're transactions:
 * step 1 needs to land BEFORE step 2 runs (e.g. create draft → add line
 * items → submit), and if step 3 fails the host wants to roll back what
 * steps 1+2 did.
 *
 * Existing `ScriptSkill.steps` runs forward only. This module adds a
 * `TransactionStep` extension where each step can:
 *   - declare an `assert` predicate that gates progress to the next step
 *     (returns false → step is treated as failed)
 *   - declare a `compensate` rollback handler — on later failure, the
 *     runner replays compensators of completed steps in REVERSE order
 *
 * Use:
 *
 *   import { runTransaction } from '@perhapxin/dddk';
 *
 *   const outcome = await runTransaction({
 *     tools,                       // SkillTools from a Script skill
 *     steps: [
 *       {
 *         name: 'create_draft',
 *         action: async (t) => t.navigate('/orders/new'),
 *         assert: () => location.pathname.startsWith('/orders/new'),
 *         compensate: async (t) => t.navigate('/orders'),
 *       },
 *       {
 *         name: 'add_line',
 *         action: async (t) => t.navigate('/orders/new/line'),
 *         assert: () => document.querySelector('.line-row') != null,
 *         compensate: async () => { console.info('cleanup line-add'); },
 *       },
 *     ],
 *   });
 *
 *   if (!outcome.ok) {
 *     console.warn('transaction failed:', outcome.failedStep, outcome.error);
 *     // outcome.compensated lists the names of compensators that ran.
 *   }
 *
 * Compensators are best-effort: a throwing compensator is logged and
 * the runner continues to the next one, so a partial rollback is
 * better than no rollback.
 */

import type { SkillTools } from './types';

export interface TransactionStep {
  name: string;
  action: (tools: SkillTools) => void | Promise<void>;
  /** Optional gate — return true to advance, false to treat the step as
   *  failed. Default = true (no gate). Synchronous only for now. */
  assert?: () => boolean;
  /** Rollback handler. Runs in reverse order on later failure. */
  compensate?: (tools: SkillTools) => void | Promise<void>;
  /** Delay (ms) after the action before evaluating `assert`. Default 80. */
  settleMs?: number;
}

export interface TransactionOpts {
  tools: SkillTools;
  steps: TransactionStep[];
  /** Optional signal — if aborted, the runner halts AND replays
   *  compensators for completed steps. */
  signal?: AbortSignal;
}

export interface TransactionOutcome {
  ok: boolean;
  /** Names of steps whose action completed (and assert passed). */
  completed: string[];
  /** Set when ok=false: the step that failed. */
  failedStep: string | null;
  /** Set when ok=false: error or reason. */
  error: string | null;
  /** Names of compensators that ran during rollback (reverse order). */
  compensated: string[];
}

export async function runTransaction(opts: TransactionOpts): Promise<TransactionOutcome> {
  const { tools, steps, signal } = opts;
  const completed: TransactionStep[] = [];

  for (const step of steps) {
    if (signal?.aborted) {
      const compensated = await rollback(completed, tools);
      return { ok: false, completed: completed.map((s) => s.name), failedStep: step.name, error: 'aborted', compensated };
    }
    try {
      await step.action(tools);
    } catch (e) {
      const compensated = await rollback(completed, tools);
      return {
        ok: false,
        completed: completed.map((s) => s.name),
        failedStep: step.name,
        error: e instanceof Error ? e.message : String(e),
        compensated,
      };
    }
    if (step.settleMs !== 0) {
      await new Promise((r) => setTimeout(r, step.settleMs ?? 80));
    }
    if (step.assert) {
      let passed: boolean;
      try { passed = step.assert(); } catch { passed = false; }
      if (!passed) {
        const compensated = await rollback(completed, tools);
        return {
          ok: false,
          completed: completed.map((s) => s.name),
          failedStep: step.name,
          error: 'assert failed',
          compensated,
        };
      }
    }
    completed.push(step);
  }
  return {
    ok: true,
    completed: completed.map((s) => s.name),
    failedStep: null,
    error: null,
    compensated: [],
  };
}

async function rollback(completed: TransactionStep[], tools: SkillTools): Promise<string[]> {
  const ran: string[] = [];
  for (let i = completed.length - 1; i >= 0; i--) {
    const step = completed[i]!;
    if (!step.compensate) continue;
    try {
      await step.compensate(tools);
      ran.push(step.name);
    } catch {
      // Compensator threw — keep going so a partial rollback still
      // happens. The caller sees this step missing from `compensated`.
    }
  }
  return ran;
}
