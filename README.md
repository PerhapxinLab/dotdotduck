<h1 align="center">
  <img src="./media/logo.png" alt="" width="56" align="absmiddle" />
  &nbsp;dotdotduck
</h1>

<p align="center"><strong>Turn your existing site into an AI-native site.</strong></p>

<p align="center">
  An embedded AI SDK that lives inside your page and operates the DOM — not a chatbot bolted to the corner.
</p>

https://github.com/user-attachments/assets/18d797df-4952-421a-a2b3-16aef1ebcb34

<p align="center">
  <a href="https://www.npmjs.com/package/@perhapxin/dddk"><img src="https://img.shields.io/npm/v/@perhapxin/dddk.svg?style=flat-square" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/@perhapxin/dddk"><img src="https://img.shields.io/npm/dm/@perhapxin/dddk.svg?style=flat-square" alt="downloads" /></a>
  <a href="https://github.com/PerhapxinLab/dotdotduck/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue?style=flat-square" alt="license" /></a>
  <a href="https://dddk.perhapxin.com/docs/v0.1.3/dddk/overview"><img src="https://img.shields.io/badge/docs-online-blue?style=flat-square" alt="docs" /></a>
</p>

<p align="center"><a href="./README.zh-TW.md">繁體中文 →</a></p>

---

## 01 · Command palette — every feature, behind one panel

<table>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-palette.png" alt="Cmd+K palette open: /introduce, /theme, /language, /immersive_translate, #find-on-page, docs: search, Go to entries — all in one list" />
</td>
<td width="45%" valign="top">

- **Ctrl/⌘+K opens it.** Your registered commands sit alongside Ask AI in the same list — switch theme, change language, open billing, find a customer, all addressable from one place.
- **Inline mount or modal — same items.** `dddk.palette.mountInline(host)` persistently embeds the palette inside your sidebar / drawer / dialog (no backdrop, no outside-click dismiss). Ctrl/⌘+K still works while inline — it raises the full modal on top, then restores the inline surface on close. Hosts write ONE set of items.
- **Rich rows.** Items support `lines: string[]` (multi-line metadata column) and `image` (thumbnail URL) — book covers + title + blurb + author lines, product shots, customer avatars. No custom renderer needed.
- **Optional submit button.** `submitButton: true` puts a circular send button at the right edge of the input — clicking it (or Enter) submits the typed query to whichever fallback item the host registered.
- **Prefix routing** — `/command`, `@entity`, `order:`, `#tag` — gives the user one convenient entry point that solves whatever they're stuck on, no matter where they are in the product.
- **Layered customisation** — CSS-variable theming, Skill SDK (Script / Prompt for most hosts; Action / Surface / Panel for advanced cases), or wire your existing host features straight in as palette items.
- **Zero built-in commands** — what shows up in the palette is entirely yours to decide. The SDK ships infrastructure, you ship the vocabulary.

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

- **DOM-grounded autonomous loop.** Reads the visible page, picks one tool at a time, narrates each step in the subtitle bar before it runs.
- **Opt-in action bundles.** Default install is `coreActions` (4: navigate · click · border · scroll_to) — the actions every host needs. Pass `formActions` (fill_input · select_option · clear_input · press_key), `flowActions` (wait · pause · ask_user · ask_user_choice), or `extraActions` (highlight · track_intent · escalate_to_human) into `customActions` to opt in. Smaller default = cheaper prompts, honest catalog. Add your own; the LLM picks them.
- **Cursor on every action.** Opt in with `cursorTrail: true` and a synthetic cursor glides onto each target *before* it fires — click / fill_input / border / highlight / scroll_to (cursor swaps to a mouse-wheel glyph and travels along the scroll path) / narrate-with-about (free via the synthesized `border` call). Pre-action pause + arrival pulse + reduced-motion fallback included.
- **Space-gated every step.** Single tap accept · double-tap reject · Esc cancel. Users see what's about to happen *before* it happens.
- **Asks back when ambiguous.** `ask_user_choice` for 2-4 options, `ask_user` for free text. No silent decisions, no guessing.
- **Bring your own keys.** LLM via OpenAI, Google AI Studio, or a server-side `ProxyProvider`; per-role routing keeps cheap models on cleanup and the flagship on the agent loop. STT defaults to the browser's Web Speech for zero-setup; swap to Whisper or any vendor via one `transcribe(audio)` callback.

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

