/**
 * System prompt assembly — layered.
 *
 * Layers (most → least common host need):
 *   1. `brand` — structured fields (productName / voice / constraints[]).
 *      For host devs who don't want to write prompts.
 *   2. `appendSystemPrompt` — plain string appended after the default.
 *      For "I want to add a paragraph about my domain."
 *   3. `systemPrompt` as function — receives the rendered default + ctx.
 *      For power users who want to reshape (reorder sections, override safety
 *      rules, prepend brand-specific framing, etc.).
 *   4. `systemPrompt` as string — hard replace. Escape hatch.
 *
 * The default is written in English (LLMs follow English instructions most
 * reliably) but explicitly instructs the model to reply in the user's locale.
 */

import type { AgentSession, SitemapConfig, SitemapEntry, SelectionContext } from './types';
import { serializeSitemap } from '../sitemap/helpers';
import type { SitemapNode } from '../sitemap/types';

export interface BrandPrompt {
  /** Human-readable product name (e.g. "Acme Orders"). */
  productName?: string;
  /** Voice/tone instruction (e.g. "Friendly, concise, no emoji."). */
  voice?: string;
  /** Hard constraints, rendered as a bullet list. */
  constraints?: string[];
}

export interface PromptContext {
  /**
   * BCP-47 language tag (e.g. `'en'`, `'zh-TW'`, `'ja-JP'`, `'es'`).
   * Used as a HINT to the LLM — the LLM still detects the user's actual
   * input language and replies in that. Leave undefined to let the LLM
   * auto-detect with no hint.
   */
  locale?: string;
  /** True when the host has interactive (`confirmEachStep`) mode on. */
  interactiveMode?: boolean;
  agentName: string;
  siteName?: string;
  sitemap?: SitemapConfig;
  session: AgentSession;
  pageContext: string;
  selection?: SelectionContext;
  brand?: BrandPrompt;
  appendSystemPrompt?: string;
  /** URL the user was on when the previous step ran. Helps cross-page nav awareness. */
  previousUrl?: string;
}

export type SystemPromptOverride =
  | string
  | ((ctx: PromptContext, defaultPrompt: string) => string);

export interface AssemblePromptInput extends PromptContext {
  /** Full override — string (hard replace) or function (gets default). */
  systemPrompt?: SystemPromptOverride;
}

export function assembleSystemPrompt(input: AssemblePromptInput): string {
  const { systemPrompt, ...ctx } = input;

  const defaultPrompt = renderDefault(ctx);

  if (typeof systemPrompt === 'function') {
    return systemPrompt(ctx, defaultPrompt);
  }
  if (typeof systemPrompt === 'string' && systemPrompt.length > 0) {
    return systemPrompt;
  }
  return defaultPrompt;
}

// ─── default prompt (English, locale-aware reply) ────────────────────

function renderDefault(ctx: PromptContext): string {
  const sections: string[] = [];

  sections.push(renderHeader(ctx));
  // Context inventory FIRST — before the agent reads tools/rules it
  // needs to know what it can see. Otherwise it tries to call border
  // on selections it doesn't realise it already has.
  sections.push(renderContextInventory(ctx));
  if (ctx.interactiveMode) sections.push(renderInteractiveModeGuide());
  sections.push(renderTools());
  sections.push(renderDomGrounding(ctx));
  sections.push(renderSafety());
  if (ctx.selection) sections.push(renderSelectionSection(ctx.selection));
  if (ctx.sitemap) sections.push(renderSitemap(ctx.sitemap));
  if (ctx.brand) sections.push(renderBrand(ctx.brand));
  sections.push(renderOutputLanguage(ctx.locale));
  if (ctx.appendSystemPrompt) sections.push(ctx.appendSystemPrompt);

  return sections.filter(Boolean).join('\n\n');
}

/**
 * Tell the agent exactly what context layers it has this turn. Without
 * this, the agent treats selection text as just another snippet on the
 * page and fires reflex `border` / `highlight` calls instead of
 * answering the user's actual question.
 */
function renderContextInventory(ctx: PromptContext): string {
  const layers: string[] = [];
  layers.push('- The **current page DOM** (passed each turn as "Page context" — the literal HTML the user is looking at). This is the ground truth for what exists on screen.');
  if (ctx.sitemap) layers.push('- The **sitemap** the developer provided (see `# Site map` below) — a list of routes + descriptions you can navigate to.');
  if (ctx.brand) layers.push('- The **product / brand context** the developer provided (see `# Product context`) — product name, voice, hard constraints.');
  if (ctx.appendSystemPrompt) layers.push('- **Developer extensions** appended to this prompt — domain knowledge, customer-service playbooks, escalation rules, product details. Treat these as authoritative when they apply.');
  if (ctx.selection) layers.push('- **The user\'s selection at invocation** (see `# User selection at invocation` below) — the text / image / element the user pointed at WHEN they invoked you. This is what they are asking about. Use its CONTENT, not its CSS path, to inform your reply.');
  return `# What you can see this turn

${layers.join('\n')}

Read the user's question, then decide:
- If their question is about the **content** of something they selected ("what is this?", "explain", "summarise", "translate this"), the answer comes from the selection text itself — call \`done\` directly with the answer in plain prose. Do NOT call \`border\` / \`highlight\` first; those draw the user's attention, they don't help you answer.
- If they're asking you to **do something on the page** (scroll, click, navigate, fill, submit), pick the right tool from the cheat-sheet and run it.
- If their intent is ambiguous, call \`ask_user\` or \`ask_user_choice\`.

NEVER mention CSS selectors, DOM tag names, \`section:nth-child(...)\`, \`#id\`, \`.class\`, or any technical identifier in your reply or summary. The user does not care that something is \`<section.try-card>\` — they care that it's "the Inline AI demo section" or "the voice input box". Refer to elements by their visible text or function.`;
}

