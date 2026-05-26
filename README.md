<h1 align="center">
  <img src="./media/logo.png" alt="" width="56" align="absmiddle" />
  &nbsp;dotdotduck
</h1>

<p align="center"><strong>Press Cmd/Ctrl+K to do anything in your product.</strong></p>

<p align="center">
  Command palette + voice + long-press selection + inline AI + DOM-grounded agent in one SDK.
  The opposite of a chatbot widget — your product's verbs sit where users already work, not in a corner bubble.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@perhapxin/dddk"><img src="https://img.shields.io/npm/v/@perhapxin/dddk.svg?style=flat-square" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/@perhapxin/dddk"><img src="https://img.shields.io/npm/dm/@perhapxin/dddk.svg?style=flat-square" alt="downloads" /></a>
  <a href="https://github.com/PerhapxinLab/dotdotduck/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue?style=flat-square" alt="license" /></a>
  <a href="https://dddk.perhapxin.com/docs/v0.1.0/dddk/overview"><img src="https://img.shields.io/badge/docs-online-blue?style=flat-square" alt="docs" /></a>
</p>

---

## 01 · Command palette — every feature, behind one panel

<table>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-palette.png" alt="Cmd+K palette open: /introduce, /theme, /language, /immersive_translate, #find-on-page, docs: search, Go to entries — all in one list" />
</td>
<td width="45%" valign="top">

**Open** &nbsp; `Ctrl/⌘+K`. Your commands sit next to Ask AI in one list.

**Prefix routing** &nbsp; `/command`, `@entity`, `order:`, `#tag` — drill in from the keyboard.

**Customisation** &nbsp; three layers — CSS variables for theme · Skill SDK for behaviour (Script / Prompt / Action / Surface / Panel) · drop in existing host actions as palette items.

**Zero built-ins** &nbsp; what shows in the palette is 100% yours to decide.

</td>
</tr>
</table>

---

## 02 · WebAgent — operates the page, not a sidebar chatbot

<table>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-webagent.png" alt="agent narrating its next step in the subtitle bar with space-continue / double-tap-exit / esc-cancel hint and confirm buttons" />
</td>
<td width="45%" valign="top">

**Loop** &nbsp; DOM-grounded · reads the visible page · picks a tool · narrates each step.

**19 built-in actions** &nbsp; `navigate` · `click` · `fill_input` · `scroll` · `screenshot` · `ask_user` · `ask_user_choice` · `show_subtitle` · `wait` · `border` · `highlight` · …

**Space-gated** &nbsp; single tap accept · double-tap reject · Esc cancel. Every step is visible before it runs.

**Asks back** &nbsp; `ask_user_choice` for 2-4 options, `ask_user` for free text. No silent decisions.

**BYO LLM** &nbsp; OpenAI · Google AI Studio · `ProxyProvider` that hides keys server-side.

</td>
</tr>
</table>

---

## 03 · Inline Agent — select text, AI without leaving the input

<table>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-inline.png" alt="floating Edit with AI menu next to a textarea selection: Translate / Improve writing / Fix spelling & grammar / Make shorter / Make longer / Change to professional tone / Explain this" />
</td>
<td width="45%" valign="top">

**Trigger** &nbsp; highlight any text in any `<input>` / `<textarea>` / `[contenteditable]` → floating toolbar below the selection.

**7 default actions** &nbsp; Translate · Improve · Fix grammar · Shorter · Longer · Professional tone · Explain.

**Result** &nbsp; streams back in place of the selection. No leaving the field.

**Customise** &nbsp; drop defaults, add your own · two-column layout option · optional keyboard shortcuts.

**IME-safe** &nbsp; CJK candidate typing never accidentally triggers.

</td>
</tr>
</table>

---

## 04 · Direct manipulation — gestures you already know

Four physical ways to send context into dddk. No new vocabulary to learn.

<table>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-voice.png" alt="long-press space, subtitle bar shows live 'Listening — release to send' indicator" />
</td>
<td width="45%" valign="top">

**A · Hold Space — voice in**

- Subtitle shows *"Listening — release to send"*. Release to commit.
- Focus inside an input → fills the input. Anywhere else → goes to the agent.
- Web Speech for STT + optional LLM cleanup pass.