- **Highlight any text** in any `<input>` / `<textarea>` / `[contenteditable]` — a floating toolbar appears below the selection. Pick an action, the result streams back in place of the selection.
- **Default action set out of the box** — Translate, Improve writing, Fix spelling & grammar, Make shorter, Make longer, Change to professional tone, Explain this. Drop the defaults, add your own (`/translate-with-glossary`, `/rewrite-as-email`).
- **Two-column layout** option for editor hosts that want a `Format` column next to an `AI` column. Optional keyboard shortcuts (e.g. `Ctrl+Shift+R` to rewrite without opening the menu).

</td>
</tr>
</table>

---

## 04 · Direct manipulation — gestures you already know

Several physical entry points to send context into dddk. No new vocabulary to learn.

<table>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-voice.png" alt="long-press space, subtitle bar shows live 'Listening — release to send' indicator" />
</td>
<td width="45%" valign="top">

**A · Hold Space — voice in**

- Focus inside an input → fills the input. Anywhere else → goes to the agent.
- Optional LLM cleanup pass — fillers + punctuation in one shot.
- **STT swappable** — defaults to the browser's Web Speech (no SLA, Firefox unsupported). One `VoiceConfig.transcribe` callback swaps in Whisper or any vendor.

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
<td width="35%" valign="top" align="center">
  <img src="./media/readme/dddk-mobile.png" alt="mobile portrait view: dotdotduck FAB at bottom-right corner, 'Listening — release to send' indicator shown above the FAB while voice is active" width="260" />
</td>
<td width="65%" valign="top">

- **Floating action button.** Ships out of the box on mobile breakpoints — tap to open the palette, long-press to hold-talk into the agent.
- **Touch gestures.** The same Space-hold / long-press / multi-choice patterns work via touch — tap → palette, long-press → voice, digit keys → option pick.
- **Your own button.** Replace the duck FAB with any host element. Pass a selector or `HTMLElement` and dddk wires the open / hold-talk handlers onto it — the FAB lives wherever your design wants it (header bar, side rail, brand asset, etc.).
- **Responsive chrome.** Subtitle bar auto-offsets above the on-screen keyboard; palette becomes full-width below 640px; tap targets respect the 44×44 touch-spec.

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

- **The agent subscribes to page signals** — scroll depth, Dwell time, time-on-page, last interaction — and surfaces an offer in the subtitle bar when conditions match.
- **Yes / no resolves with Space.** Single tap accepts, double-tap rejects. No popup chrome, no layout shift — the whole exchange stays in the subtitle bar.
- **Multi-choice with 1-9 number keys** plus a trailing **Other** slot that always accepts free text. The user gets out without typing if your options covered it; if not, they can still answer.
- **Every response emits a typed intent** (`proactive_accepted` / `agent_choice` with the picked value) so you measure what lands. Not big-data fishing — direct asking and recorded answers.
- **Customer-service plays out of the box** — order just shipped → "Want me to pull the tracking?"; user lingers on the returns page → list three common actions.

</td>
</tr>
</table>

---

## 07 · Intent stream — every yes / no is a signal, the dashboard writes itself

<table>
<tr>
<td width="55%" valign="top">
  <img src="./media/readme/dddk-dashboard.png" alt="dotdotduck dashboard: 3 sessions, 2 visitors, 577 events, 118 palette opens, geography panel, top palette items table" />
  <br /><br />
  <img src="./media/readme/dddk-dashboard-2.png" alt="dotdotduck dashboard — LLM streaming perf tile (avg TTFT, tok/s, duration) + by-model breakdown table + agent runs summary" />
</td>
<td width="45%" valign="top">

- **Every interaction emits a typed event.** Palette opens, voice transcripts, agent answers, accept / reject gestures, Dwell selections, multi-choice picks, even per-LLM-call streaming perf — all flow through one structured stream.
- **Event types** include `palette_activated` · `voice_captured` · `agent_asked` / `agent_answered` (with `latencyMs`) · `agent_run_started` / `completed` / `stopped` · `agent_pause_decision` · `agent_llm_call` (TTFT, tokens/sec, model) · `confirm_action` · `selection_used` · `skill_started` / `finished` · `agent_feedback`. Add your own and they ride the same channel.
- **Clean behavioural data, no big-data fishing.** You learn what users want from what they actually asked + answered, not from inferring through clickstreams.
- **Bundled dashboard route** turns the stream into charts out of the box — yes-rate over time, TTFT / tok-per-sec by model, agent-run completion rate, top palette items, geography — or subscribe in code and pipe to Mixpanel / Amplitude / your own BI.

