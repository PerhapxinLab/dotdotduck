/**
 * Structured CoT turn — per-turn schema that wraps the model's response
 * in a single `agent_turn` tool call with strict JSON schema.
 *
 * Schema property order matters for streaming: `actions` is always emitted
 * BEFORE `is_final` so the model fully commits to the work plan before
 * declaring the task complete.
 */

import type { ToolDefinition } from '../llm/types';

export interface CotToolRef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** One step inside a CoT turn — narration or a tool call. Finish is now a
 *  turn-level `is_final` boolean (see TurnResponse). The legacy
 *  `{ task_finish: true }` action is parsed for back-compat and folded
 *  into `is_final` on the parsed TurnResponse. */
export type TurnAction =
  | { narrate: string; about?: string }
  | { tool: string; args?: Record<string, unknown> };

/** Per-turn planning fields — present only in planned mode. browser-use's
 *  minimal validated set: previous-eval + next-goal. The top-level `memory`
 *  field on TurnResponse carries the progress recap. */
export interface TurnPlanning {
  evaluation_previous_goal: string;
  next_goal: string;
}

/** Mutations applied to `session.plan.todos` after this turn's actions
 *  run. NO insert — the master plan is locked at run start; mid-loop the
 *  model can only mark items done (`remove`) or rewrite stale ones
 *  (`replace`). */
export interface TodoAdjust {
  remove?: string[];
  replace?: Array<{ id: string; new_description: string; new_intent?: string }>;
}

/** Full parsed turn response. */
export interface TurnResponse {
  memory: string;
  todos_remaining?: string[];
  turn_planning?: TurnPlanning;
  todo_adjust?: TodoAdjust;
  actions: TurnAction[];
  /** True iff the user's original task has been fully satisfied by this
   *  turn's actions[]. Set ONLY after actions[] is complete. Ending a turn
   *  with `is_final: true` terminates the run; `false` (or omitted) keeps
   *  the loop going. */
  is_final?: boolean;
}

export const AGENT_TURN_TOOL = 'agent_turn';

export function renderToolReference(availableTools: readonly CotToolRef[]): string {
  return availableTools.map((t) => {
    const params = JSON.stringify(t.parameters);
    return `### \`${t.name}\`\n${t.description}\nargs schema (JSON Schema): ${params}`;
  }).join('\n\n');
}

export interface AgentTurnSchemaOptions {
  planned?: boolean;
}

