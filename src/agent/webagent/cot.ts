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
  /** Combined evaluation + progress + todo. One short paragraph
   *  separated by '.' or '|' — no markdown. Not shown to the user. */
  memory: string;
  /** One sentence describing what this turn aims to do. Not shown
   *  to the user; goes to the analytics intent stream. */
  next_goal: string;
  /** Ordered list of actions. Empty array = task complete. */
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
    description: `Your full response for this turn. Call exactly once; don't call other tools directly.

- **memory** — last action result + progress so far + what's left.
- **next_goal** — one sentence for this turn.
- **actions** — ordered list of \`{narrate}\` or \`{tool, args}\`. \`actions: []\` ends the loop.

Include all required args from each tool's schema below. Empty args for a tool that needs them will be rejected.

# Tools

${toolReference}`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['memory', 'next_goal', 'actions'],
      properties: {
        memory: { type: 'string' },
        next_goal: { type: 'string' },
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
  const r = obj as Partial<TurnResponse>;
  if (typeof r.memory !== 'string') return null;
  if (typeof r.next_goal !== 'string') return null;
  if (!Array.isArray(r.actions)) return null;
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
  return { memory: r.memory, next_goal: r.next_goal, actions };
}

/** Type guards. */
export function isNarrateAction(a: TurnAction): a is { narrate: string } {
  return 'narrate' in a;
}
export function isToolAction(a: TurnAction): a is { tool: string; args?: Record<string, unknown> } {
  return 'tool' in a;
}
