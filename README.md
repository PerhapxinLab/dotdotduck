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
  <a href="https://www.npmjs.com/package/@perhapxin/dddk"><img src="https://img.shields.io/npm/v/@perhapxin/dddk.svg?style=flat-square" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/@perhapxin/dddk"><img src="https://img.shields.io/npm/dm/@perhapxin/dddk.svg?style=flat-square" alt="downloads" /></a>
  <a href="https://github.com/PerhapxinLab/dotdotduck/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue?style=flat-square" alt="license" /></a>
  <a href="https://dddk.perhapxin.com/docs/v0.1.0/dddk/overview"><img src="https://img.shields.io/badge/docs-online-blue?style=flat-square" alt="docs" /></a>
  <a href="https://github.com/PerhapxinLab/dotdotduck/stargazers"><img src="https://img.shields.io/github/stars/PerhapxinLab/dotdotduck?style=flat-square" alt="stars" /></a>
</p>

## Status — early stage, read before evaluating

dotdotduck is in active development. It works, but expect rough edges. A few things up front:

- **Clone the repo to evaluate properly.** The bundled docs are useful as a map, but the source is the source of truth. `git clone https://github.com/PerhapxinLab/dotdotduck` into your project directory and read the code alongside the [online docs](https://dddk.perhapxin.com/docs) — that's the recommended way to understand what's actually implemented.
- **The docs are AI-drafted.** They're written and maintained with Claude Code. They stay close to the code by convention, but if something looks wrong, grep the repo before assuming the docs are right.
- **Found a bug or unclear behaviour?** Open an issue at [github.com/PerhapxinLab/dotdotduck/issues](https://github.com/PerhapxinLab/dotdotduck/issues) — one-liners help shape the roadmap.

## What it does

`@perhapxin/dddk` (pronounced *dot-dot-duck*) is the SDK behind every "press Cmd+K to do anything" experience you wish your product had. One import wires together a command palette, voice input, on-page selection, inline AI for any text field, and a DOM-grounded agent that can actually carry out tasks — all themed with plain CSS variables, all locale-neutral by default.

The opposite of a chatbot. There is no bubble in the corner waiting to be opened. The user keeps doing what they were doing and AI shows up exactly where they already are: as a row in the palette they just opened, as a popover next to the textarea they're typing in, as a frame under the paragraph they just long-pressed. Each surface is grounded in the page and the user's intent, not in an out-of-context chat thread.

You declare what your product can do as **skills** — small declarative units that come in five shapes (Scripts, Prompts, Actions, Surfaces, Panels). dddk handles palette discovery, voice routing, accessibility, theming, persistence, and analytics. You write the verbs your product already speaks.

## How it shows up in your product

The same skill registry surfaces in six places so users find AI exactly where they already are:

<table>
<tr>
<td width="33%" align="center">
  <img src="https://dddk.perhapxin.com/readme/dddk-palette.png" alt="Cmd+K palette open, with host commands, skills, and the AI ask box mixed in one list" />
  <br /><strong>Command palette</strong>
  <br /><em>Ctrl/⌘+K. Host commands sit next to skills, agent tools, and the AI ask box. Prefix routing (<code>/</code>, <code>?</code>, <code>&gt;</code>), grouped sections, multi-step Panel skills, attachments.</em>
</td>
<td width="33%" align="center">
  <img src="https://dddk.perhapxin.com/readme/dddk-dwell.png" alt="long-press a DOM element → multi-choice picker: Explain / Summarize / Translate / Other" />
  <br /><strong>Dwell long-press</strong>
  <br /><em>Hold any element ~500ms → a frame pins on it + a multi-choice picker pops up. Esc keeps the frame for the next palette / voice action.</em>
</td>
<td width="33%" align="center">
  <img src="https://dddk.perhapxin.com/readme/dddk-webagent.png" alt="agent narrating its next step in the subtitle bar with a yes/no confirmation gate" />
  <br /><strong>WebAgent</strong>
  <br /><em>DOM-grounded autonomous agent. Reads the page, picks a tool, narrates each step in the subtitle bar with a single-tap confirmation gate. The user sees what's about to happen — and stays in control.</em>
</td>
</tr>
<tr>
<td width="33%" align="center">
  <img src="https://dddk.perhapxin.com/readme/dddk-inline.png" alt="inline AI popover floating next to a textarea selection with Translate / Improve / Fix actions" />
  <br /><strong>Inline Agent</strong>
  <br /><em>Floating popover next to any <code>&lt;textarea&gt;</code> / <code>contenteditable</code> selection. Translate, Improve, Fix grammar, Tone, Explain — without leaving the field.</em>
</td>
<td width="33%" align="center">
  <img src="https://dddk.perhapxin.com/readme/dddk-voice.png" alt="long-press space, subtitle bar shows live 'listening' indicator" />
  <br /><strong>Voice in</strong>
  <br /><em>Long-press Space anywhere. The subtitle bar shows the live listening indicator. Transcript lands in the palette as text or as an agent task — depending on what's open.</em>
</td>
<td width="33%" align="center">
  <img src="https://dddk.perhapxin.com/readme/dddk-dashboard.png" alt="behaviour analytics dashboard showing intent stream + skill adoption rates" />
  <br /><strong>Dashboard</strong>
  <br /><em>Every intent (palette open, skill activate, agent answered, voice attempt) flows into a unified stream. See which skills land and which don't, in real time.</em>
</td>
</tr>
</table>

## Features

- **Command palette** — Ctrl/⌘+K. Prefix routing, grouped sections, fuzzy + BM25 hybrid match, attachments (text / image), multi-step Panel skills.
- **WebAgent** — DOM-grounded autonomous loop. Reads the visible page, picks a tool, narrates with a yes/no gate before each step. Disable cleanly with `agent: { enabled: false }` if you only want the palette.
- **Inline Agent** — popover-based text editing in any input or contenteditable. Hosts add their own actions; built-ins are translate / improve / fix / shorter / longer / tone / explain.
- **Voice in** — hold-Space STT through the Web Speech API. Routes the transcript to the palette OR to the agent task, depending on what's open. Optional LLM cleanup pass to remove fillers.
- **Dwell** — long-press anything to pin it. The pinned element becomes context for the next palette query / voice utterance / agent task.
- **Skills** — five skill types (Script / Prompt / Action / Surface / Panel) share one registry and one discovery surface (the palette).
- **Proactive prompts** — `@perhapxin/dddk/modules/proactive` watches signals (idle, dwell, scroll, exit-intent) and surfaces a suggestion in the subtitle bar at the right moment.
- **Analytics** — `@perhapxin/dddk/modules/analytics` emits structured intent events so you can see which skills land.
- **Toolbox** — `@perhapxin/dddk/toolbox/search` (per-field BM25 + learn-to-rank from clicks + sync-from-DB connector) and `@perhapxin/dddk/toolbox/recommend` (preference-aware, catalog-agnostic).
- **No language borders** — a Unicode-aware universal tokeniser handles 200+ languages (CJK, Thai / Lao / Khmer / Burmese, whitespace scripts) out of the box. Hosts plug in a domain-specific tokeniser only if they need one.
- **CSS variable theming** — every visual surface reads from `--dddk-*` vars. Light + dark modes ship out of the box; custom modes (sepia, high-contrast, brand) work with a one-selector override.

## Documentation

- **Full docs** → [dddk.perhapxin.com/docs](https://dddk.perhapxin.com/docs/v0.1.0/dddk/overview)
- **Agent (DOM-grounded loop + InlineAgent + sitemap + Memory)** → [/dddk/agent](https://dddk.perhapxin.com/docs/v0.1.0/dddk/agent/overview)
- **LLM providers + router + adapter registry** → [/dddk/llm](https://dddk.perhapxin.com/docs/v0.1.0/dddk/llm/providers)
- **Skills system + evals** → [/dddk/skills](https://dddk.perhapxin.com/docs/v0.1.0/dddk/skills/overview)
- **Modules (voice / Dwell / inline / immersive translate / proactive / analytics)** → [/dddk/modules](https://dddk.perhapxin.com/docs/v0.1.0/dddk/modules/overview)
- **Toolbox (search + recommend)** → [/dddk/toolbox](https://dddk.perhapxin.com/docs/v0.1.0/dddk/toolbox/overview)
- **Theming** → [/dddk/theming](https://dddk.perhapxin.com/docs/v0.1.0/dddk/theming)

## Quick start

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

Dark mode is automatic: `[data-theme="dark"]` anywhere up the tree, OR `@media (prefers-color-scheme: dark)` — whichever fires first. Custom modes (sepia, high-contrast, brand-specific) work by overriding the same variables under a new selector. Full token list → [src/styles/tokens.css](./src/styles/tokens.css).

## Tree-shake-friendly subpaths

| Subpath | What it covers |
|---|---|
| `@perhapxin/dddk` | Root re-exports — `DotDotDuck` orchestrator + everything below |
| `@perhapxin/dddk/agent` | WebAgent + InlineAgent + AgentCursor + sitemap + Memory + LLM types |
| `@perhapxin/dddk/llm` | Providers (OpenAI / Google / Proxy), router, adapter registry |
| `@perhapxin/dddk/ui` | Subtitle bar + Pieces system + placement helpers |
| `@perhapxin/dddk/skills` | Skill types + registry + eval helpers |
| `@perhapxin/dddk/toolbox/search` | Per-field BM25 + learn-to-rank + DB sync |
| `@perhapxin/dddk/toolbox/recommend` | Preference-aware, catalog-agnostic recommender |
| `@perhapxin/dddk/modules/analytics` | Structured intent-event tracker |
| `@perhapxin/dddk/modules/proactive` | Signal-watcher → subtitle prompt |
| `@perhapxin/dddk/styles.css` | Bundled tokens + chrome |
| `@perhapxin/dddk/styles/tokens.css` | Just the CSS custom properties (host owns the chrome) |

## License

**AGPL-3.0-or-later** for open-source use — internal tools, personal projects, anything AGPL-compatible. **Commercial licenses** are available for closed-source / SaaS deployments that need to stay free of AGPL's network-copyleft obligations — see [LICENSE](./LICENSE) or reach the maintainer through the repo.

---

<p align="center">Built by <a href="https://github.com/PerhapxinLab">Perhapxin Lab</a></p>
