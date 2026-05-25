<p align="center">
  <img src="https://dddk.perhapxin.com/icon.png" alt="dddk" width="96" />
</p>

<h1 align="center">@perhapxin/dddk</h1>

<p align="center">
  Command palette + AI agent SDK that ships with your product, not a chatbot widget.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@perhapxin/dddk"><img src="https://img.shields.io/npm/v/@perhapxin/dddk.svg?style=flat-square" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/@perhapxin/dddk"><img src="https://img.shields.io/npm/dm/@perhapxin/dddk.svg?style=flat-square" alt="downloads" /></a>
  <a href="https://github.com/PerhapxinLab/dddk/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@perhapxin/dddk.svg?style=flat-square" alt="license" /></a>
  <a href="https://dddk.perhapxin.com/docs"><img src="https://img.shields.io/badge/docs-online-blue?style=flat-square" alt="docs" /></a>
  <a href="https://github.com/PerhapxinLab/dddk/stargazers"><img src="https://img.shields.io/github/stars/PerhapxinLab/dddk?style=flat-square" alt="stars" /></a>
</p>

<!-- Hero: Cmd+K palette with mixed entries (host commands + AI + tools) -->
<p align="center">
  <img src="https://dddk.perhapxin.com/readme/dddk-palette.png" alt="Cmd+K palette open, showing host commands, /introduce skill, and AI tools in one list" width="780" />
  <br />
  <em>One palette, mixed sources — your product's commands sit next to skills, tools, and the AI ask box.</em>
</p>

<!-- Full product walkthrough (~2 min) — shared with @perhapxin/webagent's README. -->
<p align="center">
  <a href="https://dddk.perhapxin.com/try">
    <img src="https://dddk.perhapxin.com/readme/walkthrough.gif" alt="2-minute walkthrough of the full dddk demo" width="780" />
  </a>
  <br />
  <em>▶ 2-minute walkthrough — <a href="https://dddk.perhapxin.com/try">try the live demo</a></em>
</p>

## What it does

**dddk** (pronounced _dot-dot-duck_) is the SDK behind every "press Cmd+K to do anything" experience you wish your product had. One import wires together a command palette, voice input, on-page selection, an inline AI popover for any text field, and a webagent-driven Surface that can actually carry out tasks — all themed with plain CSS variables.

The pitch is the opposite of a chatbot. There is no bubble in the corner waiting to be opened. Instead, the user keeps doing what they were doing, and dddk shows up exactly where they are: as a row in the palette they just opened, as a popover next to the textarea they're typing in, as a Dwell menu under the paragraph they just long-pressed. Each surface is grounded in the page and the user's intent, not in an out-of-context chat history.

You define what your product can do as a list of **skills** — small declarative units that can be Scripts (guided tours), Prompts (LLM templates), Actions (plain functions), Surfaces (structured UI), or Panels (multi-step flows). dddk handles discovery, routing, voice, accessibility, theming, persistence, and analytics. You write the verbs your product already speaks.

