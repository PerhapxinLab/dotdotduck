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

  sections.push(`You are the planning layer for ${agent}. Given the user's task and the site context below, output a SHORT task summary and an ORDERED list of todos. The webagent loop will execute the todos one turn at a time — every todo you write becomes one turn of work.`);

  sections.push(`# Output format

Return JSON with fields \`task_summary\` (one short sentence in the user's language) and \`todos\` (ordered array). Each todo has \`intent\` (one of navigate / narrate / click / fill / ask / finish), \`description\` (one short clause describing what the user will perceive happen), and \`expected_turn\` (1-based integer).

# How to plan

Plan only the todos needed to cover the user's ask. When the ask is covered, the plan ends.
One todo equals one turn. Never fold a navigate and a narrate into the same todo — they happen on different turns because the DOM dump only refreshes after navigate completes.
A todo description states what the team SAYS or DOES for the user. It is not a meta-checklist of topics to cover.
The last todo always has intent \`finish\` so the webagent knows the task is over.`);

  if (ctx.brand) {
    const lines: string[] = ['# Product context'];
    if (ctx.brand.productName) lines.push(`- Product: ${ctx.brand.productName}`);
    if (ctx.brand.voice) lines.push(`- Voice: ${ctx.brand.voice}`);
    if (ctx.brand.constraints?.length) {
      lines.push('- Hard constraints:');
      for (const c of ctx.brand.constraints) lines.push(`  - ${c}`);
    }
    sections.push(lines.join('\n'));
  }

  if (ctx.persona) {
    const identity = typeof ctx.persona === 'string' ? ctx.persona : ctx.persona.identity;
    if (identity?.trim()) {
      sections.push(`# Speak as\n\n${identity.trim()}`);
    }
  }

  if (ctx.sitemap) {
    sections.push(renderSitemap(ctx.sitemap));
  }

  if (ctx.locale) {
    sections.push(`# Language\n\ntask_summary in \`${ctx.locale}\` unless the user clearly used another language.`);
  }

  if (ctx.appendSystemPrompt) {
    sections.push(ctx.appendSystemPrompt);
  }

  return sections.filter(Boolean).join('\n\n');
}
