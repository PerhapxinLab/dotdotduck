/**
 * Plan — structured-artifact module. Owns two in-memory artifacts:
 *
 *   - `todos`     — `TodoItem[]` consumed by the webagent loop as its
 *                   master plan; mutated mid-loop via per-turn envelope
 *                   ops (the runtime translates envelope `todo_adjust`
 *                   to `todos.delete` / `todos.edit` here).
 *   - `markdown`  — `MarkdownDoc[]` for host-driven authoring surfaces
 *                   (meeting notes, drafts). Not used by the webagent.
 *
 * One LLM-mediated entry point lives here directly: `makeTodos(input)` —
 * a single planning call that produces a `TaskPlan` and seeds `todos`.
 * Hosts wire this into `webagent.planner` so the webagent runs a planning
 * pass before entering the turn loop.
 *
 * Two attach points:
 *   - `attachTo(dddk)` — exposes `dddk.plan` so anywhere in the host
 *     can read the artifacts or call CRUD without holding the instance
 *     reference. Same pattern as ImmersiveTranslate / Dwell.
 *   - `webagent.planner: (input) => plan.makeTodos(input)` — callback
 *     pattern, so the webagent has no hard dep on the Plan class.
 *
 * Storage: in-memory by default. Pass `storage` (an object with
 * `load()` / `save()`) to persist across reloads — same shape as
 * ImmersiveTranslate's cache option.
 */

import { resolveLLM, type LLMSource } from '../llm/router';
import type { CompleteResult } from '../llm/types';
import { stripCodeFence } from '../../utils/llm-parse';
import type { DotDotDuck } from '../../orchestrator';
import { buildPlanSystemPrompt } from './prompt';
import { TodosArtifact } from './todos';
import { MarkdownArtifact } from './markdown';
import type {
  PlanInput,
  PlanSnapshot,
  PlanStorageAdapter,
  TaskPlan,
  TodoItem,
} from './types';

export type { PlanInput, TaskPlan, TodoItem } from './types';
export type { MarkdownDoc, PlanSnapshot, PlanStorageAdapter } from './types';
export { TodosArtifact } from './todos';
export { MarkdownArtifact } from './markdown';

export interface PlanConfig {
  /** LLM source for the planning call AND markdown LLM edits. Single
   *  provider OR a router — when a router, the `plan` role is used and
   *  falls back to `webagent` if not registered. */
  llm: LLMSource;
  /** Extra strategic context appended to the SDK base planning prompt —
   *  sitemap mental model, tour playbook, route-routing logic. Same idea
   *  as `WebAgentConfig.appendSystemPrompt` but for the planning layer. */
  appendSystemPrompt?: string;
  /** Hard-replace the SDK planning prompt entirely. Rare — most hosts
   *  just use `appendSystemPrompt`. */
  systemPrompt?: string;
  /** Display name shown to the user / used in the planner self-intro. */
  agentName?: string;
  /** Optional storage adapter for cross-reload persistence. */
  storage?: PlanStorageAdapter;
}

const PLAN_TIMEOUT_MS = 30_000;

export class Plan {
  readonly todos: TodosArtifact;
  readonly markdown: MarkdownArtifact;
  private readonly config: PlanConfig;
  private readonly storage?: PlanStorageAdapter;
  private hydrated = false;

  constructor(config: PlanConfig) {
    this.config = config;
    this.storage = config.storage;

    this.todos = new TodosArtifact({
      onChange: () => this.persist(),
    });
    this.markdown = new MarkdownArtifact({
      llm: resolveLLM(config.llm, 'inline'),
      onChange: () => this.persist(),
    });
  }

  /**
   * Wire to the orchestrator so callers can do `dddk.plan.todos.list()`
   * without holding the Plan reference. Idempotent — re-attaching
   * replaces the previous binding.
   */
  attachTo(dddk: DotDotDuck): void {
    (dddk as unknown as { plan: Plan }).plan = this;
    // Best-effort hydration — if storage is provided, restore artifacts
    // now so the first webagent run sees prior state.
    void this.hydrate();
  }

