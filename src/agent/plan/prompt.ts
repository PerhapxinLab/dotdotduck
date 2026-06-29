/**
 * Planning system prompt — built once per `Plan.makeTodos()` call.
 *
 * Conceptual split: this prompt is STRATEGIC (sitemap, brand, persona,
 * site mental model). The webagent per-turn prompt is TACTICAL (envelope
 * shape, tool reference, current DOM). The planner runs ONCE per agent
 * run, no DOM context, so we can afford to put rich strategic context
 * here without paying it on every turn.
 *
 * Host's `appendSystemPrompt` is concatenated at the bottom — that's
 * where sitemap mental model / tour playbook / route routing logic goes.
 */

import { renderSitemap } from '../webagent/prompt';
import type { BrandPrompt, PersonaInput } from '../webagent/prompt';
import type { SitemapConfig } from '../webagent/types';

export interface PlanPromptContext {
  locale?: string;
  agentName?: string;
  sitemap?: SitemapConfig;
  brand?: BrandPrompt;
  persona?: PersonaInput;
  appendSystemPrompt?: string;
}

export function buildPlanSystemPrompt(ctx: PlanPromptContext): string {
  const sections: string[] = [];
  const agent = ctx.agentName ?? 'Agent';

  // Single short core. The webagent loop already knows how to execute
  // todos; the planner just needs to know its JOB, its OUTPUT SHAPE,
  // and that the user message carries the live DOM. No section headers,
  // no example routes, no keyword rules. Trust the model to reason
  // from the host's route descriptions + the current DOM.
  sections.push(
    `You are ${agent}'s planner. Output JSON: { task_summary, todos }.

- task_summary: one short sentence the user will see.
- todos: ordered array. Each item: { intent, description, expected_turn }. intent ∈ navigate | narrate | click | fill | ask | finish. Last item's intent is "finish".
- One todo = one turn. Don't combine navigate and narrate — the DOM only refreshes after navigate.

intent semantics:
- navigate / narrate / click / fill: agent actions on the page.
- ask: pause the loop and wait for user input. Use ONLY when the next agent step literally cannot proceed without a user choice. Do not use as a friendly follow-up, a clarification you could answer yourself, or a "what would you like next".
- finish: signals the run is over. Its description states what was just delivered, never a question. Asking the user something is not finishing.

If the user's task is informational (introduce / explain / tell / show / what is / where is / how do I), the plan is navigate-then-narrate-then-finish. Do not add an \`ask\` step to qualify needs the user did not bring up.

The user message carries the user's task, the current page DOM, and any selection. The current DOM is your first source — if it already contains what the user needs (a paragraph, a contact, a link, an answer), narrate from it, no navigate. Only navigate when the answer is NOT on the current page and a different route's description matches the topic better.

Reply in exactly the language the user wrote their task in. The page DOM and brand voice may be in other languages — they do not set the output language. Match the user's task language, not the page's language.`
  );

  // Persona + brand voice + constraints inline as prose, no headers.
  const personaLines: string[] = [];
  if (ctx.persona) {
    const identity = typeof ctx.persona === 'string' ? ctx.persona : ctx.persona.identity;
    if (identity?.trim()) personaLines.push(identity.trim());
  }
  if (ctx.brand?.voice) personaLines.push(`Voice: ${ctx.brand.voice}`);
  if (ctx.brand?.constraints?.length) {
    for (const c of ctx.brand.constraints) personaLines.push(c);
  }
  if (personaLines.length) sections.push(personaLines.join('\n'));

  // Sitemap is auto-rendered ONLY when the host hasn't provided their
  // own route descriptions via appendSystemPrompt. Avoids duplicating
  // "what each route is for" in two competing places — the host's
  // prose descriptions are richer than the auto-rendered list.
  if (ctx.sitemap && !ctx.appendSystemPrompt) {
    sections.push(renderSitemap(ctx.sitemap));
  }

  if (ctx.appendSystemPrompt) {
    sections.push(ctx.appendSystemPrompt);
  }

  return sections.filter(Boolean).join('\n\n');
}
