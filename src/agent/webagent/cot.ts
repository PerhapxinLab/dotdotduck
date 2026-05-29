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

/** One step inside a CoT turn — either narration text, a tool call, or
 *  an explicit end-of-loop signal.
 *
 *  Narrate carries an optional `about` selector — when set the runtime
 *  auto-borders that element BEFORE streaming the narrate text, so the
 *  model doesn't need to remember to chain a separate `border` action.
 *  Omit `about` only for wrap-up narrates not tied to any element.
 *
 *  `{ task_finish: true }` marks the user's whole request as complete
 *  AFTER this turn's prior actions run. The deliberately verbose name
 *  ("task_finish" rather than just "done") fights the previous
 *  misreading where the model treated it as "I'm done planning this
 *  turn" — it now reads as "the TASK has FINISHED". Without it, ending
 *  the loop requires a separate empty-actions turn, wasting a round-trip. */
export type TurnAction =
  | { narrate: string; about?: string }
  | { tool: string; args?: Record<string, unknown> }
  | { task_finish: true };

/** Full parsed turn response.
 *
 *  Three-field envelope by design. Earlier versions had a separate
 *  `next_goal` field but it was redundant with `todos_remaining[0]` and
 *  became a load-bearing source of inconsistency — when `todos_remaining`
 *  was empty the JSON Schema's `required` constraint forced the model
 *  to invent a "wrap-up" goal, which then justified a final summary
 *  narrate that the user had no use for. Dropping the field removes the
 *  buffer where that pathology lived. The chain now is literally
 *  `todos_remaining → actions`. */
export interface TurnResponse {
  /** Short progress note. ~1-2 sentences. Not shown to the user. */
  memory: string;
  /** Explicit checklist of what still needs to happen for the user's
   *  ORIGINAL request to be fully addressed. Evolves each turn — items
   *  added as discovered, removed as completed. When empty, this run
   *  is done and `actions` should be empty / omitted. */
  todos_remaining: string[];
  /** Ordered list of actions for THIS turn — the operations needed to
   *  knock the next item off `todos_remaining`. Optional: when there's
   *  nothing left to do (`todos_remaining` is empty), omit this field
   *  or set it to `[]` and the loop ends. */
  actions: TurnAction[];
}

/** Name of the synthetic tool that wraps every CoT turn. */
export const AGENT_TURN_TOOL = 'agent_turn';

/**
 * Render the tool reference (name + description + JSON Schema for args)
 * for every action exposed this turn. Lives on the SYSTEM prompt now —
 * the agent_turn tool description only carries the envelope shape so
 * we don't duplicate the tool list in two places the model has to read.
 */
export function renderToolReference(availableTools: readonly CotToolRef[]): string {
  return availableTools.map((t) => {
    const params = JSON.stringify(t.parameters);
    return `### \`${t.name}\`\n${t.description}\nargs schema (JSON Schema): ${params}`;
  }).join('\n\n');
}

/**
 * Tool definition the LLM sees when CoT mode is on. The runtime forces
 * `tool_choice: { type: 'function', function: { name: 'agent_turn' } }`
 * so every turn returns one (and only one) `agent_turn` call.
 */