</td>
</tr>
</table>

---

## Why adopt — eight concrete plays

1. **Most customer-service tickets are page-solvable.** "How do I X" / "where do I Y" / "track my order" / "change my plan" — the answers all live on your site already; the gap is discoverability. A DOM-grounded agent that *operates the page* closes that gap. Deflect the easy 70% before they reach a human queue.

2. **Proactive offers convert.** Watching scroll · Dwell · time-on-page · last interaction lets the agent ask *"want me to pull the tracking?"* / *"want a recommendation based on what you're looking at?"* before the user thinks to ask. Subtitle-bar yes/no resolves in one keystroke — friction is the lowest physically possible. Same surface for cross-sell and upsell plays.

3. **The palette is a UI surface, not just a text list.** Each row's detail pane (and PanelSkills inside the palette) can render any **Pieces** tree — charts, tables, forms, mini-dashboards. That makes the palette a real productivity surface, not just a launcher:
   - **Finance** — `AAPL` in the palette pulls a live price card + sparkline alongside the row.
   - **Customer service** — type a question; the palette shows the matching FAQ entry with formatted answer inline, not a link to click.
   - **Tool-type SaaS** — pack utilities (regex tester, JSON formatter, unit converter, internal lookup) straight into the palette so users never tab out. Same `Ctrl+K`, different verbs per product.

4. **Long-press beats "screenshot + describe".** With Dwell, the user holds an element, the agent gets selector + auto-screenshot in one gesture — chart, dashboard panel, table row, whatever. Users stop interrupting themselves to take a screenshot, paste it into chat, and write a paragraph explaining what they meant. Intent flows straight from finger to LLM.

5. **Break the language wall with one palette command.** Built-in immersive translate renders every paragraph of the current page bilingually side by side — one keystroke turns your English-only docs / knowledge base / product copy into a Chinese / Japanese / Korean / Spanish-readable surface. Batched into a handful of LLM calls per page (a 200-paragraph article costs ~7 calls). For cross-border SaaS, content platforms, or any product serving multiple regions, that's one fewer translation-engineering project on the roadmap.

6. **One SDK instead of stitching six vendors.** Palette + agent + inline AI + voice + Dwell + proactive + analytics + immersive translate ship as one install. The conventional alternative is Algolia for search, Intercom for chat, Mixpanel for analytics, Whisper for voice, plus the brittle glue code between them. dddk is one dependency, one theme system, one intent stream.

7. **Yes / no / multi-choice = free RL labels.** Every Space-accept and double-Space-reject is a clean, intentional signal — what the user actually wanted vs didn't, said by the user, recorded with the original prompt. No more inferring from clickstream noise. The training set for whatever you fine-tune or evaluate next is already collected.

8. **Voice doesn't stop at the browser.** The same `Voice` + `utility` LLM shape powers IoT panels, kiosk terminals, service machines, and accessibility-first surfaces for elderly users or anyone who'd rather not type. One mental model across every device that has a microphone.

## Roadmap — v0.2.0 in progress

The 0.2.x line is the architectural rework of the webagent core. Most of it is on `main` already (the live demo runs it); a few pieces are still landing.

**Track 1 · nano cost validation — done.** `gpt-5.4-nano` runs the full monolithic webagent loop with the same task-success rate as `gpt-5.4-mini` at roughly an order of magnitude lower cost. That's the new default for `webagent` + `plan` roles on [dddk.perhapxin.com](https://dddk.perhapxin.com).

**Track 2 · mode-based architecture — mid-implementation.**

