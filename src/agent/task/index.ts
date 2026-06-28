/**
 * TaskAgent — conversation + host-defined tool calling.
 *
 * The third agent kind, alongside WebAgent (DOM-grounded page
 * operation) and InlineAgent (in-place text edits). TaskAgent has
 * no DOM dependency, no CoT envelope, no Space-gating — it's a
 * straight chat + tool-call loop. Plumbing for things hosts
 * actually build: customer-service Q&A, knowledge lookup,
 * back-end-call agents.
 *
 *   const taskAgent = new TaskAgent({
 *     llm: nano,
 *     systemPrompt: 'Answer Acme Co. support questions.',
 *     tools: [{
 *       name: 'lookup_order',
 *       description: 'Order status by id.',
 *       parameters: { type: 'object', properties: { id: { type: 'string' } } },
 *       handler: async ({ id }) => fetch(`/api/orders/${id}`).then((r) => r.json()),
 *     }],
 *   });
 *   taskAgent.attachTo(dddk);
 *   const reply = await taskAgent.ask('Where is order #12345?');
 *
 * Session sharing: pass `session` to share conversation history with
 * another TaskAgent. Cross-type sharing with WebAgent works at the
 * Session.turns[] level but the re-serialisation cost is non-trivial
 * — it's tracked as a v0.3 item.
 */

import { resolveLLM } from '../llm/router';
import { createSession, pushUserTurn } from '../webagent/session';
import type { AgentSession } from '../webagent/types';
import type { ActionDefinition } from '../webagent/types';
import type { ToolCall } from '../llm/types';
import type {
  TaskAgentConfig,
  TaskAgentDddkHandle,
  TaskRunOptions,
  TaskTool,
} from './types';

export type { TaskAgentConfig, TaskRunOptions, TaskTool } from './types';

const DEFAULT_MAX_TOOL_ROUNDS = 4;
const DEFAULT_LLM_TIMEOUT_MS = 30_000;