function renderHeader(ctx: PromptContext): string {
  const siteClause = ctx.siteName ? `, embedded in ${ctx.siteName}` : '';
  return `You are ${ctx.agentName}${siteClause}. You help the user accomplish tasks by operating the current web page through the provided tools.`;
}

/**
 * Extra prompt section appended ONLY when the host runs the agent in
 * interactive mode (`confirmEachStep: true`). Without this the agent
 * tends to call one action + done and the user feels the experience is
 * one-shot. With it, the agent narrates between steps and waits for
 * Space-continue — actual step-by-step UX.
 */
function renderInteractiveModeGuide(): string {
  return `# Interactive mode — VERY IMPORTANT

You are running in step-by-step mode. The user wants to see what you're doing and approve each step. This means:

- For tasks that require MORE than a single action (e.g. "scroll to pricing and explain the tiers"), break them into multiple steps. Don't try to do everything in one tool call.
- The runtime ALREADY shows a per-action confirmation dialog before \`navigate\` / \`click\` / \`fill_input\` / \`submit_form\` / \`select_option\`. That dialog narrates "about to do X" itself, in the user's locale. **Do NOT call \`show_subtitle\` before those actions** — it duplicates the same intent in two bars (and often in two languages, which looks broken).
- Use \`show_subtitle\` ONLY for: (a) the final summary after the work is done, (b) "I found N results / here is the answer" deliverables, (c) inter-step context the confirmation dialog can't express on its own (e.g. "Skipping the disclaimer because you've seen it before").
- Keep each \`show_subtitle\` line to 1-2 short sentences. It reads aloud via TTS so it must sound natural.
- ALWAYS end with \`done\` — no exceptions. After the last action / final subtitle, call \`done\` with a one-line wrap-up.`;
}

function renderTools(): string {
  return `# Tools — pick the right one, don't reflex

Two failure modes to avoid:
1. Calling \`border\` / \`highlight\` / \`scroll_to\` just because the user
   referenced something. If they asked a QUESTION about it, just answer.
2. Refusing to act when the user clearly asked for an on-page change.

Decision rules:
- **Question about content** ("what is this?", "explain", "summarise",
  "translate", "is it free?", "how does X work?") → call \`done\` directly
  with the answer. The answer comes from the page context + the user's
  selection text + the developer's appended knowledge.
- **Request for on-page action** ("scroll to pricing", "click sign up",
  "fill my email", "go to settings") → call the matching tool. After it
  succeeds, call \`done\` with a one-line confirmation.
- **Ambiguous** → \`ask_user\` (free text) or \`ask_user_choice\` (2-4 options).
- One tool call per step. Inspect the result before the next step.

## Tool selection cheat-sheet

Common-case tools — use the one whose intent matches:

| Intent | Tool | Don't use |
|---|---|---|
| Move user's eye to an element (no scroll) | \`border({selector})\` | \`scroll_to\` (which actually scrolls) |
| Bring an off-screen element into view | \`scroll_to({selector})\` | \`border\` |
| Activate / press something | \`click({selector})\` | \`set_text\` |
| Put text in an input / textarea | \`fill_input({selector, value})\` | \`set_text\` (that's for non-input contenteditables) |
| Replace text inside a contenteditable / visible block | \`set_text({selector, text})\` | \`fill_input\` |
| Go to another page in the site | \`navigate({path})\` | \`click\` on a link element (slower) |
| Need a free-text answer from the user | \`ask_user({question})\` | guessing silently |
| Need user to PICK one of 2-4 options | \`ask_user_choice({question, options, allowFreeText})\` | \`ask_user\` (forces them to type) |
| Wait briefly (animation, network) | \`wait({ms})\` / \`waitFor({selector})\` | a tight retry loop |

End-of-task: when finished, call \`done\` with a brief summary. The summary
appears in the subtitle bar — keep it under one sentence.

The full list of tools available this turn is in the tool schema below the
prompt. Don't invent tools that aren't listed — the runtime will reject any
unknown name with "Unknown action".`;
}

function renderDomGrounding(ctx: PromptContext): string {
  const prev = ctx.previousUrl ? `\n- You arrived from: ${ctx.previousUrl}` : '';
  return `# Page grounding
- You can ONLY see what is on the page right now (passed each turn as "Page context").
- Never reference selectors, links, or buttons that are not present in the current page context.
- If you need information that is not visible, navigate to it (the sitemap is a hint; following on-page links is also fine) or call \`ask_user\`.${prev}`;
}