export function buildAgentTurnTool(availableTools: readonly CotToolRef[]): ToolDefinition {
  const toolNames = availableTools.map((t) => t.name);

  return {
    name: AGENT_TURN_TOOL,
    description: `Your full response for this turn. Call exactly once; don't call any other tool directly. Envelope shape and tool reference live in the system prompt.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      // `actions` is intentionally NOT in `required` — when
      // todos_remaining is empty the run is done and the model should
      // be able to commit to an empty / omitted actions field WITHOUT
      // the schema pressuring it to fabricate a "wrap-up" entry.
      required: ['memory', 'todos_remaining'],
      properties: {
        memory: {
          type: 'string',
          description: 'Private 1-2 sentence progress recap. Structure: "Last turn: <what just finished>. Still remaining: <head of todos_remaining>". When the user\'s original TASK is fully covered, write "Task complete — emitting task_finish." and put `{task_finish: true}` as the last item in actions[]. Items already covered in previous turns are DONE WELL — never go back to re-explain, re-frame, or supplement them. DO NOT invent NEW todos based on what you see in the fresh DOM dump — todos are derived from the USER\'s original request, not from how much content the page has. If you find yourself wanting to add follow-up todos because "there is more to cover", that means the task is actually done — emit task_finish. NEVER ask the user a question they already answered earlier in this run — if memory or history shows they picked / typed / confirmed X, reuse X; do not re-ask after a tool failure. When a tool fails (selector not found, etc.), retry with a CORRECTED arg (e.g. a different selector from the DOM dump), not by restarting from the user.',
        },
        todos_remaining: {
          type: 'array',
          items: { type: 'string' },
          description: 'Concrete items still owed to the user\'s original request. Each turn: remove completed items, add newly-revealed items. No "verify user" / "confirm needed" / "supplementary" items. Empty array means the run is done — omit `actions` or set to [].',
        },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              narrate: {
                type: 'string',
                description: 'A short DECLARATIVE statement streamed into the subtitle bar — the CONTENT you want the user to read (a fact, a value, what an element shows, what something means). NOT a preview of your next move ("I will now...", "next we will see...", "let me show you..."). NOT a meta status ("thinking...", "processing...", "思考中...", "處理中...", "let me think...") — the runtime shows its own indicator, never narrate your own status. NOT a question (no `?` / `？`, no "would you like…"); questions go through the `ask_user_choice` tool action. For multi-item content (a list of plans, steps, options), use `\\n` newlines to split items onto separate lines for readability — never pack everything into one paragraph joined with "；" / "、" / commas.',
              },
              about: {
                type: 'string',
                description: 'Selector ([id] from DOM dump, or CSS) of the element this narrate describes. When set, the runtime auto-borders that element BEFORE streaming the narrate — no separate `border` tool call needed. REQUIRED whenever the narrate refers to anything visible on the page (a section, table, row, card, paragraph). Omit ONLY for narrates not tied to any specific element (rare).',
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
              task_finish: {
                type: 'boolean',
                description: 'Set this action to `{ "task_finish": true }` (no narrate / tool fields) to declare the user\'s TASK is FINISHED. Use ONLY when the original request is fully satisfied AND there is nothing more to do — typically as the LAST item in actions[] after a sequence of narrates that finished the task. DO NOT use task_finish in the same turn as `ask_user_choice` (the run continues after the user answers), `navigate` / `click` / `fill_input` (the page just changed, you need to react), or any tool whose result you have not yet acted on. task_finish = "the user\'s request has been completely satisfied" — not "I have planned my next step".',
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

  // The only hard parse requirement: a memory string. todos_remaining
  // and actions are both tolerated as missing — the chain naturally
  // terminates when either is empty.
  if (typeof r.memory !== 'string') return null;

  const todos_remaining: string[] = Array.isArray(r.todos_remaining)
    ? r.todos_remaining.filter((t): t is string => typeof t === 'string')
    : [];

  const actions: TurnAction[] = [];
  if (Array.isArray(r.actions)) {
    for (const a of r.actions) {
      if (!a || typeof a !== 'object') continue;
      const obj = a as Record<string, unknown>;
      if (typeof obj.narrate === 'string') {
        const about = typeof obj.about === 'string' && obj.about.trim().length > 0 ? obj.about.trim() : undefined;
        actions.push(about ? { narrate: obj.narrate, about } : { narrate: obj.narrate });
      } else if (typeof obj.tool === 'string') {
        const args = (obj.args && typeof obj.args === 'object') ? obj.args as Record<string, unknown> : {};
        // Strip the OpenAI-style `functions.` prefix that nano sometimes
        // leaks into the tool field even when the schema enum is strict.
        // The webagent dispatches by bare action name, so a leaked prefix
        // would resolve to `Unknown action: functions.immersive_translate`
        // and silently fail.
        const tool = obj.tool.replace(/^functions\./, '');
        actions.push({ tool, args });
      } else if (obj.task_finish === true) {
        actions.push({ task_finish: true });
      }
    }
  }
  return {
    memory: r.memory,
    todos_remaining,
    actions,
  };
}

/** Type guards. */
export function isNarrateAction(a: TurnAction): a is { narrate: string; about?: string } {
  return 'narrate' in a;
}
export function isToolAction(a: TurnAction): a is { tool: string; args?: Record<string, unknown> } {
  return 'tool' in a;
}
export function isTaskFinishAction(a: TurnAction): a is { task_finish: true } {
  return 'task_finish' in a && a.task_finish === true;
}