Built on top of [`@perhapxin/webagent`](https://www.npmjs.com/package/@perhapxin/webagent) for the agent half.

## Quick start

```bash
pnpm add @perhapxin/dddk @perhapxin/webagent
# or: npm i / yarn add
```

```ts
import { DotDotDuck } from '@perhapxin/dddk';
import { WebAgent, OpenAIProvider } from '@perhapxin/webagent';
import '@perhapxin/dddk/styles.css';

const llm = new OpenAIProvider({
  apiKey: import.meta.env.VITE_OPENAI_KEY,
  model: 'gpt-5.4-mini',
});

const dddk = new DotDotDuck({
  llm,
  webAgent: () => new WebAgent({ llm }),
  locale: 'en',
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

Press `Ctrl/⌘+K` to open the palette, type `/introduce`, and watch it run.

> Full guide → [docs/v0.1.0/dddk/00-overview](https://dddk.perhapxin.com/docs/v0.1.0/dddk/00-overview)

## Live demo

[**Try it on dddk.perhapxin.com →**](https://dddk.perhapxin.com/try)

The same skill registry surfaces in four different places so users find AI exactly where they already are — not in a corner chatbox:

<table>
<tr>
<td width="50%" align="center">
  <img src="https://dddk.perhapxin.com/readme/dddk-dwell.png" alt="long-press a DOM element → multi-choice picker: Explain / Summarize / Translate / Other" />
  <br />
  <strong>Dwell long-press</strong><br />
  <em>Hold any element 500ms → a frame pins on it + a 4-option picker pops up. Esc keeps the frame for palette / voice.</em>
</td>
<td width="50%" align="center">
  <img src="https://dddk.perhapxin.com/readme/dddk-voice.png" alt="long-press space, subtitle bar shows 'listening...' indicator" />
  <br />
  <strong>Voice in</strong><br />
  <em>Long-press Space anywhere — the subtitle bar shows the live listening indicator. Transcript lands in the palette or as an agent task.</em>
</td>
</tr>
<tr>
<td width="50%" align="center">
  <img src="https://dddk.perhapxin.com/readme/dddk-subtitle.png" alt="subtitle bar at the bottom narrating the agent's next step with a yes/no gate" />
  <br />
  <strong>Subtitle bar</strong><br />
  <em>One bar at the bottom drives every prompt, proactive offer, voice transcript, and agent narration. Single source of attention.</em>
</td>
<td width="50%" align="center">
  <img src="https://dddk.perhapxin.com/readme/dddk-dashboard.png" alt="behaviour analytics dashboard showing intent stream + skill adoption" />
  <br />
  <strong>Dashboard</strong><br />
  <em>Every intent (palette open, skill activate, agent answered, voice attempt) flows into a unified analytics stream — see what lands.</em>
</td>
</tr>
</table>

## Features

- **[Command palette](https://dddk.perhapxin.com/docs/v0.1.0/dddk/00-overview)** — Ctrl/⌘+K opens it. Prefix routing (`/`, `?`, `>`), grouped sections, action handlers, panel skills for multi-step flows.
- **[Voice in](https://dddk.perhapxin.com/docs/v0.1.0/dddk/00-overview)** — Web Speech API → text → routed to palette or agent task. No backend required for the speech layer.
- **[Dwell](https://dddk.perhapxin.com/docs/v0.1.0/dddk/00-overview)** — long-press anything on the page to pop a frame with **Explain / Summarize / Translate / Other** plus your custom choices.
- **[InlineAgent](https://dddk.perhapxin.com/docs/v0.1.0/dddk/00-overview)** — floating AI popover next to any `<textarea>` or `contenteditable` selection. Rewrite, expand, fix, translate — without leaving the field.
- **[Surface renderer](https://dddk.perhapxin.com/docs/v0.1.0/dddk/00-overview)** — declarative UI primitives (Pieces) plus a custom catalog, rendered into center / inline / dock slots.
- **[Skills system](https://dddk.perhapxin.com/docs/v0.1.0/dddk/00-overview)** — five skill types (Script, Prompt, Action, Surface, Panel) share one registry and one discovery surface.
- **[Proactive prompts](https://dddk.perhapxin.com/docs/v0.1.0/dddk/00-overview)** — `@perhapxin/dddk/toolbox/proactive` watches signals and surfaces a suggestion in the subtitle bar at the right moment.
- **[Analytics](https://dddk.perhapxin.com/docs/v0.1.0/dddk/00-overview)** — `@perhapxin/dddk/toolbox/analytics` emits structured events so you can see which skills land and which don't.
- **[Toolbox modules](https://dddk.perhapxin.com/docs/v0.1.0/dddk/00-overview)** — 11 in-browser primitives: BM25 search, QA, classify, recommend, cache, heat-rank, memory, lang, storage, analytics, proactive.

## What's in the box

| Subpath | Purpose | Size |
|---|---|---|
| `@perhapxin/dddk` | Root re-exports — `DotDotDuck` orchestrator + everything | ~302 KB |
| `@perhapxin/dddk/ui` | Subtitle bar only | ~22 KB |
| `@perhapxin/dddk/skills` | Skill types + registry, no runtime | ~2.5 KB |
| `@perhapxin/dddk/toolbox` | All toolbox modules barrel | ~30 KB |
| `@perhapxin/dddk/toolbox/search` | BM25 in-browser search | ~6 KB |
| `@perhapxin/dddk/toolbox/qa` | RAG-lite question answering over chunks | ~4 KB |
| `@perhapxin/dddk/toolbox/classify` | Few-shot classifier | ~3 KB |
| `@perhapxin/dddk/toolbox/recommend` | Heat-rank recommender | ~3 KB |
| `@perhapxin/dddk/toolbox/memory` | Per-user / per-tab memory store | ~2.5 KB |
| `@perhapxin/dddk/toolbox/lang` | Locale detection + simple i18n helpers | ~2 KB |
| `@perhapxin/dddk/toolbox/storage` | Thin localStorage / IDB wrapper | ~2 KB |
| `@perhapxin/dddk/toolbox/cache` | LRU + TTL cache | ~1.5 KB |
| `@perhapxin/dddk/toolbox/analytics` | Event tracker | ~2 KB |
| `@perhapxin/dddk/toolbox/proactive` | Signal-watcher → subtitle prompt | ~3 KB |
| `@perhapxin/dddk/styles.css` | Bundled tokens + chrome | ~12 KB |
| `@perhapxin/dddk/styles/tokens.css` | Just the CSS custom properties | ~3 KB |

> For tree-shaking, import from the subpath you actually need. Each toolbox module is independently importable so you only pay for what you use.

## Theming

Everything chrome-related is driven by CSS custom properties — palette, subtitle bar, Dwell frame, inline popover, Surface. Override `--ddd-bg`, `--ddd-accent`, `--ddd-radius`, `--ddd-font`, and friends at `:root` or scope them inside a wrapper. Ship `@perhapxin/dddk/styles/tokens.css` only if you want to keep your own chrome. See the [theming guide](https://dddk.perhapxin.com/docs/v0.1.0/dddk/00-overview).

## Related packages

- **[@perhapxin/webagent](https://www.npmjs.com/package/@perhapxin/webagent)** — the DOM-grounded agent runtime that powers dddk's Surface tasks. Use it standalone if you only need the agent loop without the palette / voice / Dwell layer.

## Contributing

Issues and PRs welcome.

- File an issue: [github.com/PerhapxinLab/dddk/issues](https://github.com/PerhapxinLab/dddk/issues)
- Local dev:
  ```bash
  git clone https://github.com/PerhapxinLab/dddk
  pnpm install
  pnpm --filter @perhapxin/dddk dev
  ```
- Got a skill idea? Open a discussion before writing it up — half of dddk's API surface came from "wait, why isn't there a skill type for that?" conversations.

## License

Dual-licensed. **AGPL-3.0-or-later** for open-source use — great for personal projects, internal tools, and any AGPL-compatible project. **Commercial licenses** are available for closed-source / SaaS deployments that need to stay free of the AGPL's network-copyleft obligations. See [LICENSE.md](https://github.com/PerhapxinLab/dddk/blob/main/LICENSE) or get in touch.

---

<p align="center">Made with coffee in Taiwan by <a href="https://perhapxin.com">Perhapxin Lab</a></p>