- ✅ **Streaming envelope parser** — scanner-based incremental JSON parser. Each action dispatches the moment its tool-args `{ }` balances, instead of waiting for the outer envelope to close. Narrate text streams character-by-character into the subtitle bar as the model writes it. The first click can fire before the second action's opening `{` has even arrived from the LLM. Opt in via `enableStreamingEnvelope: true` on `DotDotDuck` config.
- ✅ **TaskAgent** — third agent kind alongside WebAgent + InlineAgent. Conversation + host-defined tool calling, no DOM, plain protocol (standard chat + OpenAI tool-calls). Same `AgentSession` shape so multiple TaskAgents (or — in v0.3 — a TaskAgent + WebAgent) share conversation history when wired to the same session. Replaces the original "mode-based webagent" plan — separate agent class beats stuffing two protocols into one.
- ✅ **WebAgent multi-instance + shared sessions** — `dddk.sessions` named-session registry + `dddk.agents` named-instance registry. Inject the same `AgentSession` into different WebAgents (one persona per route) and `dddk.agents.setActive(name)` on route change — cross-page conversation history + memory carry over even when the active agent flips.
- ✅ **Live registry** — `webagent.registerTool(def) → ToolHandle` and `webagent.registerContextProvider(role, fn) → ContextProviderHandle`. Handle's `remove()` unregisters; context-provider remove restores the SDK default rather than emptying the slot. In-flight step finishes on its action-map snapshot; next step sees the new entry.
- ✅ **Context providers split** — six slots (`url`, `page_summary`, `dom`, `screenshot`, `history`, `selection`) with default providers SDK-installed in the WebAgent constructor. Hosts replace any single slot via the live registry without re-implementing the others.
- ✅ **InlineAgent scoping** — `inlineAgent.attachScope(selector, config)` for per-region action sets. A textarea inside the docs comments shouldn't see the same actions as a code block in the editor; innermost-wins on the selection's anchor element, callback fallback via `setScopeResolver` for the cases selectors can't express. Each scope can override `actions` / `llm` / `systemPrompt` / `layout` / `tools` independently or extend the root via `appendActions` / `appendSystemPrompt`.
- ✅ **`onLoopEnd` hook** — agent-loop closure UI: `silent` / `text` / `feedback` (Space accepts · double-tap rejects · Esc nulls — emits `agent_feedback`) / `ask_user` (closing question with options). Zero-config hosts get a graceful "Done ✓" close.
- ✅ **`agent_tool_failed` intent event** — emitted whenever a tool handler returns `{ ok: false }` (or throws — `reason: 'unknown'`, message preserved). Fills the visibility gap where the lifecycle's `agent_tool_end` fired on the host emitter but never landed in the intent stream. Dashboards can chart which tool is failing, why, how often.
- ✅ **Opt-in action bundles** — pre-v0.2 hosts got all 12 builtin actions installed by default and trimmed with `excludeTools`; empirically dddk-frontend disabled 6 of 12. v0.2 flips: default install = `coreActions` only (navigate / click / border / scroll_to). Opt into `formActions`, `flowActions`, `extraActions` via `customActions`. `builtinActions` kept as union for back-compat. Smaller prompt, honest catalog, encourages purpose-fit instead of "install everything then prune".
- ✅ **Cursor on every action** — the synthetic cursor used to only show for `click` (and `navigate` when `preferClickLinkOverNavigate` was on). v0.2 extends it to every interactive tool: `border` / `highlight` / `fill_input` glide cursor onto target before acting; `scroll_to` swaps the cursor glyph to a mouse-wheel icon, travels along the scroll, lands on the destination, reverts; `narrate` with `about` inherits it for free via the synthesized `border` call. New runtime API: `moveCursorTo(el)`, `cursorPulse()`, `setCursorMode('pointer' | 'scroll' | 'reading')`.
- ✅ **Inline palette + rich rows** — `dddk.palette.mountInline(host, opts?)` persistently embeds the palette inside a host element (no backdrop, no outside-click dismiss). Same items as the Ctrl/⌘+K modal; Ctrl/⌘+K raises the modal on top, close restores the inline. New `PaletteItem.lines: string[]` (multi-line metadata column) + `image: string` (thumbnail URL) + `submitButton: boolean` (circular send button at input's right edge).
- ✅ **Self-hosted analytics layer** (`@perhapxin/dddk/analytics`) — every emitted `BaseEvent` can land in a local IndexedDB-backed `EventStore` on the visitor's browser, queryable + cap-controlled (default 50k events / 30 days, hosts can lift to `Infinity` and pick a policy: `'ring'` / `'drop-new'` / `{ notifyHost }`). Bundled `toCSV` / `toNDJSON` / `toSQL` exporters reshape rows through a function-based `SqlSchemaMapper` so hosts can land events in any SQL store; the canonical `dddk_events` DDL ships for SQLite / Postgres / MySQL.
- ✅ **Mini dashboard** (`@perhapxin/dddk/analytics/dashboard`) — `renderDashboard(container, store)` mounts six vanilla-SVG charts (event volume, top palette items, agent completion rate, feedback distribution, voice usage, average LLM latency) into any DOM container; inherits `--dddk-*` theme tokens, no charting library dep, EN / zh-TW labels, optional auto-refresh. Hosts add their own custom tiles with the same `lineChart` / `barChart` / `donut` / `numberTile` primitives.

Full plan: [`ROADMAP-v0.2.0.md`](./ROADMAP-v0.2.0.md). v0.1.x bug fixes continue to ship on the `v0.1.x` branch.

## Status — early stage, read before evaluating

dotdotduck is in active development. It works, but expect rough edges. A few things up front:

- **Clone the repo to evaluate properly.** The bundled docs are useful as a map, but the source is the source of truth. `git clone https://github.com/PerhapxinLab/dotdotduck` into your project directory and read the code alongside the [online docs](https://dddk.perhapxin.com/docs) — that's the recommended way to understand what's actually implemented.
- **The docs are AI-drafted.** They're written and maintained with Claude Code. They stay close to the code by convention, but if something looks wrong, grep the repo before assuming the docs are right.
- **Found a bug or unclear behaviour?** Open an issue at [github.com/PerhapxinLab/dotdotduck/issues](https://github.com/PerhapxinLab/dotdotduck/issues) — one-liners help shape the roadmap.

### What the live demo runs (not bundled with the package)

[dddk.perhapxin.com](https://dddk.perhapxin.com) doubles as dotdotduck's official landing page AND as the real-world test bed for the package — every release ships first to this site and gets exercised end-to-end before being tagged. The standing challenge: serve the demo well using the **smallest viable model** at each role, so the same recipe holds up when other teams adopt dddk on a cost budget. Expect the model picks below to keep shifting as smaller checkpoints catch up.

Current stack:

- **4-axis LLM router** (`webagent` / `vision` / `utility` / `plan`) — host configures one model per role; the bundled demo runs OpenAI `gpt-5.4-nano` for the main agent loop and planner, `gpt-5.4-mini` for InlineAgent + voice cleanup.
- **Speech-to-text** → the browser's Web Speech API (the SDK default; fine for demo, no SLA — production hosts wire `transcribe` with Whisper / Deepgram / etc.)

None of this is baked into `@perhapxin/dddk`. The package itself ships LLM provider adapters (OpenAI / Google / proxy, plus any OpenAI-compatible vendor via `baseURL` — e.g. DeepSeek, Qwen, OpenRouter) and a `transcribe(audio)` extension point. Bring your own keys, models, and ASR vendor — the SDK doesn't lock you in.

## Documentation

- **What's new in v0.1.3** → [release notes](https://dddk.perhapxin.com/docs/v0.1.3/dddk/release-notes) · [migration guide](https://dddk.perhapxin.com/docs/v0.1.3/dddk/migrating)
- **Full docs** → [dddk.perhapxin.com/docs](https://dddk.perhapxin.com/docs/v0.1.3/dddk/overview)
- **Agent** (DOM-grounded loop + InlineAgent + sitemap + Memory) → [/dddk/agent](https://dddk.perhapxin.com/docs/v0.1.3/dddk/agent/overview)
- **LLM** providers + router + adapter registry → [/dddk/llm](https://dddk.perhapxin.com/docs/v0.1.3/dddk/llm/providers)
- **Skills** system + evals → [/dddk/skills](https://dddk.perhapxin.com/docs/v0.1.3/dddk/skills/overview)
- **Modules** (voice / Dwell / inline / immersive translate / proactive / analytics) → [/dddk/modules](https://dddk.perhapxin.com/docs/v0.1.3/dddk/modules/overview)
- **Toolbox** (search + recommend) → [/dddk/toolbox](https://dddk.perhapxin.com/docs/v0.1.3/dddk/toolbox/overview)
- **Theming** → [/dddk/theming](https://dddk.perhapxin.com/docs/v0.1.3/dddk/theming)

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

Press `Ctrl/⌘+K`, type `/introduce`, watch it run. The full [quickstart guide](https://dddk.perhapxin.com/docs/v0.1.3/dddk/quickstart-frameworks) covers React / Vue / Svelte / Solid wiring.

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

AGPL-3.0-or-later. See [LICENSE](./LICENSE) for the full text.

---

<p align="center">Built by Perhapxin Team</p>