</td>
</tr>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-dwell.png" alt="long-press a DOM element ~1s and a frame pins around it" />
</td>
<td width="45%" valign="top">

**B · Long-press anything — Dwell**

- Long-press any element for ~1s → frame pins around it.
- Next `Ctrl+K` opens the palette with that element as context.
- Visual elements (charts, images) ship an **auto-screenshot**.

</td>
</tr>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-drag.png" alt="drag a rectangle anywhere on the page — the captured region is attached to your next Ask AI / agent question" />
</td>
<td width="45%" valign="top">

**C · Drag a screenshot**

- Click the camera in the palette → drag a rectangle on the page.
- Captured region attaches to your next Ask AI / agent question.
- Charts, dashboards, maps — show the AI exactly what you mean.

</td>
</tr>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-introduce.png" alt="/introduce running: subtitle bar narrates Feature 1 · Command palette with step counter 1/2 + space → next page hint, page section framed in purple" />
</td>
<td width="45%" valign="top">

**D · `/introduce` — guided tour**

- Declarative tours — list of `page` + `subtitle` + `action(tools)` steps.
- Space advances · Esc / double-Space exits. User reads at their pace.
- Write your onboarding / feature tour once · replay any time (palette command, proactive prompt, or programmatic).

</td>
</tr>
</table>

---

## 05 · Mobile — FAB + your own buttons

<table>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-mobile.png" alt="mobile portrait view: dotdotduck FAB at bottom-right corner, 'Listening — release to send' indicator shown above the FAB while voice is active" />
</td>
<td width="45%" valign="top">

**Floating action button** &nbsp; ships out of the box on mobile breakpoints — tap to open palette, long-press to hold-talk.

**Touch gestures** &nbsp; the same Space-hold / long-press / multi-choice patterns work via touch — `tap → palette`, `long-press → voice`, digits → option pick.

**Your own button** &nbsp; replace the duck FAB with any host element. Pass a selector or HTMLElement; dddk wires the open / hold-talk handlers onto it so the FAB lives wherever your design wants — header bar, side rail, your own brand asset.

**Responsive chrome** &nbsp; subtitle bar auto-offsets above the on-screen keyboard · palette becomes full-width below 640px.

</td>
</tr>
</table>

---

## 06 · Proactive — read the signal, ask the right question

<table>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-proactive.png" alt="subtitle bar showing yes/no prompt 'Your Monday order just shipped — want me to pull the tracking?' and multi-choice 'How should I handle this return?' with options" />
</td>
<td width="45%" valign="top">

**Subscribes** &nbsp; scroll · dwell · time-on-page · last interaction.

**Yes / no** &nbsp; Space accepts · double-Space rejects.

**Multi-choice** &nbsp; `1-9` to pick · always a trailing **Other** slot for free text.

**Stays in the subtitle bar** &nbsp; no popup chrome · no layout shift.

**Emits intents** &nbsp; `proactive_accepted` / `agent_choice` so you measure what lands — not big-data fishing, direct asking + recorded answers.

</td>
</tr>
</table>

---

## 07 · Intent stream — every yes / no is a signal, the dashboard writes itself

<table>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-dashboard.png" alt="dotdotduck dashboard: 3 sessions, 2 visitors, 577 events, 118 palette opens, geography panel, top palette items table" />
</td>
<td width="45%" valign="top">

**Every interaction emits a typed event** &nbsp; palette opens, voice transcripts, agent answers, accept / reject gestures, Dwell pins, multi-choice picks.

**Event types** &nbsp; `palette_activated` · `voice_attempt` · `proactive_accepted` · `agent_choice` · `agent_feedback` · `dwell_pinned` · `inline_ai_applied`.

**Clean behavioural data** &nbsp; direct asking, recorded answers.

**Bundled dashboard** &nbsp; turns the stream into charts, or pipe it to Mixpanel · Amplitude · your own BI.

</td>
</tr>
</table>

---

## Status — early stage, read before evaluating

dotdotduck is in active development. It works, but expect rough edges. A few things up front:

