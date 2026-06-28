/**
 * TaskAgent types. Plain-protocol agent — conversation + host-defined
 * tool calling, NO DOM dump, NO CoT envelope. Lives beside WebAgent
 * and InlineAgent as the third agent kind. v0.2.0 · Wave 2·B.
 */

import type { LLMSource } from '../llm/router';
import type { ActionDefinition } from '../webagent/types';
import type { AgentSession } from '../webagent/types';

/** A tool the TaskAgent can call. Same shape as a webagent action so
 *  hosts can reuse definitions across both agents. */
export type TaskTool = ActionDefinition;

export interface TaskAgentConfig {
  /** LLM provider or router. Must support tool-calling. */
  llm: LLMSource;
  /**
   * System prompt the LLM sees on every turn. Should describe the
   * agent's job (Q&A, customer service, knowledge lookup) and the
   * tools available. Tools are also appended programmatically — your
   * prompt doesn't need to enumerate them.
   */
  systemPrompt: string;
  /**
   * Tools the LLM can call. Empty array is fine (pure Q&A bot). Each
   * tool's `handler` receives the parsed arguments and returns the
   * result the LLM sees in the next turn.
   */
  tools?: TaskTool[];
  /**
   * Inject a shared `AgentSession` so this TaskAgent's history is
   * visible to other TaskAgents (or — in v0.3 — to a WebAgent
   * sharing the same session). Defaults to a fresh session per
   * agent.
   */
  session?: AgentSession;
  /**
   * Cap on the tool-call loop within a single `ask()`. Default 4.
   * Hosts with chained lookups (search → fetch → verify → answer)
   * may bump to 6. The cap is a safety net — most asks resolve in 1-2
   * rounds.
   */
  maxToolRounds?: number;
  /**
   * Narrate progress to the subtitle bar between tool calls
   * ("Looking up customer record…"). Requires `attachTo(dddk)`.
   * Default `false`.
   */
  enableSubtitle?: boolean;
  /** Locale for built-in narration strings. Default `'en'`. */
  locale?: string;
  /** Per-turn LLM call timeout. Default 30s. */
  llmTimeoutMs?: number;
}

export interface TaskRunOptions {
  /** Override the configured maxToolRounds for this single call. */
  maxToolRounds?: number;
  /** Abort signal — the loop bails ASAP when triggered. */
  signal?: AbortSignal;
}

/** Minimum the TaskAgent needs from a DotDotDuck handle. Avoids a
 *  circular import on the orchestrator type. */
export interface TaskAgentDddkHandle {
  subtitle?: {
    show(opts: { text: string; type: 'agent' | 'info' | 'narration' | 'system'; autoHide?: number }): void;
    finalizeStreamed?(opts: { autoHide: number }): void;
  };
}