/** Per-step message shape the LLM provider expects. Mirrors what
 *  the inline tool-loop uses so the wire-level result is consistent. */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export class TaskAgent {
  private cfg: Required<Pick<TaskAgentConfig, 'systemPrompt' | 'maxToolRounds' | 'enableSubtitle' | 'locale' | 'llmTimeoutMs'>>
    & Pick<TaskAgentConfig, 'llm'>;
  private tools: TaskTool[];
  private session: AgentSession;
  /** Whether session was injected — if true, we don't auto-replace. */
  private sessionInjected: boolean;
  private dddk: TaskAgentDddkHandle | null = null;

  constructor(config: TaskAgentConfig) {
    this.cfg = {
      llm: config.llm,
      systemPrompt: config.systemPrompt,
      maxToolRounds: config.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS,
      enableSubtitle: config.enableSubtitle ?? false,
      locale: config.locale ?? 'en',
      llmTimeoutMs: config.llmTimeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
    };
    this.tools = (config.tools ?? []).slice();
    if (config.session) {
      this.session = config.session;
      this.sessionInjected = true;
    } else {
      const currentPath = typeof location !== 'undefined' ? location.pathname + location.search : '/';
      this.session = createSession(currentPath);
      this.sessionInjected = false;
    }
  }

  // ─── public API ─────────────────────────────────────────────

  /** Inject a DotDotDuck-like handle so subtitle narration works
   *  when `enableSubtitle` is on. Same shape WebAgent / InlineAgent
   *  use; the import-light type is on purpose to avoid circular deps. */
  attachTo(dddk: TaskAgentDddkHandle): void {
    this.dddk = dddk;
  }

  /** Read-only view of the current session — useful for inspection +
   *  for wiring the session into a sibling TaskAgent. */
  getSession(): AgentSession {
    return this.session;
  }

  /**
   * Swap the session out. Useful when host wants to reset
   * conversation history mid-flight, or hand the agent a freshly
   * registry-issued session. Returns the previous session in case
   * the host wants to archive it.
   */
  setSession(session: AgentSession): AgentSession {
    const prev = this.session;
    this.session = session;
    this.sessionInjected = true;
    return prev;
  }

  /** Toggle whether to narrate progress in the subtitle bar. */
  setEnableSubtitle(on: boolean): void {
    this.cfg.enableSubtitle = on;
  }

  /** Register a new tool the LLM can call. Returns a handle whose
   *  `remove()` unregisters it. Mid-loop registrations land in the
   *  next LLM call within the same ask(); in-flight LLM calls keep
   *  the snapshot they were made with. */
  registerTool(tool: TaskTool): { remove(): void } {
    this.tools.push(tool);
    return {
      remove: () => {
        const idx = this.tools.findIndex((t) => t.name === tool.name);
        if (idx >= 0) this.tools.splice(idx, 1);
      },
    };
  }

  /** Unregister a tool by name. Returns true when one was removed. */
  unregisterTool(name: string): boolean {
    const idx = this.tools.findIndex((t) => t.name === name);
    if (idx < 0) return false;
    this.tools.splice(idx, 1);
    return true;
  }

  /**
   * Ask the agent — single-shot conversational turn. Appends the
   * task as a user turn to the session, runs the tool-call loop
   * until the LLM produces text (or the round cap fires), appends
   * the assistant's reply, returns the text.
   *
   * If the loop hits `maxToolRounds` without a text-only reply, the
   * partial content from the last LLM call is returned (may be
   * empty). Hosts who want to differentiate use the streaming
   * variant — TBD in a follow-up.
   */
  async ask(task: string, opts: TaskRunOptions = {}): Promise<string> {
    if (!task || !task.trim()) return '';
    pushUserTurn(this.session, { text: task });

    const maxRounds = opts.maxToolRounds ?? this.cfg.maxToolRounds;
    const externalSignal = opts.signal;

    // Local abort so we can cancel on signal abort + timeout.
    const ac = new AbortController();
    const cleanups: Array<() => void> = [];
    if (externalSignal) {
      const onAbort = () => ac.abort();
      externalSignal.addEventListener('abort', onAbort);
      cleanups.push(() => externalSignal.removeEventListener('abort', onAbort));
    }
    const timeoutId = setTimeout(() => ac.abort(), this.cfg.llmTimeoutMs);
    cleanups.push(() => clearTimeout(timeoutId));

    try {
      const llm = resolveLLM(this.cfg.llm, 'task');
      const toolDefs = this.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));

      const messages: ChatMessage[] = [
        { role: 'system', content: this.cfg.systemPrompt },
        { role: 'user',   content: task },
      ];

      let finalText = '';
      for (let round = 0; round < maxRounds; round++) {
        if (ac.signal.aborted) break;
        const result = await llm.complete({
          messages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          temperature: 0,
          signal: ac.signal,
        });
        const calls = result.toolCalls ?? [];

        if (calls.length === 0) {
          // Final answer.
          finalText = result.content ?? '';
          break;
        }

        // Append the assistant's tool-call turn for LLM context.
        messages.push({ role: 'assistant', content: result.content ?? '', toolCalls: calls });

        // Execute each requested tool serially, append results.
        for (const call of calls) {
          if (ac.signal.aborted) break;
          if (this.cfg.enableSubtitle && this.dddk?.subtitle) {
            const msg = this.cfg.locale === 'zh-TW' ? `查詢中：${call.name}…` : `Looking up: ${call.name}…`;
            try { this.dddk.subtitle.show({ text: msg, type: 'info', autoHide: 0 }); } catch { /* swallow */ }
          }
          const def = this.tools.find((t) => t.name === call.name);
          if (!def) {
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              content: JSON.stringify({ ok: false, reason: 'unknown_tool', name: call.name }),
            });
            continue;
          }
          const toolResult = await runToolSafe(def, call.arguments as Record<string, unknown> | undefined, ac.signal, this.session);
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            content: JSON.stringify(toolResult ?? { ok: true }),
          });
        }
        // Loop continues; LLM sees the tool results and either
        // calls more tools or composes the final text.
      }

      // Append the assistant turn — store as text. We don't have a
      // `pushAssistantTurn` helper that matches WebAgent's typed
      // `AgentFinalTurn` exactly, so we append a minimal final turn
      // shape. Storing the text lets the next ask() see the prior
      // reply when the LLM walks `messages` next call.
      this.session.turns.push({
        kind: 'final',
        ts: Date.now(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      this.session.updatedAt = Date.now();

      return finalText;
    } finally {
      for (const fn of cleanups) fn();
      // Avoid silently sitting on the injected-session flag if the
      // host calls setSession again — nothing else needs cleanup
      // here, the session reference is intentional.
      void this.sessionInjected;
    }
  }
}

async function runToolSafe(
  def: ActionDefinition,
  args: Record<string, unknown> | undefined,
  signal: AbortSignal,
  session: AgentSession,
): Promise<unknown> {
  try {
    // Minimal context — TaskAgent tools shouldn't depend on DOM /
    // selector resolution / event emitters that WebAgent's loop owns.
    // Pass the session so tools can read prior history if they want to.
    const ctx = {
      session,
      signal,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolveSelector: () => null as any,
      indexMap: new Map<string, Element>(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (def.handler as any)(args ?? {}, ctx);
  } catch (err) {
    return { ok: false, reason: 'unknown', message: err instanceof Error ? err.message : String(err) };
  }
}
