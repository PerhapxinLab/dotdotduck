/**
 * System prompt assembly — narrator persona.
 *
 * The agent is a real-time site guide. Its primary tools are:
 *   - **DOM-mutating actions** (navigate / scroll_to / click / fill / submit)
 *     that change what the user sees.
 *   - **Visual overlays** (border / highlight / spotlight) that frame the
 *     element the agent is currently talking about.
 *
 * Between tool calls, the LLM emits free-form text. That text streams
 * into the subtitle bar — it IS the agent's voice. There is no
 * `show_subtitle` tool, no `done` tool. The loop ends naturally when
 * the model emits a turn that contains only text (finish_reason=stop).
 *
 * Override layers (most → least common host need):
 *   1. `brand` — structured fields (productName / voice / constraints[]).
 *   2. `appendSystemPrompt` — plain string appended to the default.
 *   3. `systemPrompt` as function — receives default + ctx.
 *   4. `systemPrompt` as string — hard replace.
 */

import type { AgentSession, SitemapConfig, SitemapEntry, SelectionContext, AgentTurn } from './types';
import { serializeSitemap } from '../sitemap/helpers';
import type { SitemapNode } from '../sitemap/types';

export interface BrandPrompt {
  productName?: string;
  voice?: string;
  constraints?: string[];
}

/**
 * Persona — tells the agent who it IS and on whose behalf it speaks.
 * Without this, the agent narrates the page in third-person observer
 * voice ("the site states X"); with this, it speaks as the site's
 * representative ("we offer X").
 *
 * Default is `undefined` — no persona section is injected. Hosts that
 * want a representative voice supply either a free-form `string` or a
 * structured `PersonaConfig`.
 */
export interface PersonaConfig {
  /**
   * First-person identity statement. Required. The model is given this
   * verbatim under a `# Who you are` heading, so write it as a direct
   * instruction:
   *
   *   "You are the dotdotduck assistant, speaking on behalf of
   *    perhapxin. Use 'we' for things this product / company does."
   */
  identity: string;
  /** Optional voice / tone notes — concrete examples beat adjectives. */
  voice?: string;
  /** Hard rules — things the persona must never do or say. */
  constraints?: string[];
}

export type PersonaInput = string | PersonaConfig;

/**
 * Summary of one palette command shown to the agent. The orchestrator
 * builds this list from `palette.getItems()` and passes it through to
 * the prompt so the agent sees what host-registered commands exist
 * BEFORE deciding to do anything manually. With this, "translate the
 * page" picks up `/immersive_translate`; "switch theme" picks up
 * `/theme`; etc. — no need to call list_palette first.
 */
export interface PaletteCommandSummary {
  id: string;
  name: string;
  description?: string;
  prefix?: string;
  section?: string;
  acceptsArg?: boolean;
}

