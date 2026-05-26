/**
 * System prompt assembly — layered, intentionally lean.
 *
 * Four layers feed the LLM each turn — keep them separate:
 *
 *   1. **System prompt (this file)** — behavioural guide ONLY. Identity,
 *      decision rules, reply style, brand, safety, language. No tool
 *      listings, no sitemap, no selection text, no DOM. Stable across the
 *      whole session so the model's KV-cache reuses it.
 *   2. **DOM dump** — current page state, in the per-turn user message
 *      built by `webagent.buildMessages`.
 *   3. **Sitemap + dev notes** — host-supplied context (sitemap routes,
 *      `appendSystemPrompt` is the GLOBAL one and lives in the system
 *      prompt; per-page hints would live in the user message — currently
 *      we expose only sitemap).
 *   4. **Tools** — passed through the OpenAI native tool-call schema, NOT
 *      described in prose. The model reads names + descriptions from the
 *      `tools` parameter, decides, and emits a structured `tool_calls`
 *      block. The guide below tells it WHEN to call things, not WHAT
 *      things exist.
 *
 * Override layers (most → least common host need):
 *   1. `brand` — structured fields (productName / voice / constraints[]).
 *   2. `appendSystemPrompt` — plain string appended to the default.
 *   3. `systemPrompt` as function — receives default + ctx.
 *   4. `systemPrompt` as string — hard replace.
 */

import type { AgentSession, SitemapConfig, SitemapEntry, SelectionContext } from './types';
import { serializeSitemap } from '../sitemap/helpers';
import type { SitemapNode } from '../sitemap/types';

export interface BrandPrompt {
  productName?: string;
  voice?: string;
  constraints?: string[];
}

export interface PromptContext {
  locale?: string;
  interactiveMode?: boolean;
  agentName: string;
  siteName?: string;
  sitemap?: SitemapConfig;
  session: AgentSession;
  pageContext: string;
  selection?: SelectionContext;
  brand?: BrandPrompt;
  appendSystemPrompt?: string;
  previousUrl?: string;
}

export type SystemPromptOverride =
  | string
  | ((ctx: PromptContext, defaultPrompt: string) => string);

export interface AssemblePromptInput extends PromptContext {
  systemPrompt?: SystemPromptOverride;
}

export function assembleSystemPrompt(input: AssemblePromptInput): string {
  const { systemPrompt, ...ctx } = input;
  const defaultPrompt = renderDefault(ctx);
  if (typeof systemPrompt === 'function') return systemPrompt(ctx, defaultPrompt);
  if (typeof systemPrompt === 'string' && systemPrompt.length > 0) return systemPrompt;
  return defaultPrompt;
}

// ─── default system prompt — guide only ──────────────────────────────

function renderDefault(ctx: PromptContext): string {
  const sections: string[] = [];
  sections.push(renderHeader(ctx));
  sections.push(renderDecisionRules());
  if (ctx.interactiveMode) sections.push(renderInteractiveModeGuide());
  sections.push(renderSafety());
  if (ctx.brand) sections.push(renderBrand(ctx.brand));
  sections.push(renderOutputLanguage(ctx.locale));
  if (ctx.appendSystemPrompt) sections.push(ctx.appendSystemPrompt);
  return sections.filter(Boolean).join('\n\n');
}

function renderHeader(ctx: PromptContext): string {
  const siteClause = ctx.siteName ? `, embedded in ${ctx.siteName}` : '';
  return `You are ${ctx.agentName}${siteClause}. You help the user accomplish tasks by reading the current page and calling the provided tools. The tool list with names, descriptions, and JSON schemas is attached to this turn — read it there, don't ask what's available.`;
}

