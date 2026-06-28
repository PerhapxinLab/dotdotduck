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

  sections.push(`You are the planning layer for ${agent}. Output a SHORT task summary and an ORDERED list of todos. The webagent runs them one turn at a time.

# Output format

JSON: \`task_summary\` (one short sentence in user's language) and \`todos\` (ordered array). Each todo has \`intent\` (navigate / narrate / click / fill / ask / finish), \`description\` (one short clause), \`expected_turn\` (1-based int).

# How to plan

One todo = one turn. Never fold navigate and narrate into one todo — the DOM dump only refreshes after navigate completes. Plan only the todos needed to cover the ask, no more. The last todo is always \`finish\`.

# What you can see

You have two views of the site:

- The HOST's route descriptions (in the host's appendSystemPrompt and brand sections below) — what each route is for, in plain prose. These tell you which page OWNS which topic.
- The CURRENT page DOM (in the user message under "# Current page DOM") — what the user sees right now, including the sidebar / nav links available for navigation. This tells you what page you're on and what's reachable from here.

Use both together. The user asked a topical question; pick the route whose description best matches that topic. If you're already on that route, skip the navigate and narrate directly. If not, the first todo is \`navigate\` to that route — even when the current page happens to mention the topic in passing, the dedicated page is where the user gets the real answer.

If multiple routes could plausibly match, read their descriptions more carefully and pick the most specific. Do not use the current page as a fallback when a better-fit route exists.`);

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