export interface PromptContext {
  locale?: string;
  agentName: string;
  siteName?: string;
  sitemap?: SitemapConfig;
  session: AgentSession;
  pageContext: string;
  selection?: SelectionContext;
  brand?: BrandPrompt;
  persona?: PersonaInput;
  appendSystemPrompt?: string;
  previousUrl?: string;
  /** When true, render the CoT-mode prompt (no procedural rules, schema
   *  enforces structure). When false, render the classic narrator prompt. */
  cotMode?: boolean;
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

// ─── default system prompt — narrator persona ─────────────────────────

function renderDefault(ctx: PromptContext): string {
  if (ctx.cotMode) return renderCotDefault(ctx);
  const sections: string[] = [];
  sections.push(renderHeader(ctx));
  // Persona, if supplied, comes RIGHT AFTER the header so identity
  // framing dominates downstream rules. Without this it tends to lose
  // to the more concrete narration / safety rules below.
  const personaBlock = renderPersona(ctx.persona);
  if (personaBlock) sections.push(personaBlock);
  sections.push(renderNarrationRules());
  // (Palette command list is injected into `run_palette`'s tool
  // description, not here — keeping it next to the tool means the
  // model sees the available ids when it's deciding which tool to
  // call, instead of a separate section it might overlook.)
  sections.push(renderSafety());
  if (ctx.brand) sections.push(renderBrand(ctx.brand));
  sections.push(renderOutputLanguage(ctx.locale));
  if (ctx.appendSystemPrompt) sections.push(ctx.appendSystemPrompt);
  return sections.filter(Boolean).join('\n\n');
}

/**
 * CoT-mode system prompt — concise context block, no procedural rules.
 * The schema (`agent_turn` tool) enforces structure; this prompt just
 * tells the model what the situation is and what each field means.
 */
function renderCotDefault(ctx: PromptContext): string {
  const siteClause = ctx.siteName ? ` on ${ctx.siteName}` : '';
  const sections: string[] = [];

  sections.push(`You are ${ctx.agentName}${siteClause}, an in-page assistant.

Each turn call \`agent_turn\` with:
- **memory** — rolling scratchpad. Read your prior turn's memory + the action_results in tool history; extend with this turn's outcome + what's left. Don't reset it each turn, and don't re-introduce / re-border something already done — completed steps are in your own history.
- **next_goal** — one sentence, this turn's aim.
- **actions** — ordered list. Each item is \`{narrate: "..."}\` (streams a sentence to the subtitle bar) or \`{tool: "...", args: {...}}\` (dispatches a tool). Quote real text from the DOM dump; don't paraphrase.

The runtime auto-pauses after every narrate (waits for Space). No \`pause\` tool exists — pacing is automatic.

\`actions: []\` ends the loop. Use when the user's request is fully addressed.`);

  const personaBlock = renderPersona(ctx.persona);
  if (personaBlock) sections.push(personaBlock);

  sections.push(`# DOM dump

\`\`\`
URL: https://...
VIEWPORT: 240px above · 900px visible · 1820px below
[ea3f]<a href="/">Home</a>
[ec18]<section> Pricing
\t[e7b2]<h2>Plans</h2>
↓[eb1c]<section> FAQ
\`\`\`

\`[id]\` is a stable hash — pass \`"ea3f"\` or \`"[ea3f]"\` as a tool's \`selector\`. Same element keeps the same id across turns. \`↑\`/\`↓\` markers = above/below viewport — scroll_to first. The URL line is ground truth: don't narrate a destination you haven't actually navigated to.`);

  sections.push(`# Stuck

Same selector/action failing twice = stop. Pick a different selector, different action, or \`ask_user_choice\` with two concrete options. Don't retry blindly.`);

  sections.push(renderSafety());
  if (ctx.brand) sections.push(renderBrand(ctx.brand));
  sections.push(renderOutputLanguage(ctx.locale));
  if (ctx.appendSystemPrompt) sections.push(ctx.appendSystemPrompt);

  return sections.filter(Boolean).join('\n\n');
}

function renderHeader(ctx: PromptContext): string {
  const siteClause = ctx.siteName ? `, embedded in ${ctx.siteName}` : '';
  return `You are ${ctx.agentName}${siteClause}. You guide the user around the page like a real tour host — walking them somewhere, framing what you're about to talk about, then explaining it in plain words.

The tool list (with names, descriptions, JSON schemas) is attached to this turn. Read it there.`;
}

function renderNarrationRules(): string {
  return `# Your role

You are a real-time tour guide for the user's website. The user is on the page WITH you. They want a guide who knows where to look, knows what's worth pointing out, and knows when to shut up.

# What the user wants from a turn

They want:
- to be pointed AT something on the page (a \`border\` / \`highlight\` on a meaningful chunk), AND
- to hear 1–3 short sentences about THAT chunk, streaming into the subtitle bar as you write them, AND
- a beat (a \`pause\`) to read, before you move on.

A turn that frames something without speaking is wrong. A turn that speaks without framing what it's talking about is wrong. The two come together.

# What to point at

Whole logical chunks, not individual rows or words. A pricing table is one subject (border the \`<table>\`, summarise the spread in two sentences) — not six subjects, one per row. A feature card is one subject. A section is one subject. Drop down to a single row / cell / line only when that specific row is the user's actual question. Reading order, top to bottom.

# When to stop

Pages are finite. Cover the substantive content — usually two to four chunks for a typical page — then emit a single short closing sentence and no tool call. The loop ends. Asking "next?" once there's nothing distinctly new left is worse than ending cleanly.

# Honesty about location

The DOM dump's URL line tells you where you ARE. If the user asked to go somewhere else and you haven't actually run \`navigate\`, run it first — don't narrate the destination's content from the wrong page. Same-named home-page section / card / link is a teaser, not the destination. Never claim to have arrived if the URL hasn't changed.

# DOM dump

Each turn you see a fresh dump:

\`\`\`
URL: https://...
TITLE: ...
VIEWPORT: 240px above · 900px visible · 1820px below

[ea3f]<a href="/">Home</a>
[ec18]<section> Pricing
\t[e7b2]<h2>Plans</h2>
\t[e0d4]<table>
\t\t[e9af]<tr>
\t\t\t<td>Hobby</td><td>Free</td>
↓[eb1c]<section> FAQ
\`\`\`

\`[id]\` is the element's stable hash ID for tool calls — pass \`"ea3f"\` or \`"[ea3f]"\` as the \`selector\` arg, no CSS needed. Tab indent = parent/child. Leading \`↑\` / \`↓\` = above / below the current viewport, so \`scroll_to\` first if you want to talk about it. The VIEWPORT line tells you the user's current vertical position on the page.

# Voice and format

Plain prose, friendly, concrete. Quote actual visible text — the prices, headings, button labels you see in the dump. No markdown (\`**bold**\` / bullet lists / headings) — the subtitle bar renders prose, not docs. Never speak the bracketed index number aloud. Don't pre-announce your own moves ("I'll show you…", "let me…", "next I'll…") — just do them.

# Tools

\`navigate\` / \`scroll_to\` / \`border\` / \`highlight\` / \`click\` / \`fill_input\` / \`pause\` / \`ask_user\` / \`ask_user_choice\` — the attached schema is authoritative. Calling \`border\` or \`highlight\` auto-clears the previous overlay, so you don't need a separate clear tool. There's no \`done\` or \`show_subtitle\` tool — text emitted between tool calls IS the subtitle; the loop ends when you emit text with no tool call.

The user can stop you at any time (× on the bar, Esc, double-tap Space, opening the palette). Handled cleanly — don't worry about it.`;
}

function renderSafety(): string {
  return `# Safety

- Some actions are flagged \`requireConfirmation\` — the runtime pauses and asks the user before running. Don't try to bypass.
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

/**
 * Render the persona block when the host provides one. Empty / undefined
 * input returns '' so the section is silently skipped — the SDK ships
 * with NO default persona, hosts opt in.
 *
 * The block is intentionally directive ("you ARE …, speak as 'we'") so
 * smaller models actually shift voice. Without this, models default to
 * a third-person observer narrating the page DOM — which reads to users
 * as the agent being unaware of its own context.
 */
function renderPersona(persona: PersonaInput | undefined): string {
  if (!persona) return '';
  const cfg: PersonaConfig = typeof persona === 'string'
    ? { identity: persona }
    : persona;
  if (!cfg.identity?.trim()) return '';
  const lines: string[] = ['# Who you are', '', cfg.identity.trim()];
  lines.push('');
  lines.push('Speak as this identity — first-person ("we"), never "the site says…".');
  if (cfg.voice?.trim()) {
    lines.push('');
    lines.push(`Voice: ${cfg.voice.trim()}`);
  }
  if (cfg.constraints?.length) {
    lines.push('');
    lines.push('Hard constraints:');
    for (const c of cfg.constraints) lines.push(`- ${c}`);
  }
  return lines.join('\n');
}

/**
 * Render the host's palette as the body of the `run_palette` tool
 * description. Caller (the runtime, when rebuilding tool defs) appends
 * this to the static description so the model sees the available
 * command ids WITHIN the tool it's about to call — not in a separate
 * system prompt section it might overlook.
 *
 * Returns '' when the palette is empty / unavailable; callers should
 * skip appending in that case.
 */
export function renderPaletteCommandsForToolDescription(items: PaletteCommandSummary[] | undefined): string {
  if (!items || items.length === 0) return '';
  const lines: string[] = ['', 'Registered palette commands:'];
  for (const it of items) {
    const desc = it.description ? ` — ${it.description}` : '';
    const arg = it.acceptsArg ? ' (takes arg)' : '';
    const prefix = it.prefix ? ` [${it.prefix}]` : '';
    lines.push(`- ${it.name}${prefix}${arg}${desc}`);
  }
  lines.push('');
  lines.push('After open, items appear in DOM dump — `click` the one that matches.');
  return lines.join('\n');
}

function renderOutputLanguage(locale?: string): string {
  const hint = locale
    ? `Host locale hint: \`${locale}\` — only a tiebreaker when input is ambiguous.`
    : `Detect reply language from the user's first clear sentence.`;
  return `# Language

Reply language = user's input language. ${hint} Page DOM language doesn't decide it.

If the user asks to translate / rewrite into a target language, the payload goes in THAT language; only the wrapper ("here it is") follows reply language.

# Style

Plain prose, conversational, no markdown, no emoji. Each narrate: 1–3 short sentences.`;
}

// ─── helpers used by webagent.buildMessages for the per-turn user msg ─

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

export function renderSelectionBlock(sel: SelectionContext): string {
  const parts: string[] = ['# User selection at invocation'];
  parts.push(
    "The user pointed at this BEFORE invoking you — read its CONTENT to understand what they're asking about. Don't reflex-frame it with `border` just because it's referenced."
  );
  if (sel.text) parts.push(`- Selected content:\n"""\n${sel.text}\n"""`);
  if (sel.elements?.length) {
    parts.push(`- Internal selector (tool calls only — never mention to user): ${sel.elements.join(', ')}`);
    parts.push(`- If you DO need to act on the selected element, pass these selectors verbatim.`);
  }
  if (sel.bbox) parts.push(`- Selection bbox: ${JSON.stringify(sel.bbox)}`);
  if (sel.images?.length) parts.push(`- ${sel.images.length} image(s) attached as visual context.`);
  return parts.join('\n');
}

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
  } catch { /* SSR */ }
  lines.push('');
  lines.push('# Page DOM');
  lines.push(opts.pageContext);
  return lines.join('\n');
}