  /**
   * One planning call → produces a TaskPlan and seeds `todos`.
   * Wire this into `webagent.planner` so the webagent runs a planning
   * pass before the turn loop.
   */
  async makeTodos(input: PlanInput & {
    /**
     * v0.2.0 streaming hook: invoked synchronously for each new character
     * of the `task_summary` field AS the LLM types it. Lets the host
     * stream the announcement into a subtitle bar instead of getting one
     * monolithic post-parse blast. Optional — when omitted, the planning
     * call still streams under the hood (so the LLM proxy doesn't buffer
     * via Cloudflare AI-Gateway cache) but the host sees the same final
     * `TaskPlan` it always did.
     */
    onSummaryDelta?: (delta: string) => void;
  }): Promise<TaskPlan> {
    const llm = resolveLLM(this.config.llm, 'plan');
    const system = this.config.systemPrompt ?? buildPlanSystemPrompt({
      locale: input.locale,
      agentName: this.config.agentName,
      sitemap: input.sitemap,
      brand: input.brand,
      persona: input.persona,
      appendSystemPrompt: this.config.appendSystemPrompt,
    });

    const userParts: string[] = [`# User task\n\n${input.task}`];
    if (input.selection?.text) {
      userParts.push(`# User selection at invocation\n\n"""\n${input.selection.text}\n"""`);
    }
    if (input.hostContext) {
      userParts.push(`# Host context\n\n${input.hostContext}`);
    }

    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort('plan timeout'), PLAN_TIMEOUT_MS);
    let raw = '';
    try {
      const completeOpts = {
        messages: [
          { role: 'system' as const, content: system },
          { role: 'user' as const, content: userParts.join('\n\n') },
        ],
        thinking: 'low' as const,
        jsonMode: true,
        temperature: 0.2,
        signal: timeoutCtrl.signal,
      };
      // Prefer streaming so Cloudflare AI-Gateway doesn't buffer the
      // whole response under cf-aig-cache-ttl. Streamer scans the
      // incremental JSON for `task_summary` chars and surfaces them
      // synchronously to the host via `onSummaryDelta`.
      const streamable = llm as { streamComplete?: (o: typeof completeOpts) => AsyncIterable<{ delta?: string; text: string }> & Promise<CompleteResult> };
      if (typeof streamable.streamComplete === 'function') {
        let fragCount = 0;
        const streamer = new TaskSummaryStreamer((delta) => {
          // Log every char of task_summary as it streams in so the
          // user can see real-time arrival in console — not just
          // the post-parse "[dddk webagent] planning result" blast.
          console.info('[dddk stream] plan summary_delta', { char: delta });
          input.onSummaryDelta?.(delta);
        });
        const handle = streamable.streamComplete(completeOpts);
        for await (const chunk of handle) {
          if (chunk.delta) {
            fragCount += 1;
            streamer.feed(chunk.delta);
          }
          raw = chunk.text;
        }
        streamer.finish();
        console.info(`[dddk stream] plan stream ended after ${fragCount} fragments`);
      } else {
        const result = await llm.complete(completeOpts);
        raw = result.content;
      }
    } finally {
      clearTimeout(timer);
    }

    const plan = parseTaskPlan(raw);
    if (!plan) {
      throw new Error(`Plan: planner returned unparseable JSON. Raw: ${raw.slice(0, 200)}`);
    }
    // Seed todos with the planner's output, replacing any prior list.
    this.todos.reset(plan.todos);
    return plan;
  }

  /** Snapshot current state — used by storage adapter + host inspection. */
  snapshot(): PlanSnapshot {
    return {
      todos: this.todos.list(),
      markdownDocs: this.markdown.list(),
    };
  }

  // ─── storage plumbing ─────────────────────────────────────────

  private async hydrate(): Promise<void> {
    if (this.hydrated || !this.storage) return;
    this.hydrated = true;
    try {
      const snap = await this.storage.load();
      if (!snap) return;
      this.todos.reset(snap.todos);
      // Markdown re-seed bypasses notify (we'd double-fire). Reconstruct
      // via a fresh artifact + swap — simplest correct path.
      for (const doc of snap.markdownDocs) {
        this.markdown.create({ title: doc.title, content: doc.content });
      }
    } catch (err) {
      console.warn('[dddk plan] hydrate failed', err);
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const result = this.storage.save(this.snapshot());
      if (result instanceof Promise) result.catch((err) => console.warn('[dddk plan] persist failed', err));
    } catch (err) {
      console.warn('[dddk plan] persist failed', err);
    }
  }
}

