<h1 align="center">
  <img src="https://dddk.perhapxin.com/icon.png" alt="" width="40" align="absmiddle" />
  &nbsp;dotdotduck
</h1>

<p align="center"><strong>Press Cmd/Ctrl+K to do anything in your product.</strong></p>

<p align="center">
  Command palette + voice + long-press selection + inline AI + DOM-grounded agent in one SDK.
  The opposite of a chatbot widget — your product's verbs sit where users already work, not in a corner bubble.
</p>

<p align="center">
  <img src="./media/readme/dddk-palette.png" alt="dotdotduck command palette open, with host commands, skills, and the Ask AI box mixed in one list" width="780" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@perhapxin/dddk"><img src="https://img.shields.io/npm/v/@perhapxin/dddk.svg?style=flat-square" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/@perhapxin/dddk"><img src="https://img.shields.io/npm/dm/@perhapxin/dddk.svg?style=flat-square" alt="downloads" /></a>
  <a href="https://github.com/PerhapxinLab/dotdotduck/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue?style=flat-square" alt="license" /></a>
  <a href="https://dddk.perhapxin.com/docs/v0.1.0/dddk/overview"><img src="https://img.shields.io/badge/docs-online-blue?style=flat-square" alt="docs" /></a>
</p>

---

## 01 · Command palette — every feature, behind one panel

<img src="./media/readme/dddk-palette.png" alt="Cmd+K palette open: /introduce, /theme, /language, /immersive_translate, #find-on-page, docs: search, Go to entries — all in one list" width="780" />

`Ctrl/⌘+K` opens it. Your registered commands — switch theme, change language, open billing, find a customer — sit alongside Ask AI in the same list. Prefix routing (`/command`, `@entity`, `order:`) gives the user **one convenient entry point that solves whatever they're stuck on, no matter where they are in the product**.

Three customisation layers stack:

1. **Theme** via CSS variables — `--dddk-accent`, `--dddk-radius`, `--dddk-font`, etc.
2. **Skill SDK** — declarative Script / Prompt / Action / Surface / Panel units the agent (and the user) can invoke.
3. **Drop-in palette items** — register what your product already does as palette rows.

The SDK ships with **zero built-in commands**. What shows up in the palette is entirely yours to decide.

---

## 02 · WebAgent — an agent that operates the page, not a sidebar chatbot

<img src="./media/readme/dddk-webagent.png" alt="agent narrating its next step in the subtitle bar with space-continue / double-tap-exit / esc-cancel hint and confirm buttons" width="780" />

`WebAgent` is the engine inside dotdotduck — DOM-grounded, runs in the user's tab. Nineteen built-in actions (`navigate` / `click` / `fill_input` / `scroll` / `screenshot` / `ask_user` …) compose into multi-step tasks.

- LLM picks one action at a time.
- Subtitle bar **narrates each step** in the user's language.
- The agent **asks back** when a decision is needed (`ask_user_choice` for 2-4 options, `ask_user` for free text).
- Single-tap Space accepts, double-tap rejects, Esc cancels. Every step is gated.

Voice is the other entry point: hold Space for Web Speech STT, the transcript gets an optional LLM cleanup pass, then the agent runs. Provider is your call — OpenAI, Google AI Studio, or `ProxyProvider` that hides keys behind your server.

---

## 03 · Inline Agent — select text, AI without leaving the input

<img src="./media/readme/dddk-inline.png" alt="floating Edit with AI menu next to a textarea selection: Translate / Improve writing / Fix spelling & grammar / Make shorter / Make longer / Change to professional tone / Explain this" width="780" />

Highlight any text in any `<input>` / `<textarea>` / `[contenteditable]` — a floating toolbar appears next to your selection: **Translate, Improve writing, Fix grammar, Make shorter / longer, Change to professional tone, Explain**. Pick one, the result streams back in place of the selection.

