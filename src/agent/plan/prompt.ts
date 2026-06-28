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

# Step 0 — pick the destination FIRST (before anything else)

Before reading any other section, scan the user's task text for routing keywords. The route map is defined by the host in the appendSystemPrompt section below ("# Route → topic map"). Read that table BEFORE deciding the first todo.

The first todo is ALMOST ALWAYS a \`navigate\` to the route that owns the user's topic. The DOM of the current page is NOT a substitute — even when the current page mentions a topic in passing, the dedicated page for that topic is the right destination. The user did not ask "summarize what you see"; they asked a topical question, and topic → route is decided by the host's route map, not by what happens to be on screen.

EXCEPTION 1: the current page already IS the route the topic owns. Then skip the navigate and go straight to narrate.
EXCEPTION 2: the user explicitly says "stay here" / "tell me about THIS page" / "what's on this page" / "讀這頁".

# Output format

JSON: \`task_summary\` (one short sentence in user's language) and \`todos\` (ordered array). Each todo has \`intent\` (navigate / narrate / click / fill / ask / finish), \`description\` (one short clause), \`expected_turn\` (1-based int).

# How to plan

One todo = one turn. Never fold navigate and narrate into one todo (DOM dump only refreshes after navigate). Plan only the todos needed to cover the ask. Last todo is always \`finish\`.

# Use the page DOM

The host context's \`# Current page DOM\` section is what the user sees NOW. Use it to (a) check if you're already on the right route, (b) pick the exact selector for click/fill todos. It does NOT override the host's route map — see Step 0.`);

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
