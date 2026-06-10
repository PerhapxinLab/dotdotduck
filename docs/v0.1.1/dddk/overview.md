# Overview

`@perhapxin/dddk` is a drop-in AI layer for any web product. Install the package, mount one instance, and your users get:

- **Command palette** — `Ctrl+K` opens. Prefix routing, fuzzy search, your custom commands.
- **Web agent** — natural-language tasks that operate the page (click / type / navigate / confirm on destructive actions).
- **Voice input** — hold Space to dictate, optional LLM cleanup pass.
- **Inline agent** — select text inside an `<input>` / `<textarea>` / contenteditable; a floating menu opens below the selection with translate / improve / fix-grammar / explain. Pairs with Dwell — long-press any element to pin it as the next palette / agent's context.

You **never write UI** for any of this. `dotdotduck` ships its own palette, subtitle bar, mobile chrome, agent cursor, Dwell popover, all styled and themeable via CSS variables. You just register what your product can do (palette items, skills) and bring an LLM.

## 30-second install

```bash
npm install @perhapxin/dddk
```

```ts
import { DotDotDuck, OpenAIProvider } from '@perhapxin/dddk';
import '@perhapxin/dddk/styles.css';

const dotdotduck = new DotDotDuck({
  siteName: 'YourSaaS',
  llm: new OpenAIProvider({ apiKey: process.env.OPENAI_KEY! }),
});
dotdotduck.mount();
```

That's it. `Ctrl+K` works, voice works, Dwell works.

## Where to next

| You want to... | Read |
|---|---|
| Use it in React / Svelte / Next.js / Vue | [quickstart-frameworks](./quickstart-frameworks.md) |
| Add a `/skill` that runs a guided tour or LLM template | [skills / how-to-add-a-skill](./skills/how-to-add-a-skill.md) |
| Add a palette command that calls your own code | [triggers / palette](./triggers/palette.md) |
| Toggle voice / subtitle / Dwell on/off | [modules / overview](./modules/overview.md) |
| Change colors / fonts / dark mode | [theming](./theming.md) |
| Wire your own LLM keys safely (server-side proxy) | [agent / security](./agent/security.md) |

## What you DON'T do

- Don't write palette UI yourself — `dotdotduck` renders it.
- Don't proxy events manually — register a palette item, dotdotduck fires its handler.
- Don't roll your own DOM action layer — webagent has 12 built-in actions plus your custom ones.
- Don't ship API keys to the client bundle. Use `ProxyProvider` + a worker that holds the key. See the security guide in webagent.

---

## What's in the SDK — a map

dddk is bigger than the four headline features above. Under the hood it splits into eight top-level clusters, each with its own folder of docs. Use this table as a sitemap when you're hunting for "is there a thing that does X?".

| Cluster | Folder | One-line | Read |
|---|---|---|---|
| **Triggers** | `triggers/` | Entry points that turn a user gesture into a dddk intent — palette, space gestures, Spotter, panel runtime. | [triggers / overview](./triggers/overview.md) |
| **Skills** | `skills/` | Registerable units of host behaviour the agent (or the user) can invoke — script, prompt, action, surface, panel. | [skills / overview](./skills/overview.md) |
| **Modules** | `modules/` | Opt-in attachable features: voice, subtitle, Dwell, inline-agent, immersive translate, agent cursor, mobile trigger, form-assist, onboarding, theme + language. | [modules / overview](./modules/overview.md) |
| **Surfaces** | `surfaces/` | Structured UI emitted by the SDK — `PieceSurface` tree, `PieceRenderer`, the catalog, placements (`center` / `inline` / `dock`). | [surfaces / renderer](./surfaces/renderer.md) |
| **Toolbox** | `toolbox/` | Zero-LLM, zero-server NLP / retrieval primitives — search (BM25), QA, classify, recommend, memory, proactive, analytics. | [toolbox / overview](./toolbox/overview.md) |
| **Extensibility** | `extensibility/` | Where the SDK exposes its seams — tools registry for the agent, evals harness, React adapter, cache + heat-rank. | [extensibility / tools-registry](./extensibility/tools-registry.md) |
| **Theming** | `theming.md` | The CSS-variable token surface for restyling everything dddk renders. | [theming](./theming.md) |
| **Quickstart** | `quickstart-frameworks.md` | Wiring guides for React / Svelte / Next.js / Vue with the right lifecycle. | [quickstart-frameworks](./quickstart-frameworks.md) |

If you're scanning for a specific subsystem, the **subfolder always carries its own `overview.md`** (except `extensibility/`, where `tools-registry.md` is the entry point). Start there before drilling into numbered chapters.

---

## How to read these docs

The docs split into two layers, and which one to read depends on what you're doing.

**Top-level chapters (`dddk/00-*` … `dddk/11-*`)** are the "core curriculum" — the things every host integrating dddk has to deal with regardless of which features they enable. Read these front-to-back the first time you wire dddk into a product: overview → quickstart → theming. They're stable and rarely move.