/**
 * Tiny streaming JSON scanner — finds `"task_summary":"..."` in an
 * incrementally-arriving stream of chars, calls `onDelta` for each
 * newly-revealed character of the summary's value. Robust to:
 *   - JSON key arriving before / split across chunks
 *   - Backslash-escaped quotes inside the value
 *   - Schema preamble before task_summary (e.g. todos first)
 *
 * Once the closing quote is found we stop scanning — todos / other
 * fields are irrelevant for the announcement UI.
 *
 * Pure char walker — no JSON.parse, so partial JSON never throws.
 */
class TaskSummaryStreamer {
  private buf = '';
  private pos = 0;
  private state: 'before' | 'inside' | 'done' = 'before';
  private prevEscape = false;
  private readonly onDelta: ((delta: string) => void) | undefined;

  constructor(onDelta?: (delta: string) => void) {
    this.onDelta = onDelta;
  }

  feed(chunk: string): void {
    if (this.state === 'done' || !this.onDelta) {
      // Still let scanning consume buf so finish() doesn't double-process,
      // but skip the emit cost when there's no listener.
      this.buf += chunk;
      return;
    }
    this.buf += chunk;
    this.scan();
  }

  finish(): void {
    if (this.state === 'inside') this.scan();
  }

  private scan(): void {
    if (this.state === 'before') {
      const m = this.buf.slice(this.pos).match(/"task_summary"\s*:\s*"/);
      if (!m) {
        // Trim consumed prefix to keep buf bounded — leave a safety
        // window for the key sequence to straddle chunk boundaries.
        const trimAt = Math.max(0, this.buf.length - 32);
        if (trimAt > this.pos) {
          this.buf = this.buf.slice(trimAt);
          this.pos = 0;
        }
        return;
      }
      this.pos += m.index! + m[0].length;
      this.state = 'inside';
    }
    if (this.state === 'inside') {
      let emitFrom = this.pos;
      while (this.pos < this.buf.length) {
        const ch = this.buf.charAt(this.pos);
        if (this.prevEscape) {
          this.prevEscape = false;
          this.pos += 1;
          continue;
        }
        if (ch === '\\') {
          this.prevEscape = true;
          this.pos += 1;
          continue;
        }
        if (ch === '"') {
          // Flush any chars we haven't emitted, then close.
          if (this.onDelta && this.pos > emitFrom) {
            this.onDelta(this.unescapeJson(this.buf.slice(emitFrom, this.pos)));
          }
          this.state = 'done';
          return;
        }
        this.pos += 1;
      }
      // Reached end of buf without a closing quote — emit what we have
      // (minus the last char if it's a lone backslash mid-escape).
      const emitTo = this.prevEscape ? this.pos - 1 : this.pos;
      if (this.onDelta && emitTo > emitFrom) {
        this.onDelta(this.unescapeJson(this.buf.slice(emitFrom, emitTo)));
      }
    }
  }

  private unescapeJson(s: string): string {
    return s
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

function parseTaskPlan(raw: string): TaskPlan | null {
  const trimmed = stripCodeFence(raw).trim();
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.task_summary !== 'string') return null;
  if (!Array.isArray(o.todos)) return null;
  const todos: Omit<TodoItem, 'id'>[] = [];
  for (const entry of o.todos as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const description = typeof e.description === 'string' ? e.description : '';
    if (!description) continue;
    const intent = typeof e.intent === 'string' ? e.intent : 'narrate';
    const expected_turn = typeof e.expected_turn === 'number' ? e.expected_turn : undefined;
    todos.push({ intent, description, expected_turn });
  }
  if (todos.length === 0) return null;
  // Assign ids after parse so they're stable AND match the artifact's
  // future creates (which start from idCounter).
  const planTodos: TodoItem[] = todos.map((t, i) => ({ id: `t${i + 1}`, ...t }));
  return {
    task_summary: o.task_summary,
    todos: planTodos,
  };
}