export function buildAgentTurnTool(
  availableTools: readonly CotToolRef[],
  options: AgentTurnSchemaOptions = {},
): ToolDefinition {
  const toolNames = availableTools.map((t) => t.name);
  const planned = options.planned === true;
  const properties: Record<string, unknown> = {};

  properties.memory = {
    type: 'string',
    description: planned
      ? 'Private 1-2 sentence recap of what the previous turn tried and whether it worked. Read action_results from the previous tool message before writing. When previous turn ran ask_user / ask_user_choice / pause, recap MUST name the user\'s answer (e.g. "user picked Pro from {Hobby, Pro, Enterprise}"). A tool failure means this turn retries with a corrected arg, not moves on.'
      : 'Private 1-2 sentence progress recap. Describe forward motion only. Items already covered in previous turns are DONE — never go back to re-explain. When previous turn ran ask_user / ask_user_choice / pause, recap MUST name the user\'s answer; do NOT re-ask. Do not invent new todos because the DOM dump shows more than the user asked about. When a tool fails, retry with a corrected arg, not by restarting from the user.',
  };

  if (planned) {
    properties.turn_planning = {
      type: 'object',
      additionalProperties: false,
      required: ['evaluation_previous_goal', 'next_goal'],
      properties: {
        evaluation_previous_goal: {
          type: 'string',
          description: 'One short clause: what the previous turn tried and whether it succeeded or failed. When the previous turn ran ask_user / ask_user_choice / pause, restate the user\'s answer here in your own words BEFORE next_goal proposes what to do with it. For turn 1, say so explicitly.',
        },
        next_goal: {
          type: 'string',
          description: 'Anchor to a specific master-plan todo id and describe what this turn\'s actions[] will accomplish.',
        },
      },
      description: 'Per-turn planning fields.',
    };
    properties.todo_adjust = {
      type: 'object',
      additionalProperties: false,
      properties: {
        remove: {
          type: 'array',
          items: { type: 'string' },
          description: 'Master-plan todo ids the PREVIOUS turn completed.',
        },
        replace: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'new_description'],
            properties: {
              id: { type: 'string' },
              new_description: { type: 'string' },
              new_intent: { type: 'string' },
            },
          },
          description: 'Master todos whose description / intent no longer matches reality — rewrite in place (id preserved). No insert.',
        },
      },
      description: 'Mutations to the master plan. Both fields optional.',
    };
  } else {
    properties.todos_remaining = {
      type: 'array',
      items: { type: 'string' },
      description: 'Concrete items still owed to the user\'s original request. Each turn: remove completed items. No verification items, no "ask the user if they want more" items. Empty array ends the run.',
    };
  }

  properties.actions = {
    type: 'array',
    description: planned
      ? 'This turn\'s steps, in order. MUST be non-empty when the run is ongoing. Narrate / tool entries do the work; the loop continues until is_final is true.'
      : 'This turn\'s steps, in order. Empty / omitted ends the loop (legacy path).',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        narrate: {
          type: 'string',
          description: 'A short declarative statement streamed into the subtitle bar — the content the user should read. Not a preview of your next move. Not a meta status. Not a question (use the `ask_user_choice` tool). For multi-item content split items with `\\n` newlines.',
        },
        about: {
          type: 'string',
          description: 'Selector ([id] from DOM dump, or CSS) of the element this narrate describes. When set, the runtime auto-borders that element before streaming. Required whenever the narrate refers to anything visible on the page.',
        },
        tool: {
          type: 'string',
          enum: toolNames,
          description: 'Built-in tool name to dispatch. See the tool reference in the system prompt for each tool\'s required args.',
        },
        args: {
          type: 'object',
          additionalProperties: true,
          description: 'Arguments for the tool. Required keys depend on the tool.',
        },
      },
    },
  };

  properties.is_final = {
    type: 'boolean',
    description: 'Write this field LAST, AFTER actions[] is fully written. Set true ONLY when the original user request is now fully satisfied by the actions just emitted, and there is nothing more to do. False (or omitted) means the loop continues. Do not set true in the same turn as a tool whose result the next turn must observe (navigate / click / fill_input / ask_user_choice).',
  };

  // Schema requires actions and is_final in planned mode so the run has a
  // clear terminator. In legacy mode actions can be omitted to end the
  // loop (no is_final required).
  const required = planned
    ? ['memory', 'turn_planning', 'actions', 'is_final']
    : ['memory', 'todos_remaining'];

  return {
    name: AGENT_TURN_TOOL,
    description: `Your full response for this turn. Call exactly once; don't call any other tool directly. Property order: write memory, turn_planning, todo_adjust, actions FIRST, then is_final LAST.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required,
      properties,
    },
  };
}

/** Parse the JSON args from an `agent_turn` tool call. Tolerant of partial
 *  / malformed input — returns `null` if unparseable. Back-compat: the
 *  legacy `{ task_finish: true }` action and `will_finish_this_turn`
 *  planning flag both fold into the parsed `is_final`. */
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

  if (typeof r.memory !== 'string') return null;

  const todos_remaining: string[] | undefined = Array.isArray(r.todos_remaining)
    ? r.todos_remaining.filter((t): t is string => typeof t === 'string')
    : undefined;

  let legacyFinishFromPlanning = false;
  const turn_planning: TurnPlanning | undefined = (() => {
    const tp = r.turn_planning;
    if (!tp || typeof tp !== 'object') return undefined;
    const o = tp as unknown as Record<string, unknown>;
    if (o.will_finish_this_turn === true) legacyFinishFromPlanning = true;
    const epg = typeof o.evaluation_previous_goal === 'string'
      ? o.evaluation_previous_goal
      : typeof o.last_turn_outcome === 'string' ? o.last_turn_outcome : null;
    const ng = typeof o.next_goal === 'string'
      ? o.next_goal
      : typeof o.this_turn_does === 'string' ? o.this_turn_does : null;
    if (epg === null || ng === null) return undefined;
    return { evaluation_previous_goal: epg, next_goal: ng };
  })();

  const todo_adjust: TodoAdjust | undefined = (() => {
    const ta = r.todo_adjust;
    if (!ta || typeof ta !== 'object') return undefined;
    const o = ta as Record<string, unknown>;
    const remove = Array.isArray(o.remove)
      ? o.remove.filter((s): s is string => typeof s === 'string')
      : undefined;
    const replace = Array.isArray(o.replace)
      ? (o.replace as unknown[]).flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return [];
          const e = entry as Record<string, unknown>;
          if (typeof e.id !== 'string' || typeof e.new_description !== 'string') return [];
          const out: { id: string; new_description: string; new_intent?: string } = {
            id: e.id,
            new_description: e.new_description,
          };
          if (typeof e.new_intent === 'string') out.new_intent = e.new_intent;
          return [out];
        })
      : undefined;
    if (!remove?.length && !replace?.length) return undefined;
    return { remove, replace };
  })();

  const actions: TurnAction[] = [];
  let legacyFinishFromAction = false;
  if (Array.isArray(r.actions)) {
    for (const a of r.actions) {
      if (!a || typeof a !== 'object') continue;
      const obj = a as Record<string, unknown>;
      if (typeof obj.narrate === 'string') {
        const about = typeof obj.about === 'string' && obj.about.trim().length > 0 ? obj.about.trim() : undefined;
        actions.push(about ? { narrate: obj.narrate, about } : { narrate: obj.narrate });
      } else if (typeof obj.tool === 'string') {
        const args = (obj.args && typeof obj.args === 'object') ? obj.args as Record<string, unknown> : {};
        const tool = obj.tool.replace(/^functions\./, '');
        actions.push({ tool, args });
      } else if (obj.task_finish === true) {
        legacyFinishFromAction = true;
      }
    }
  }

  const isFinal = r.is_final === true || legacyFinishFromAction || legacyFinishFromPlanning;

  const out: TurnResponse = { memory: r.memory, actions };
  if (todos_remaining !== undefined) out.todos_remaining = todos_remaining;
  if (turn_planning) out.turn_planning = turn_planning;
  if (todo_adjust) out.todo_adjust = todo_adjust;
  if (isFinal) out.is_final = true;
  return out;
}

export function isNarrateAction(a: TurnAction): a is { narrate: string; about?: string } {
  return 'narrate' in a;
}
export function isToolAction(a: TurnAction): a is { tool: string; args?: Record<string, unknown> } {
  return 'tool' in a;
}
