# webagent — Overview

## What it is

**webagent is a DOM-grounded agent toolkit.**

It lets an AI agent work directly on the page the user is currently looking at — read DOM, click buttons, fill forms, navigate, highlight / border elements, persist state across pages, and pause to ask the user when needed.

Each turn the agent sees:
- an **indexed tabbed-tree dump** of every actionable element (each gets a numeric `[N]` index; the LLM passes that index back instead of guessing CSS selectors),
- **viewport markers** (`↑` / `↓`) telling it what the user can actually see vs. what's above / below the fold,
- and **optionally a screenshot** (viewport or full-page with auto-split) — disabled by default; opt in for pages whose visual layout the DOM dump can't convey.

Not a replacement for LangChain — a complement. LangChain runs on the backend where there is no concept of "page". webagent runs on the frontend where DOM, accessibility tree, and routes are first-class.

## 30-second try

```bash
npm install @perhapxin/dddk
```

```ts
import { WebAgent, OpenAIProvider } from '@perhapxin/dddk';

const agent = new WebAgent({
  llm: new OpenAIProvider({ apiKey: import.meta.env.VITE_OPENAI_KEY }),
  locale: 'en',
});

agent.on('subtitle', (text) => console.log('agent:', text));
agent.on('done', () => console.log('finished'));

await agent.run('Change the headline to "Annual Report 2026" and save.');
```

That's the whole integration. The agent reads the page, picks tools, narrates progress, and stops when the task is done — or pauses and asks a follow-up if it needs you.

## How it compares to other agent frameworks

| Dimension | Backend orchestrators | Vendor-bundled agent SDKs | Headless-browser test agents | **webagent** |
|---|---|---|---|---|
| Runs where | server | server | server-driven browser | **the browser itself (user's open tab)** |
| Input | text + tool results | text + tool results | DOM via accessibility tree | DOM + user-visible visual overlays |
| Cross-page state | host-managed | host-managed | session-based | **built-in sessionStorage + cross-tab sync** |
| User-facing UI | none (bring your own) | none | developer trace UI | **subtitle / overlay / ask_user / Surface, native** |
| Deployment | server + frontend | server + frontend | server + headless browser | **frontend-only SDK, zero server** |

## The three core use cases

### A. In-app assistant (the main one)
A user inside a SaaS presses dddk's Space and says "please rewrite this report headline to sound more professional." webagent reads the current DOM, finds the headline element, rewrites it, and tells the user what changed via the subtitle bar.

### B. Automated tour / onboarding
A first-time user lands on the site; webagent runs the `/introduce` skill — auto-walks them through the product, highlights key areas, narrates in the subtitle bar, and waits for the user to acknowledge each step before continuing.

### C. Intent-driven task execution
The user says "book me next Wednesday's meeting room." webagent navigates to the booking page, fills the date, picks a room. If it lacks information it calls `ask_user`; if it needs structured input the host opens a Pieces-based Surface via dddk (the agent itself never renders UI). When the form is submitted the agent receives the data and continues.

## What it does NOT do

webagent intentionally does **not**:
- Cross-site crawling (it is not a browser automation tool)
- Backend agent orchestration (that's LangGraph)
- Model training or fine-tuning
- Visual workflow editing (that's runboard)
- Command palette / trigger system (that's dddk)

webagent does one thing: **operate the DOM of the current page, driven by user intent through an LLM.**

## Package layout

```
@perhapxin/dddk/src
├── orchestrator.ts   Top-level DotDotDuck class — wires modules + triggers
├── agent/
│   ├── webagent/     Main page-driving agent loop (DOM tools, ask_user, navigate)
│   ├── inline/       InlineAgent — selection edits inside editables
│   ├── llm/          OpenAI + Google providers, LLMRouter, adapter registry
│   ├── sitemap/      Sitemap tree + navigation policy
│   └── memory/       Cross-tab session persistence
├── modules/          Voice, TTS, Subtitle, Dwell, ImmersiveTranslate, Palette, …
├── triggers/         Space gesture, hotkeys, selection-change observers
├── ui/               Subtitle bar, indicator, Surface renderer host
├── skills/           Built-in skills (introduce, …) + registration API
├── toolbox/          Reusable host helpers (selection, screenshot, dom serialize)
└── utils/            Shared low-level helpers
```

No framework dependencies. Pure DOM API + event emitter — works with React, Vue, Svelte, or vanilla HTML.

## Further reading

- [api.md](./api.md) — public API surface
- [plan.md](./plan.md) — pre-loop task planning + structured-artifact module
- [llm/providers.md](../llm/providers.md) — provider interface
- [actions/catalog.md](./actions/catalog.md) — full DOM action list
- [screenshot.md](./screenshot.md) — visual snapshots alongside the DOM dump
- [modules/overview.md](./modules/overview.md) — immersive-translate, tts, select-agent
- [security.md](./security.md) — security model, API keys, auth scope
- [sitemap/tree.md](./sitemap/tree.md) — sitemap declaration, navigation rules
- [prompt-design.md](./prompt-design.md) — layered system prompt (brand, appendSystemPrompt)
- [session-continuity.md](./session-continuity.md) — cross-tab sync, session persistence
