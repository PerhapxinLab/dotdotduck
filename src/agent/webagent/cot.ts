/**
 * Structured CoT turn — per-turn schema that forces the model to emit
 * memory + next_goal BEFORE the action list.
 *
 * Wraps the entire turn response inside a single tool call (`agent_turn`)
 * with a strict JSON schema. The runtime parses the tool args, then
 * iterates `actions[]` in order — emitting `narrate` items to the subtitle
 * bar and dispatching `tool` items through the regular action handlers.
 *
 * Why a single wrapping tool rather than `response_format: json_schema`:
 *   - All providers (OpenAI / Anthropic / Gemini / DeepSeek) support
 *     forced tool calls with strict schemas; not all support json_schema
 *     response format yet.
 *   - Tool-call streaming gives us the function.arguments token stream
 *     we can incrementally parse for narration deltas.
 */

import type { ToolDefinition } from '../llm/types';

/**
 * Minimal tool reference passed to `buildAgentTurnTool`. The runtime
 * exposes each built-in action's `{ name, description, parameters }`
 * here so the model sees per-tool arg schemas inline in the agent_turn
 * description — without this, the model only saw tool names as an enum
 * and had to guess argument shapes (which manifested as `navigate` calls
 * with empty path, etc.).
 */
export interface CotToolRef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** One step inside a CoT turn — either narration text or a tool call. */
export type TurnAction =
  | { narrate: string }
  | { tool: string; args?: Record<string, unknown> };

/** Full parsed turn response. */
export interface TurnResponse {
  /** Short progress note. ~1-2 sentences. Not shown to the user. */
  memory: string;
  /** Explicit checklist of what still needs to happen for the user's
   *  ORIGINAL request to be fully addressed. Evolves each turn — items
   *  added as discovered, removed as completed. When empty, emit
   *  `actions: []` to end the loop. */
  todos_remaining: string[];
  /** One sentence describing what this turn aims to do. Not shown to
   *  the user; goes to the analytics intent stream. */
  next_goal: string;
  /** Ordered list of actions. Empty array ends the loop — use when
   *  `todos_remaining` is empty. */
  actions: TurnAction[];
}

/** Name of the synthetic tool that wraps every CoT turn. */
export const AGENT_TURN_TOOL = 'agent_turn';

/**
 * Tool definition the LLM sees when CoT mode is on. The runtime forces
 * `tool_choice: { type: 'function', function: { name: 'agent_turn' } }`
 * so every turn returns one (and only one) `agent_turn` call.
 *
 * The available action `tool` names are listed in `availableTools` —
 * we inject them as an enum so the model can't invent tool names.
 */
export function buildAgentTurnTool(availableTools: readonly CotToolRef[]): ToolDefinition {
  // Render each tool's name + description + the JSON Schema of its
  // required args, inline in the agent_turn description. Without this
  // the model saw only the tool names (as an enum) and had to guess the
  // arg shape — causing things like `{ tool: "navigate", args: {} }`
  // (no `path`) that fail silently at dispatch time.
  const toolReference = availableTools.map((t) => {
    const params = JSON.stringify(t.parameters);
    return `### \`${t.name}\`\n${t.description}\nargs schema (JSON Schema): ${params}`;
  }).join('\n\n');

  const toolNames = availableTools.map((t) => t.name);

  return {
    name: AGENT_TURN_TOOL,
    description: `Your full response for this turn. Call exactly once; don't call any other tool directly. Field semantics live in the system prompt — keep the values aligned with what's described there. Include all required args from each tool's schema below; empty args for a tool that needs them will be rejected.

# Tools

${toolReference}`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['memory', 'todos_remaining', 'next_goal', 'actions'],
      properties: {
        memory: {
          type: 'string',
          description: '1-2 sentences of progress notes. Private.',
        },
        todos_remaining: {
          type: 'array',
          items: { type: 'string' },
          description: 'Concrete items still owed to the user\'s original request. Each turn: remove completed items, add newly-revealed items. No "verify user" / "confirm needed" / "supplementary" items.',
        },
        next_goal: {
          type: 'string',
          description: 'What THIS turn accomplishes — sized to fit in this turn\'s actions[]. Not a multi-turn ambition.',
        },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              narrate: {
                type: 'string',
                description: 'Text streamed into the subtitle bar (one short prose sentence).',
              },
              tool: {
                type: 'string',
                enum: toolNames,
                description: 'Built-in tool name to dispatch. See the tool reference in this tool\'s description for the required args of each.',
              },
              args: {
                type: 'object',
                additionalProperties: true,
                description: 'Arguments for the tool. Required keys depend on the tool — see its schema in the description.',
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Parse the JSON args from an `agent_turn` tool call into a TurnResponse.
 * Tolerant of partial / malformed input — returns `null` if unparseable
 * so the runtime can yield an error event instead of throwing.
 */
export function parseTurnResponse(rawArgs: string | Record<string, unknown>): TurnResponse | null {
  let obj: unknown;
  if (typeof rawArgs === 'string') {
    try {
      obj = JSON.parse(rawArgs);
    } catch {
      return null;
    }
  } else {
    obj = rawArgs;
  }
  if (!obj || typeof obj !== 'object') return null;
  const r = obj as Partial<TurnResponse> & Record<string, unknown>;

  // Required string fields. If memory / next_goal missing → bail.
  if (typeof r.memory !== 'string') return null;
  if (typeof r.next_goal !== 'string') return null;
  if (!Array.isArray(r.actions)) return null;

  // Tolerate the array being missing/null — backfill to [] rather than
  // failing the whole parse. memory / next_goal / actions are still
  // required for parse to succeed (checked above).
  const todos_remaining: string[] = Array.isArray(r.todos_remaining)
    ? r.todos_remaining.filter((t): t is string => typeof t === 'string')
    : [];

  const actions: TurnAction[] = [];
  for (const a of r.actions) {
    if (!a || typeof a !== 'object') continue;
    const obj = a as Record<string, unknown>;
    if (typeof obj.narrate === 'string') {
      actions.push({ narrate: obj.narrate });
    } else if (typeof obj.tool === 'string') {
      const args = (obj.args && typeof obj.args === 'object') ? obj.args as Record<string, unknown> : {};
      actions.push({ tool: obj.tool, args });
    }
  }
  return {
    memory: r.memory,
    todos_remaining,
    next_goal: r.next_goal,
    actions,
  };
}

/** Type guards. */
export function isNarrateAction(a: TurnAction): a is { narrate: string } {
  return 'narrate' in a;
}
export function isToolAction(a: TurnAction): a is { tool: string; args?: Record<string, unknown> } {
  return 'tool' in a;
}