- **Clone the repo to evaluate properly.** The bundled docs are useful as a map, but the source is the source of truth. `git clone https://github.com/PerhapxinLab/dotdotduck` into your project directory and read the code alongside the [online docs](https://dddk.perhapxin.com/docs) — that's the recommended way to understand what's actually implemented.
- **The docs are AI-drafted.** They're written and maintained with Claude Code. They stay close to the code by convention, but if something looks wrong, grep the repo before assuming the docs are right.
- **Found a bug or unclear behaviour?** Open an issue at [github.com/PerhapxinLab/dotdotduck/issues](https://github.com/PerhapxinLab/dotdotduck/issues) — one-liners help shape the roadmap.

## Documentation

- **Full docs** → [dddk.perhapxin.com/docs](https://dddk.perhapxin.com/docs/v0.1.0/dddk/overview)
- **Agent** (DOM-grounded loop + InlineAgent + sitemap + Memory) → [/dddk/agent](https://dddk.perhapxin.com/docs/v0.1.0/dddk/agent/overview)
- **LLM** providers + router + adapter registry → [/dddk/llm](https://dddk.perhapxin.com/docs/v0.1.0/dddk/llm/providers)
- **Skills** system + evals → [/dddk/skills](https://dddk.perhapxin.com/docs/v0.1.0/dddk/skills/overview)
- **Modules** (voice / Dwell / inline / immersive translate / proactive / analytics) → [/dddk/modules](https://dddk.perhapxin.com/docs/v0.1.0/dddk/modules/overview)
- **Toolbox** (search + recommend) → [/dddk/toolbox](https://dddk.perhapxin.com/docs/v0.1.0/dddk/toolbox/overview)
- **Theming** → [/dddk/theming](https://dddk.perhapxin.com/docs/v0.1.0/dddk/theming)

## Install

```bash
pnpm add @perhapxin/dddk
# or: npm i @perhapxin/dddk
```

```ts
import { DotDotDuck, OpenAIProvider } from '@perhapxin/dddk';
import '@perhapxin/dddk/styles.css';

const dddk = new DotDotDuck({
  llm: new OpenAIProvider({
    apiKey: import.meta.env.VITE_OPENAI_KEY,
    model: 'gpt-5.4-mini',
  }),
  siteName: 'YourSaaS',
  skills: [
    {
      id: 'introduce',
      type: 'script',
      name: 'Tour the app',
      steps: [
        { subtitle: 'Welcome!', action: (t) => t.spotlight('.hero') },
        { subtitle: 'Here is pricing.', action: (t) => t.highlight('.pricing'), waitForUser: true },
      ],
    },
  ],
});

dddk.mount();
```

Press `Ctrl/⌘+K`, type `/introduce`, watch it run. The full [quickstart guide](https://dddk.perhapxin.com/docs/v0.1.0/dddk/quickstart-frameworks) covers React / Vue / Svelte / Solid wiring.

## Theming

Everything visual reads from CSS custom properties — `--dddk-bg`, `--dddk-accent`, `--dddk-radius`, `--dddk-font`, and friends. Override at `:root` or scope inside any wrapper.

```css
:root {
  --dddk-accent: #6366f1;       /* your brand colour */
  --dddk-radius: 10px;
  --dddk-font: 'Inter', system-ui, sans-serif;
}
```

Dark mode is automatic: `[data-theme="dark"]` anywhere up the tree, OR `@media (prefers-color-scheme: dark)` — whichever fires first. Custom modes (sepia, high-contrast, brand-specific) work by overriding the same variables under a new selector.

## License

<table>
<tr>
<th width="50%" align="left">AGPL-3.0-or-later — free</th>
<th width="50%" align="left">Commercial — paid</th>
</tr>
<tr>
<td valign="top">

✓ Open-source projects
<br />✓ Internal tools
<br />✓ Personal projects
<br />✓ Anything AGPL-compatible
<br /><br />
Use it, modify it, ship it — publish your modifications under AGPL.

</td>
<td valign="top">

✓ Closed-source products
<br />✓ Commercial SaaS
<br />✓ Anything that can't satisfy AGPL's network-copyleft clause
<br /><br />
See [LICENSE](./LICENSE) for the full text or reach the maintainer through the repo.

</td>
</tr>
</table>

---

<p align="center">Built by Perhapxin Team</p>