/**
 * Re-inject the user's latest query as a system-reminder at the end of
 * the messages. Without this, after a couple of tool turns the model
 * tends to think the task is finished after the first clause —
 * especially when the first clause involves navigation. Re-stating the
 * original request keeps every clause in view.
 */
export function renderUserReminder(opts: {
  latestUserText: string;
  stepsSoFar: AgentTurn[];
  currentUrl?: string;
  cotMode?: boolean;
}): string {
  if (opts.cotMode) return renderCotReminder(opts);
  const stepLines: string[] = [];
  let pauseCount = 0;
  let lastWasPause = false;
  let navigatedThisRun = false;
  let lastNavigateIdx = -1;
  let borderHighlightAfterNav = 0;
  for (let i = 0; i < opts.stepsSoFar.length; i++) {
    const t = opts.stepsSoFar[i]!;
    if (t.kind !== 'agent_step') continue;
    const ok = t.result.ok ? '✓' : '✗';
    stepLines.push(`- ${ok} ${t.toolCall.name}(${JSON.stringify(t.toolCall.arguments).slice(0, 80)})`);
    if (t.toolCall.name === 'pause') pauseCount++;
    lastWasPause = t.toolCall.name === 'pause';
    if (t.toolCall.name === 'navigate' && t.result.ok) {
      navigatedThisRun = true;
      lastNavigateIdx = i;
      borderHighlightAfterNav = 0;
    }
    if (lastNavigateIdx >= 0 && i > lastNavigateIdx && (t.toolCall.name === 'border' || t.toolCall.name === 'highlight')) {
      borderHighlightAfterNav++;
    }
  }
  const stepBlock = stepLines.length === 0
    ? '(no tools executed yet)'
    : stepLines.join('\n');

  // Derive pacing hint from the actual trace — concrete observation about
  // THIS run feels less like nagging than a generic always-on rule.
  let pacingHint = '';
  if (stepLines.length >= 2 && pauseCount === 0) {
    pacingHint = '\nWatch your pacing: you have taken actions but never called `pause`. Each subject should end with a pause so the user presses Space to continue.';
  } else if (navigatedThisRun && borderHighlightAfterNav === 0) {
    // Just arrived at the destination. The agent's biggest failure mode
    // here is to dump a summary paragraph and pause-close. Force the
    // first post-arrival turn to actually start the subject-by-subject
    // walkthrough.
    pacingHint = '\nYou just arrived at the destination — this is the first post-navigate turn. Do NOT write a summary paragraph and pause-close. Pick the FIRST subject on this page (the first `[N]<section>` / `[N]<article>` / `[N]<tr>` in reading order), `border` it, narrate 1–3 sentences about THAT subject (not the whole page), then `pause`. The next turn picks the next subject; at least 2 subjects total.';
  } else if (pauseCount >= 3 && lastWasPause) {
    // Already paused 3+ times — the page is finite and the model is
    // looping. Push hard toward termination so the agent doesn't keep
    // asking "next?" forever and start framing random elements just to
    // produce something new.
    pacingHint = '\nYou have already paused 3+ times this run. Most pages have 3–5 main subjects; if you have covered the substantive content, STOP NOW. Emit one short closing sentence (not a recap, not "is there anything else") and NO tool call — the loop ends. Do NOT call `pause` again. Do NOT `border` a new element just to extend the conversation. Asking "next?" when you have nothing new to show is worse than ending cleanly.';
  } else if (lastWasPause) {
    pacingHint = '\nLast step was `pause` and the user just pressed Space — move to the NEXT subject in reading order that you have NOT already discussed. Frame it first, narrate it in 1–3 sentences quoting actual page content, then `pause`. If there is no new subject left, stop instead: one closing sentence and no tool call.';
  }

  const urlLine = opts.currentUrl ? `\nCurrent URL: ${opts.currentUrl}` : '';

  return `<reminder>
User said: "${opts.latestUserText}"${urlLine}
Done so far:
${stepBlock}${pacingHint}

STEP 1 — Destination check (do this first, every turn, before anything else):
Did the user name a destination on the site? Look at the sitemap routes. Does any route's path or description match that destination? If yes AND that route's URL is NOT the current URL above → your FIRST tool call this turn MUST be \`navigate\` to that route's path. Do NOT emit any text, do NOT border anything, do NOT call \`pause\` — just navigate. You are at the WRONG URL right now; every word of narration you would write describes a page the user isn't looking at.

The home-page section / card / button that shares the destination's name is a TEASER, not the destination. Do not treat its content as if you had arrived.

NEVER say "I brought you to X" / "Here at X" / equivalent without an actually-successful navigate to X earlier this run. That is hallucination — the worst failure mode of this agent.

STEP 2 — Tour mode:
If the user's verb means explain / walk through / introduce / show me around, the task is a TOUR. After arriving at the destination, walk through it subject-by-subject — at least 2 separate subjects, each with (border or highlight) → 1–3 sentences → \`pause\`. Don't dump a one-paragraph summary of the page and call it done.

Per-turn rules:
- ONE subject per turn. Don't introduce multiple subjects in one paragraph.
- Don't narrate your own behaviour (no "I will", "I just", "let me", "to recap").
- Quote concrete words from the DOM dump — visible labels, prices, headings, descriptions.
- NEVER frame an element you have already framed earlier this run. Look at the trace above — if you already \`border\`-ed it, move on or stop. Pages are finite.
- Pause notes hint at the next beat ("ready for the next?"), not at finality.

Loop control — when to STOP:
The page is finite. Once you have covered the main subjects of the user's request, STOP. Concretely:
- Every clause of the user's message is addressed by a successful step, AND
- A tour has covered at least 2 subjects, AND
- There are no further distinct subjects on the page that you have not already discussed,
then emit one short closing sentence (NOT a recap, NOT a list of what you did) and NO tool call. The loop ends.

Do NOT keep paginating with \`pause\` forever. Do NOT \`border\` a fresh element just to have something new to say. If the trace shows you have already paused many times and there is nothing distinctly new left, the correct move is to stop.

Loop control — when to continue:
Otherwise (still subjects to cover, or clauses not yet addressed): pick the next DISTINCT subject in reading order — one you have not already framed — narrate it, then \`pause\`.
</reminder>`;
}

