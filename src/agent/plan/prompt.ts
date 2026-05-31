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

Return JSON:
\`\`\`
{
  "task_summary": "<one short sentence describing what the user is about to see happen, in their language>",
  "todos": [
    { "intent": "navigate|narrate|click|fill|ask|finish", "description": "<one short clause>", "expected_turn": <1-based int> },
    ...
  ]
}
\`\`\`

Rules:
- One todo = one turn. NEVER fold a navigate and a narrate into the same todo — they happen on different turns because the DOM dump is fresh AFTER the navigate.
- The LAST todo is always \`{ "intent": "finish", "description": "..." }\` — this marks where the webagent emits task_finish.
- 3-6 todos is typical. More than 8 means you're over-planning a tour; cut.
- Description is what the USER will perceive happen, not what the tool does. ("解說授權方案卡" not "execute narrate with about=t_xx").
- For a "tour" / "introduce" task, plan navigate (if needed) + one narrate per major chunk + finish.
- For a "do this for me" task (fill form, click button), plan the navigate + each interaction + finish.`);

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
