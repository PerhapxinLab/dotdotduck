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

/** Per-turn planning fields — present only when the webagent run started
 *  with a pre-loop `Plan.makeTodos()` call. They force the model to be
 *  explicit about what last turn did, what this turn is doing, and
 *  whether this turn closes the run. Without them ("legacy" mode), the
 *  model just emits `memory + todos_remaining`. */
export interface TurnPlanning {
  /** What did the previous turn try, and did it work? Read action_results
   *  from the prior tool message before writing. */
  last_turn_outcome: string;
  /** Briefly describe what you see on the page RIGHT NOW from the latest
   *  DOM dump — chunks, sections, anything that informs this turn's pick. */
  current_page_observation: string;
  /** What this turn's actions[] will accomplish — anchor to a specific
   *  todo id from the master plan. */
  this_turn_does: string;
  /** True iff this turn's actions[] ends with `{task_finish: true}`. */
  will_finish_this_turn: boolean;
}

/** Mutations applied to `session.plan.todos` after this turn's actions
 *  run. NO insert — the master plan is locked at run start; mid-loop the
 *  model can only mark items done (`remove`) or rewrite stale ones
 *  (`replace`). If the plan was wildly wrong, the model uses `replace`
 *  aggressively rather than adding new entries. */
export interface TodoAdjust {
  /** Master todo ids the previous turn completed. */
  remove?: string[];
  /** Master todos whose description / intent diverged from reality —
   *  rewrite in place (id preserved). */
  replace?: Array<{ id: string; new_description: string; new_intent?: string }>;
}

/** Full parsed turn response. Two modes:
 *
 *  - **legacy** — `memory + todos_remaining + actions`. Used when
 *    `WebAgentConfig.planner` is unset; the model carries the plan in
 *    `todos_remaining`.
 *  - **planned** — `memory + turn_planning + todo_adjust + actions`.
 *    Used when a pre-loop planner produced a `session.plan.todos`
 *    master list. The model reads the master plan as context, declares
 *    this turn's intent via `turn_planning`, and mutates the master via
 *    `todo_adjust`. */