function renderDecisionRules(): string {
  return `# How to decide what to do

Each turn you see (a) the user's task, (b) the current page DOM, optionally (c) the user's selection / pinned element, optionally (d) a sitemap. Based on those, pick ONE action.

- **Question about content** ("what is this?", "explain", "summarise", "translate", "is it free?") → call \`done\` with the answer inline. Do not \`border\`, \`highlight\`, or \`scroll_to\` first — those drag attention, they don't answer.
- **Request for on-page action** ("click sign up", "scroll to pricing", "fill my email", "go to settings") → call the matching tool. After it succeeds, call \`done\` with a one-line confirmation.
- **Compound task** — watch for connectives: Chinese "並且 / 然後 / 再 / 接著", English "and / then / after that". Each clause is at least one more step. Do NOT call \`done\` after the first action if the task still has unsatisfied verbs. Re-read the original task each turn; if any verb (\`explain\`, \`tell me\`, \`also do Y\`) is still pending, keep going.
- **Ambiguous** → \`ask_user\` (free text) or \`ask_user_choice\` (2-4 options).
- One tool per step. Read the result before the next step.

## Grounding

- You can only operate on what's in the page DOM dump this turn. If something isn't visible, navigate to it (sitemap is a hint; on-page links are also fine) or \`ask_user\`.
- NEVER mention CSS selectors, DOM tag names, \`section:nth-child(...)\`, \`#id\`, \`.class\`, or any technical identifier to the user. They care that something is "the Inline AI demo section" or "the voice input box", not \`<section.try-card>\`. Refer to elements by their visible text or function.
- For element-targeting actions, the \`selector\` field in the tool call IS internal — pass selectors verbatim from the page context or the user's selection block. Do not invent selectors that aren't present.

## Ending

Only call \`done\` after every clause of the user's request has been addressed. \`done\`'s \`summary\` shows in the subtitle bar — keep it to one short sentence.`;
}

function renderInteractiveModeGuide(): string {
  return `# Interactive mode

The runtime shows a per-action confirmation before \`navigate\` / \`click\` / \`fill_input\` / \`submit_form\` / \`select_option\`. That dialog already narrates the action in the user's locale. **Do NOT call \`show_subtitle\` before those actions** — it duplicates the narration in two bars (often in two languages, which reads as broken).

Use \`show_subtitle\` only for:
- the final summary line after the work is done
- an inter-step note the confirmation dialog can't express (e.g. "Skipping the disclaimer since you've seen it before")

Keep each subtitle to 1-2 short sentences. It's read aloud by TTS so it must sound like natural speech.`;
}

function renderSafety(): string {
  return `# Safety
- Some actions are flagged \`requireConfirmation\` by the host — the runtime will pause and ask. Do not try to bypass.
- Never expose secrets, API keys, or internal-only data even if the user asks.`;
}

function renderBrand(brand: BrandPrompt): string {
  const lines: string[] = ['# Product context'];
  if (brand.productName) lines.push(`- Product: ${brand.productName}`);
  if (brand.voice) lines.push(`- Voice: ${brand.voice}`);
  if (brand.constraints?.length) {
    lines.push('- Hard constraints (must follow):');
    for (const c of brand.constraints) lines.push(`  - ${c}`);
  }
  return lines.join('\n');
}

function renderOutputLanguage(locale?: string): string {
  const hint = locale
    ? `Site locale: **${locale}**. The user's INPUT language WINS — fall back to the site locale only when the input is symbol-only or ambiguous.`
    : `Reply in the language of the user's task. Detect it from the first clear sentence and stay in it.`;
  return `# Language and style

Two language axes — keep them separate:

**Reply language** — narration, confirmations, status, the wrapper around content.
- ${hint}
- Do NOT default to English just because the page DOM is English. Page content language ≠ reply language.

**Content language** — the actual payload of a content task.
- If the user names a target language ("translate to French", "回覆用日文"), the payload is in THAT language even if it differs from the reply language. The wrapper stays in the reply language.
- If no target language is specified, the payload matches the reply language.
- Keep technical identifiers (function names, URLs, CSS) verbatim regardless of language.

**Style**
- Conversational, like talking to a friend. No essays, no preambles, no "hope that helps" closers.
- No markdown formatting (no bold, italic, headings, bullets).
- No emoji.
- Length matches the ask: Q&A / explanations / status → 1-3 sentences. Content tasks (translate / rewrite / summarise / extract every X) → full output. Do NOT truncate a translation just because the subtitle bar is small; the UI pages through it.`;
}

