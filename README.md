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

- **Ctrl/⌘+K opens it.** Your registered commands sit alongside Ask AI in the same list.
- **Prefix routing** — `/command`, `@entity`, `order:`, `#tag` — drill in without leaving the keyboard.
- **One convenient entry point** no matter where the user is in the product.
- **Three customisation layers**: CSS-variable theming, Skill SDK (Script / Prompt / Action / Surface / Panel), or drop-in palette items.
- **Zero built-in commands.** What shows up in the palette is entirely yours to decide.

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

- **DOM-grounded autonomous loop.** Reads the visible page, picks a tool, narrates each step.
- **19 built-in actions** — `navigate` · `click` · `fill_input` · `scroll` · `screenshot` · `ask_user` · `ask_user_choice` · `show_subtitle` · `wait` · `border` · `highlight` · `set_text` · `select_option` · `submit_form` · etc.
- **Gated by Space** — single tap accept · double-tap reject · Esc cancel. Every step is visible before it runs.
- **Asks back** when ambiguous — `ask_user_choice` for 2-4 options, `ask_user` for free text.
- **Voice as an entry point** — hold Space, transcript flows into the same agent. Optional LLM cleanup pass.
- **Bring your own LLM** — OpenAI, Google AI Studio, or `ProxyProvider` that hides keys server-side.

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

- **Highlight any text** in any `<input>` / `<textarea>` / `[contenteditable]` — a floating toolbar appears below the selection.
- **Seven default actions** — Translate · Improve writing · Fix spelling & grammar · Make shorter · Make longer · Change to professional tone · Explain this.
- **Result streams back in place** of the selection.
- **Custom actions** — drop the defaults, add your own (`/translate-with-glossary`, etc.).
- **Two-column layout** option for editor hosts; optional keyboard shortcuts (e.g. `Ctrl+Shift+R` to rewrite).
- **IME-composition-aware** — Chinese / Japanese / Korean candidate typing never accidentally triggers the toolbar.

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

- Press and hold Space anywhere. Subtitle bar shows "Listening — release to send".
- Release to send. Focused in an input → fills the input. Anywhere else → goes to the agent.
- Web Speech for STT; optional LLM cleanup pass removes fillers + fixes punctuation.

</td>
</tr>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-dwell.png" alt="long-press a DOM element ~1s and a frame pins around it" />
</td>
<td width="45%" valign="top">

**B · Long-press anything — Dwell**

- Long-press any element for ~1s. A frame pins around it.
- Next `Ctrl+K` opens the palette with that element as context.
- Visual elements (charts, images) ship with an **auto-screenshot** so the agent can see what you mean.

</td>
</tr>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-drag.png" alt="drag a rectangle anywhere on the page — the captured region is attached to your next Ask AI / agent question" />
</td>
<td width="45%" valign="top">

**C · Drag a screenshot**

- Click the camera in the palette and drag a rectangle anywhere on the page.
- The captured region attaches to your next Ask AI / agent question.
- Charts, dashboards, maps — show the AI exactly what you mean instead of describing it.

</td>
</tr>
</table>

**D · `/introduce` — guided tour** — Script Skills are declarative tours: a list of `page` + `subtitle` + `action(tools)`, Space to advance. Write your onboarding / feature tour once, replay any time the user types `/introduce` (or runs it from a palette command, or fires it as a proactive prompt).

---

## 05 · Proactive — read the signal, ask the right question

<table>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-proactive.png" alt="subtitle bar showing yes/no prompt 'Your Monday order just shipped — want me to pull the tracking?' and multi-choice 'How should I handle this return?' with Open an RMA / Check order status / Escalate to a human / Other options" />
</td>
<td width="45%" valign="top">

- **Subscribes to page signals** — scroll, dwell, time-on-page, last interaction.
- **Yes / no** resolves with Space (accept) / double-tap (reject).
- **Multi-choice** picks with `1-9` plus a trailing **Other** slot for free text.
- **Stays in the subtitle bar** — no popup chrome, no layout shift.
- **Every response emits an intent** (`proactive_accepted` / `agent_choice`) so you measure what lands.
- **Typical customer-service plays** — order just shipped → "Want me to pull the tracking?"; user lingers on returns → list three common actions.

</td>
</tr>
</table>

---

## 06 · Intent stream — every yes / no is a signal, the dashboard writes itself

<table>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-dashboard.png" alt="dotdotduck dashboard: 3 sessions, 2 visitors, 577 events, 118 palette opens, geography panel, top palette items table" />
</td>
<td width="45%" valign="top">

- **Every interaction emits a typed event** — palette opens, voice transcripts, agent answers, accept / reject gestures, Dwell pins, multi-choice picks.
- **Built-in event types**: `palette_activated` · `voice_attempt` · `proactive_accepted` · `agent_choice` · `agent_feedback` · `dwell_pinned` · `inline_ai_applied`.
- **Clean behavioural data** — direct asking and recorded answers, not big-data fishing.
- **Bundled dashboard route** turns the stream into charts, or pipe it to Mixpanel / Amplitude / your own BI.

</td>
</tr>
</table>

---

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

## Documentation

- **Full docs** → [dddk.perhapxin.com/docs](https://dddk.perhapxin.com/docs/v0.1.0/dddk/overview)
- **Agent** (DOM-grounded loop + InlineAgent + sitemap + Memory) → [/dddk/agent](https://dddk.perhapxin.com/docs/v0.1.0/dddk/agent/overview)
- **LLM** providers + router + adapter registry → [/dddk/llm](https://dddk.perhapxin.com/docs/v0.1.0/dddk/llm/providers)
- **Skills** system + evals → [/dddk/skills](https://dddk.perhapxin.com/docs/v0.1.0/dddk/skills/overview)
- **Modules** (voice / Dwell / inline / immersive translate / proactive / analytics) → [/dddk/modules](https://dddk.perhapxin.com/docs/v0.1.0/dddk/modules/overview)
- **Toolbox** (search + recommend) → [/dddk/toolbox](https://dddk.perhapxin.com/docs/v0.1.0/dddk/toolbox/overview)
- **Theming** → [/dddk/theming](https://dddk.perhapxin.com/docs/v0.1.0/dddk/theming)

## Status — early stage, read before evaluating

dotdotduck is in active development. It works, but expect rough edges. A few things up front:

- **Clone the repo to evaluate properly.** The bundled docs are useful as a map, but the source is the source of truth. `git clone https://github.com/PerhapxinLab/dotdotduck` into your project directory and read the code alongside the [online docs](https://dddk.perhapxin.com/docs) — that's the recommended way to understand what's actually implemented.
- **The docs are AI-drafted.** They're written and maintained with Claude Code. They stay close to the code by convention, but if something looks wrong, grep the repo before assuming the docs are right.
- **Found a bug or unclear behaviour?** Open an issue at [github.com/PerhapxinLab/dotdotduck/issues](https://github.com/PerhapxinLab/dotdotduck/issues) — one-liners help shape the roadmap.

## License

**AGPL-3.0-or-later** for open-source use — internal tools, personal projects, anything AGPL-compatible. **Commercial licenses** are available for closed-source / SaaS deployments that need to stay free of AGPL's network-copyleft obligations — see [LICENSE](./LICENSE) or reach the maintainer through the repo.

---

<p align="center">Built by Perhapxin Team</p>