export interface TurnResponse {
  /** Short progress note. ~1-2 sentences. */
  memory: string;
  /** Legacy mode only. */
  todos_remaining?: string[];
  /** Planned mode only. */
  turn_planning?: TurnPlanning;
  /** Planned mode only. */
  todo_adjust?: TodoAdjust;
  /** This turn's actions, in order. */
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
/** Whether the webagent run has a master plan attached. Controls which
 *  envelope shape the model is asked for: legacy (todos_remaining) vs
 *  planned (turn_planning + todo_adjust). */
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
      ? 'Private 1-2 sentence recap: "Last turn: <what was tried> — <succeeded | failed: reason>." Read action_results from the previous tool message before writing. A failure means the NEXT turn should retry with a corrected arg, not move on.'
      : 'Private 1-2 sentence progress recap. Structure: "Last turn: <what just finished>. Still remaining: <head of todos_remaining>". When the user\'s original TASK is fully covered, write "Task complete — emitting task_finish." and put `{task_finish: true}` as the last item in actions[]. Items already covered in previous turns are DONE WELL — never go back to re-explain, re-frame, or supplement them. DO NOT invent NEW todos based on what you see in the fresh DOM dump — todos are derived from the USER\'s original request, not from how much content the page has. If you find yourself wanting to add follow-up todos because "there is more to cover", that means the task is actually done — emit task_finish. NEVER ask the user a question they already answered earlier in this run — if memory or history shows they picked / typed / confirmed X, reuse X; do not re-ask after a tool failure. When a tool fails (selector not found, etc.), retry with a CORRECTED arg (e.g. a different selector from the DOM dump), not by restarting from the user.',
  };

  if (planned) {
    properties.turn_planning = {
      type: 'object',
      additionalProperties: false,
      required: ['last_turn_outcome', 'current_page_observation', 'this_turn_does', 'will_finish_this_turn'],
      properties: {
        last_turn_outcome: {
          type: 'string',
          description: 'Brief: "Last turn navigated to /commercial — success" / "Last turn clicked [a1b2] — failed: not_found". For turn 1, write "N/A — first turn".',
        },
        current_page_observation: {
          type: 'string',
          description: 'Brief: what the latest DOM dump shows that informs this turn — chunks present, what changed since last turn, anything that confirms or contradicts the master plan.',
        },
        this_turn_does: {
          type: 'string',
          description: 'Anchor to a specific master-plan todo id and describe what THIS turn\'s actions[] will accomplish. Example: "t2 — narrate the 商業授權 card".',
        },
        will_finish_this_turn: {
          type: 'boolean',
          description: 'True iff this turn\'s actions[] ends with `{task_finish: true}` (i.e. the LAST todo of the master plan is being completed now).',
        },
      },
      description: 'Per-turn planning fields. Forces explicit "last did / now seeing / now doing / will finish?" framing so the model never confuses this-turn vs next-turn work.',
    };
    properties.todo_adjust = {
      type: 'object',
      additionalProperties: false,
      properties: {
        remove: {
          type: 'array',
          items: { type: 'string' },
          description: 'Master-plan todo ids the PREVIOUS turn completed. Removed from the live list before this turn\'s actions run.',
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
          description: 'Master todos whose description / intent no longer matches reality — rewrite in place (id preserved). NO insert — if the original plan missed something, use replace to morph an existing todo; the master list size is locked at run start.',
        },
      },
      description: 'Mutations to the master plan applied before this turn\'s actions run. Both fields optional.',
    };
  } else {
    properties.todos_remaining = {
      type: 'array',
      items: { type: 'string' },
      description: 'Concrete items still owed to the user\'s original request. Each turn: remove completed items, add newly-revealed items. No "verify user" / "confirm needed" / "supplementary" items. Empty array means the run is done — omit `actions` or set to [].',
    };
  }

  properties.actions = {
    type: 'array',
    description: planned
      ? 'This turn\'s steps, in order. MUST be non-empty. Either narrate / tool entries to do work (then loop continues), OR `[..., {task_finish: true}]` as the LAST entry to end the run. Omitting actions ends the run with no work done — almost never what you want in planned mode.'
      : 'This turn\'s steps, in order. Empty / omitted ends the loop (legacy path).',
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
  };

  // In legacy mode, `actions` is intentionally NOT in `required` — an
  // empty / omitted actions array is the valid end-of-loop signal.
  // In planned mode there's no `todos_remaining`, so the ONLY way to
  // end the loop is `{task_finish: true}` inside actions[]; therefore
  // actions becomes required + must be non-empty (description enforces
  // the non-empty constraint).
  const required = planned
    ? ['memory', 'turn_planning', 'actions']
    : ['memory', 'todos_remaining'];

  return {
    name: AGENT_TURN_TOOL,
    description: `Your full response for this turn. Call exactly once; don't call any other tool directly. Envelope shape and tool reference live in the system prompt.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required,
      properties,
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

  // The only hard parse requirement: a memory string. Everything else is
  // tolerated as missing — the chain naturally terminates when actions
  // is empty.
  if (typeof r.memory !== 'string') return null;

  const todos_remaining: string[] | undefined = Array.isArray(r.todos_remaining)
    ? r.todos_remaining.filter((t): t is string => typeof t === 'string')
    : undefined;

  const turn_planning: TurnPlanning | undefined = (() => {
    const tp = r.turn_planning;
    if (!tp || typeof tp !== 'object') return undefined;
    const o = tp as Record<string, unknown>;
    if (
      typeof o.last_turn_outcome !== 'string'
      || typeof o.current_page_observation !== 'string'
      || typeof o.this_turn_does !== 'string'
    ) return undefined;
    return {
      last_turn_outcome: o.last_turn_outcome,
      current_page_observation: o.current_page_observation,
      this_turn_does: o.this_turn_does,
      will_finish_this_turn: o.will_finish_this_turn === true,
    };
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
  const out: TurnResponse = { memory: r.memory, actions };
  if (todos_remaining !== undefined) out.todos_remaining = todos_remaining;
  if (turn_planning) out.turn_planning = turn_planning;
  if (todo_adjust) out.todo_adjust = todo_adjust;
  return out;
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
