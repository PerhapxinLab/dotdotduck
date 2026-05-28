/**
 * LLM Provider interface — implement once, providers slot in.
 * See ../../docs/03-llm-providers.md for the full design.
 */

export interface LLMProvider {
  readonly name: string;
  complete(opts: CompleteOptions): Promise<CompleteResult>;
}

export interface CompleteOptions {
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
  /**
   * Reasoning intensity. Provider-specific mapping:
   *   - OpenAI reasoning / gpt-5+ models → `reasoning_effort`
   *       'off' → 'minimal'
   *   - Gemini 2.5+ models → `generationConfig.thinkingConfig.thinkingBudget`
   *       'off' → 0
   *       'minimal' / 'low' → 64 / 512
   *       'medium' / 'high' → 1024 / 4096
   *   - Other / non-reasoning models → field is ignored
   *
   * Use `'off'` for short, deterministic tasks (inline text edits,
   * translation, classification) — saves cost and prevents the model
   * from leaking chain-of-thought into the response.
   */
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
  /**
   * Force the model to respond with a JSON object that parses cleanly.
   *   - OpenAI → `response_format: { type: 'json_object' }`
   *   - Gemini → `generationConfig.responseMimeType = 'application/json'`
   * Providers that don't support structured output ignore this; the prompt
   * itself should still say "Reply with JSON only" as a fallback.
   */
  jsonMode?: boolean;
  /**
   * Force which tool the model must call.
   *   - `'auto'` (default) — model picks zero or one tool
   *   - `'required'` — model must call exactly one tool (any tool in `tools`)
   *   - `{ name: 'foo' }` — model must call the named tool
   *
   * Used by the WebAgent's CoT mode to force the wrapping `agent_turn`
   * tool every turn. Providers that don't support targeted tool_choice
   * fall back to `'required'` or `'auto'`.
   */
  toolChoice?: 'auto' | 'required' | { name: string };
}

export interface CompleteResult {
  content: string;
  toolCalls?: ToolCall[];
  usage?: { promptTokens: number; completionTokens: number };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
}

export type LLMRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LLMMessage {
  role: LLMRole;
  content: string | ContentPart[];
  /** Set when role = 'tool' — the call this message answers. */
  toolCallId?: string;
  /** Set when role = 'assistant' — tool calls emitted in this turn. */
  toolCalls?: ToolCall[];
  /** Display name (optional, for multi-agent traces). */
  name?: string;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