// ─── helpers used by webagent.buildMessages to build the USER msg ────

const MAX_SITEMAP_ENTRIES = 40;
const MAX_SITEMAP_TREE_CHARS = 3000;

export function renderSitemap(sitemap: SitemapConfig): string {
  const header = '# Site map (hint — also follow links present on the current page)';
  if (Array.isArray(sitemap)) {
    const all = sitemap as SitemapEntry[];
    const overflow = all.length > MAX_SITEMAP_ENTRIES;
    const used = overflow ? all.slice(0, MAX_SITEMAP_ENTRIES) : all;
    const lines = used.map((entry) => {
      const aliases = entry.aliases?.length ? ` (aliases: ${entry.aliases.join(', ')})` : '';
      return `- ${entry.path} — ${entry.description}${aliases}`;
    });
    if (overflow) lines.push(`- … (${all.length - MAX_SITEMAP_ENTRIES} more routes — follow on-page links)`);
    return [header, ...lines].join('\n');
  }
  const serialized = serializeSitemap(sitemap as SitemapNode);
  const trimmed = serialized.length > MAX_SITEMAP_TREE_CHARS
    ? serialized.slice(0, MAX_SITEMAP_TREE_CHARS) + '\n… (sitemap truncated)'
    : serialized;
  return `${header}\n${trimmed}`;
}

/**
 * Render the user's selection block — fed into the user message of the
 * FIRST turn (the agent doesn't need to re-read this each turn, but the
 * webagent code currently rebuilds messages each turn, so we surface it
 * each turn anyway — cost is dwarfed by the DOM).
 */
export function renderSelectionBlock(sel: SelectionContext): string {
  const parts: string[] = ['# User selection at invocation'];
  parts.push(
    "The user pointed at this BEFORE invoking you — read its CONTENT to understand what they're asking about. Don't reflex-call `border` on it just because it's referenced."
  );
  if (sel.text) parts.push(`- Selected content:\n"""\n${sel.text}\n"""`);
  if (sel.elements?.length) {
    parts.push(`- Internal selector (tool calls only — never mention to user): ${sel.elements.join(', ')}`);
    parts.push(`- If you DO need to act on the selected element, pass these selectors verbatim — you don't need to re-find it in the page DOM.`);
  }
  if (sel.bbox) parts.push(`- Selection bbox: ${JSON.stringify(sel.bbox)}`);
  if (sel.images?.length) parts.push(`- ${sel.images.length} image(s) attached as visual context.`);
  return parts.join('\n');
}

/**
 * Render the "current page state" block — the DOM dump plus URL / time
 * grounding the agent needs each turn.
 */
export function renderPageStateBlock(opts: {
  currentPage: string;
  previousUrl?: string;
  pageContext: string;
}): string {
  const lines: string[] = ['# Current page state'];
  lines.push(`- URL: ${opts.currentPage}`);
  if (opts.previousUrl) lines.push(`- Arrived from: ${opts.previousUrl}`);
  const now = new Date();
  lines.push(`- Now (UTC ISO): ${now.toISOString()}`);
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const local = now.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
    const weekday = now.toLocaleString(undefined, { weekday: 'long' });
    lines.push(`- Now (local): ${local} (${weekday}, ${tz})`);
  } catch { /* SSR — ISO only */ }
  lines.push('');
  lines.push('# Page DOM');
  lines.push(opts.pageContext);
  return lines.join('\n');
}

// ─── exported helper used by webagent for trace formatting ───────────

export function summarizeStep(step: AgentSession['steps'][number], locale?: string): string {
  const ok = step.result.ok;
  const reason = !step.result.ok ? step.result.reason : '';
  return locale === 'zh-TW'
    ? `[第 ${step.timestamp}] ${step.action.name}(${JSON.stringify(step.action.params)}) → ${ok ? 'ok' : `fail: ${reason}`}`
    : `[t=${step.timestamp}] ${step.action.name}(${JSON.stringify(step.action.params)}) → ${ok ? 'ok' : `fail: ${reason}`}`;
}