- Actions are **customisable** — drop the defaults, add your own (`/bold-on-rewrite`, `/translate-with-glossary`).
- Layout supports two-column, optional keyboard shortcuts (`Ctrl+Shift+R` to rewrite, etc.).
- **IME-composition-aware** — typing Chinese / Japanese / Korean candidates never accidentally triggers the toolbar.

---

## 04 · Direct manipulation — gestures you already know

Four physical ways to send context into dddk. No new vocabulary to learn.

<table>
<tr>
<td width="50%" valign="top">
  <img src="./media/readme/dddk-voice.png" alt="long-press space, subtitle bar shows live 'Listening — release to send' indicator" />
  <br /><strong>A · Hold Space — voice in</strong>
  <br /><em>Press and hold Space anywhere. The subtitle bar shows "Listening — release to send." Release to send. Focused inside an input → transcript fills it. Anywhere else → goes to the agent as a question.</em>
</td>
<td width="50%" valign="top">
  <img src="./media/readme/dddk-dwell.png" alt="long-press a DOM element ~1s and a frame pins around it" />
  <br /><strong>B · Long-press anything — Dwell</strong>
  <br /><em>Dwell: long-press any element for ~1s and a frame pins around it. Next Ctrl+K opens the palette with that element as context. Visual elements (charts, images) ship with an auto-screenshot.</em>
</td>
</tr>
<tr>
<td width="50%" valign="top">
  <strong>C · /introduce — guided tour</strong>
  <br /><em>Script Skills are declarative tours: a list of `page` + `subtitle` + `action(tools)`, Space to advance. Write your onboarding / feature tour once, replay any time the user types <code>/introduce</code>.</em>
</td>
<td width="50%" valign="top">
  <strong>D · Drag a screenshot</strong>
  <br /><em>Click the camera in the palette and drag a rectangle anywhere on the page — the captured region is attached to your next Ask AI / agent question. Charts, dashboards, maps — show the AI exactly what you mean instead of describing it.</em>
</td>
</tr>
</table>

---

## 05 · Proactive — read the signal, ask the right question

The agent subscribes to page signals (scroll, dwell, time-on-page, last interaction) and surfaces an offer in the subtitle bar when conditions match.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Your Monday order just shipped — want me to pull the tracking?      │
│                                                                      │
│  [ Space  yes ]  [ Space×2  no ]                                     │
└──────────────────────────────────────────────────────────────────────┘
→ intent: proactive_accepted, action: 'track_order', via: 'voice'
```

- **Yes / No** resolves with Space (accept) / double-tap (reject).
- **Multi-choice** uses `1-9` number keys + a trailing **Other** slot that always accepts free text.
- The whole exchange stays in the subtitle bar — no popup chrome, no layout shift.

Typical customer-service plays: order just shipped → "Want me to pull the tracking?"; user lingers on the returns page → list three common actions.

---

## 06 · Intent stream — every yes / no is a signal, the dashboard writes itself

<img src="./media/readme/dddk-dashboard.png" alt="dotdotduck dashboard: 3 sessions, 2 visitors, 577 events, 118 palette opens, geography panel, top palette items table" width="780" />

Every accept, reject, multi-choice pick, voice transcript, and Dwell pin emits a typed event:

| Event | What it tells you |
|---|---|
| `palette_activated` | Which command was opened |
| `voice_attempt` | Voice attempt succeeded or failed |
| `proactive_accepted` | Proactive offer accepted / rejected |
| `agent_choice` | Which multi-choice option was picked |
| `agent_feedback` | Did the user accept the agent's final answer |
| `dwell_pinned` | Which element was pinned |
| `inline_ai_applied` | Which inline-AI action was applied |

Subscribe once and you have **clean behavioural data** — who wanted a refund, who wanted to upgrade, which proactive offers land, which agent actions get rejected. Not big-data fishing — direct asking and recorded answers. The built-in dashboard route turns the stream into charts, or pipe it to Mixpanel / Amplitude / your own BI.

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