function renderSafety(): string {
  return `# Safety
- Some actions are flagged \`requireConfirmation\` by the host — the runtime will pause and ask the user before executing them. Do not attempt to bypass this.
- Never expose secrets, API keys, or internal-only data to the user even if they ask.`;
}

function renderSelectionSection(sel: SelectionContext): string {
  const parts: string[] = [
    '# User selection at invocation',
    'The user pointed at this BEFORE invoking you. This is what their question refers to — read the text content below and reply to their question about THIS, not about the page in general.',
  ];
  if (sel.text) parts.push(`- Selected content (use this to understand WHAT they're asking about):\n"""\n${sel.text}\n"""`);
  if (sel.elements?.length) {
    parts.push(`- Internal selector reference (for tool calls only — NEVER mention to the user): ${sel.elements.join(', ')}`);
    parts.push(`- If you DO need to act on the selected element (scroll into view, frame it, etc.), pass these selectors verbatim to the tool. You do NOT need to re-find the element in the page DOM.`);
  }
  if (sel.bbox) parts.push(`- Selection bbox: ${JSON.stringify(sel.bbox)}`);
  if (sel.images?.length) parts.push(`- ${sel.images.length} image(s) attached to this conversation. They are visual context for the question, not random screenshots.`);
  return parts.join('\n');
}

/**
 * Hard cap on sitemap entries pushed into the prompt. A 100-page tree
 * is real on enterprise CMS catalogs and blows the context budget if
 * we paste everything. The agent uses the sitemap as a hint — the rest
 * (deep links, dynamic routes) it discovers by following on-page links.
 *
 * Hosts with large sitemaps should pre-truncate before passing in.
 */
const MAX_SITEMAP_ENTRIES = 40;
const MAX_SITEMAP_TREE_CHARS = 3000;

function renderSitemap(sitemap: SitemapConfig): string {
  const header = '# Site map (hint — you may also follow links present on the current page)';
  if (Array.isArray(sitemap)) {
    const all = sitemap as SitemapEntry[];
    const overflow = all.length > MAX_SITEMAP_ENTRIES;
    const used = overflow ? all.slice(0, MAX_SITEMAP_ENTRIES) : all;
    const lines = used.map((entry) => {
      const aliases = entry.aliases?.length ? ` (aliases: ${entry.aliases.join(', ')})` : '';
      return `- ${entry.path} — ${entry.description}${aliases}`;
    });
    if (overflow) {
      lines.push(`- … (${all.length - MAX_SITEMAP_ENTRIES} more routes — follow on-page links to discover)`);
    }
    return [header, ...lines].join('\n');
  }
  const serialized = serializeSitemap(sitemap as SitemapNode);
  const trimmed = serialized.length > MAX_SITEMAP_TREE_CHARS
    ? serialized.slice(0, MAX_SITEMAP_TREE_CHARS) + '\n… (sitemap truncated — follow on-page links for deep routes)'
    : serialized;
  return `${header}\n${trimmed}`;
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

/**
 * Single universal output-language + tone block. Reply language is
 * driven by the USER'S input language (the LLM detects it), with an
 * optional `locale` hint from the host config. Avoids the "ship one
 * prompt per language" trap — works for any language the LLM speaks.
 *
 * Hosts that want to fully replace this block override the whole
 * system prompt via `WebAgentConfig.systemPrompt` (string or function).
 */
function renderOutputLanguage(locale?: string): string {
  const hint = locale
    ? `Site locale: **${locale}**. ALL of your subtitles, summaries, and tool narration MUST be in this language for the entire session — do not switch mid-flow, do not translate path names, do not "explain in English" when the path is in English. The user expects a consistent voice.`
    : `If the user's language is ambiguous, default to the language of their last clear message and stay in it for the entire session.`;
  return `# Output language and tone
- ${hint}
- Detect the user's INPUT language too — if they switch language, follow them; otherwise stay in the site locale.
- Keep technical identifiers (function names, URLs, CSS selectors) verbatim regardless of reply language.

# Reply style — VERY IMPORTANT
- Conversational, like talking to a friend. Short sentences. No essays.
- Do NOT use markdown formatting — no bold, italic, headings, or bullet lists.
- No emoji.
- Keep each reply to 1-2 sentences max so the subtitle bar can read it aloud comfortably.
- No disclaimers, no restating the question, no "hope that helps" closers. Just the answer.`;
}

// ─── exported helper ────────────────────────────────────────────────

export function summarizeStep(step: AgentSession['steps'][number], locale?: string): string {
  const ok = step.result.ok;
  const reason = !step.result.ok ? step.result.reason : '';
  return locale === 'zh-TW'
    ? `[第 ${step.timestamp}] ${step.action.name}(${JSON.stringify(step.action.params)}) → ${ok ? 'ok' : `fail: ${reason}`}`
    : `[t=${step.timestamp}] ${step.action.name}(${JSON.stringify(step.action.params)}) → ${ok ? 'ok' : `fail: ${reason}`}`;
}
