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
  async makeTodos(input: PlanInput): Promise<TaskPlan> {
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
    let raw: string;
    try {
      const result = await llm.complete({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userParts.join('\n\n') },
        ],
        thinking: 'low',
        jsonMode: true,
        temperature: 0.2,
        signal: timeoutCtrl.signal,
      });
      raw = result.content;
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