**Subfolders** (`triggers/`, `skills/`, `modules/`, `surfaces/`, `toolbox/`, `extensibility/`) are deep-dives, each starting with its own `overview.md` that explains the cluster's mental model and lists what's inside. Open a subfolder when you've decided you need *that* cluster — e.g. you've decided to add proactive suggestions, so you open `toolbox/proactive.md`. You don't need to read the whole subfolder; the overview tells you which chapter solves your specific problem.

Some clusters carry a **「優化中 / Tuning」** badge at the top of their overview (currently `modules/`, parts of `toolbox/`, and a few extensibility chapters). That means the **APIs are stable** — your code won't break across patch releases — but the **defaults and ergonomics are still settling** as real apps stress-test them. Expect copy strings, default timeouts, and threshold values to shift more than function signatures. If you're shipping to production against a Tuning chapter, pin the version and re-read the chapter at upgrade time.

Everything else is considered settled: the type names, the public exports listed in each chapter's "What's exported" section, and the behaviour described in the prose are the contract.

---

## Reading order by role

Not every reader has the same job. Three common paths:

**You're integrating dddk into a product for the first time.** Read in this order: this overview → [quickstart-frameworks](./quickstart-frameworks.md) → [triggers / palette](./triggers/palette.md) → [skills / how-to-add-a-skill](./skills/how-to-add-a-skill.md) → [theming](./theming.md). That's enough to ship a working integration. Skip everything else until a real need surfaces.

**You're customising look-and-feel.** Go straight to [theming](./theming.md) — there's a "Build your own theme" cookbook with sepia / high-contrast / brand-colour walk-throughs. Then [modules / subtitle](./modules/subtitle.md) if you want to restyle the subtitle bar specifically.

**You're extending the agent's capabilities.** Read [extensibility / tools-registry](./extensibility/tools-registry.md) to register tools, then [toolbox / overview](./toolbox/overview.md) to see what's already available before writing your own. The `notes/toolbox-as-tools.md` design doc in the repo (if you've cloned it) covers the underlying pattern.

**You're building a structured-UI feature (forms, agent-authored panels, dock surfaces).** Start with [surfaces / renderer](./surfaces/renderer.md), then [surfaces / pieces-catalog](./surfaces/pieces-catalog.md) for the deeper API, then [surfaces / placements](./surfaces/placements.md) for the three placement modes.

---

## Public exports — the contract

Everything reachable through `@perhapxin/dddk` is the public API. Everything reachable only through deeper paths (`@perhapxin/dddk/internal/*` if such a thing existed) is not. We don't currently ship subpath exports, so the rule is simple:

```ts
// Public — supported, semver-stable
import { DotDotDuck, CommandPalette, PieceRenderer } from '@perhapxin/dddk';

// Don't do this — relative paths into node_modules
import { foo } from '@perhapxin/dddk/dist/internal/foo';
```

Each chapter's "What's exported" section lists the public surface from that chapter. If a symbol is not in any "What's exported" list and not in `src/index.ts`, treat it as private — it may move or rename between minor versions.

---

## Versioning

dddk uses semver with one caveat: **CSS variable names are part of the contract**. Renaming a `--dddk-*` token is a breaking change and bumps minor. Adding a new token is non-breaking. Defaults can shift within a Tuning chapter without a version bump — pin if you depend on a specific default.

Pre-1.0 (`v0.x`): minor bumps may carry breaking changes for clusters that haven't stabilised yet (currently `modules/` and `extensibility/cache-heatrank`). Patch bumps are always non-breaking.

---

## The mental model in one paragraph

If you remember nothing else: dddk is a host-mounted orchestrator (`DotDotDuck`) that owns four triggers (palette, gestures, Spotter, panel) and a registry of host-defined skills. Skills are how *your* code plugs in — each one declares what it can do; the orchestrator wires it to the triggers and the LLM. When a skill needs UI, it emits a `PieceSurface` (a tree of typed primitives); the host renders the tree with `PieceRenderer`. Long-running, opt-in features (voice, Dwell, immersive translate, …) attach as separate modules. Anything text-shaped you want without an LLM — search, classify, recommend — lives in the toolbox. That's the whole shape. Every chapter is a zoom-in on one of those boxes.

---

## Common pitfalls

A short list of things that have tripped real integrations:

- **Mounting twice.** Calling `dotdotduck.mount()` a second time without `destroy()` in between double-binds keyboard listeners. In SPA frameworks with HMR, gate mount on a "first time" flag.
- **API key in the client bundle.** `new OpenAIProvider({ apiKey })` works in dev but ships your key to every visitor in prod. Use `ProxyProvider` pointed at a worker that holds the real key.
- **Skill IDs without a slash.** The palette treats `/foo` as a skill route and `foo` as a search query. ScriptSkill / PromptSkill should start with `/`; ActionSkill / SurfaceSkill are usually surfaced as named palette items instead.
- **Theming via class selectors.** Don't write `.dddk-button { background: red }` — dddk classes are not part of the contract and may rename. Use `--dddk-accent` and `[data-dddk-ui="..."]` instead.
- **Forgetting `destroy()` on route change.** SPA hosts that swap their root component without calling `dotdotduck.destroy()` leak listeners and DOM. Wire `destroy()` into your router's unmount hook.

These also appear in the "Common pitfalls" sidebar of each relevant chapter — this list is just the union.