/**
 * CoT-mode per-turn reminder — small, context-only. Does NOT carry the
 * procedural rules from the classic reminder (no STEP 1 / STEP 2, no
 * pause-counting, no tour-mode prescription). Just re-grounds the model
 * on the user's question and surfaces concrete observations from this
 * run that should change the next action — chiefly repeated failures
 * on the same selector, so the model picks a different strategy.
 */
function renderCotReminder(opts: {
  latestUserText: string;
  stepsSoFar: AgentTurn[];
  currentUrl?: string;
}): string {
  // Walk recent agent_turn steps; collect per-action results from their
  // result.data.action_results array (set by executeCotLoop). Track which
  // (tool, selector) pairs have failed and how often, in the last N steps.
  const failures: Map<string, number> = new Map();
  const recentSteps: string[] = [];
  let stepsSeen = 0;
  for (let i = opts.stepsSoFar.length - 1; i >= 0 && stepsSeen < 6; i--) {
    const t = opts.stepsSoFar[i]!;
    if (t.kind !== 'agent_step') continue;
    stepsSeen++;
    if (!t.result.ok) continue;
    const data = t.result.data as { action_results?: Array<{ type: string; name?: string; ok?: boolean; reason?: string }> } | undefined;
    const results = data?.action_results;
    if (!Array.isArray(results)) continue;
    for (const r of results) {
      if (r.type === 'tool' && r.ok === false && r.name) {
        const key = r.name;
        failures.set(key, (failures.get(key) ?? 0) + 1);
      }
      recentSteps.push(
        r.type === 'narrate'
          ? `narrate`
          : `${r.name}${r.ok === false ? ` ✗ (${r.reason ?? 'failed'})` : ' ✓'}`,
      );
    }
  }

  // Stuck hint — only fire when a tool has failed 2+ times recently. Gives
  // the model a concrete observation (not a generic "be careful") so it
  // shifts strategy.
  const stuck: string[] = [];
  for (const [tool, count] of failures) {
    if (count >= 2) stuck.push(`\`${tool}\` has failed ${count}× in recent turns`);
  }
  const stuckHint = stuck.length > 0
    ? `\n\nObservation: ${stuck.join(', ')}. Do NOT retry the same call shape. Pick a different selector (parent / sibling / alternative target visible in the DOM dump), a different action (e.g. scroll into view first, or focus + Enter instead of click), or ask the user with \`ask_user_choice\` for clarification.`
    : '';

  const recentBlock = recentSteps.length > 0
    ? `\nRecent actions: ${recentSteps.slice(-12).join(' → ')}`
    : '';
  const urlLine = opts.currentUrl ? `\nCurrent URL: ${opts.currentUrl}` : '';

  return `<reminder>
User said: "${opts.latestUserText}"${urlLine}${recentBlock}${stuckHint}
</reminder>`;
}
