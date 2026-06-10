# DOM dump format

> The text the agent actually sees each turn. Read this when you want to tune your `appendSystemPrompt` to reference page structure, or when you're debugging "why didn't the agent click the right element."

## What's in the dump

Every turn, the webagent serialises the page into a compact text block and pastes it into the user message right before the LLM call. The block looks like this:

```
URL: https://yoursite.com/pricing
TITLE: Pricing — YourSaaS
VIEWPORT: 240px above · 900px visible · 1820px below

[1]<a href="/">Home</a>
[2]<section> Pricing
	[3]<h2>Plans</h2>
	[4]<table>
		[5]<tr>
			<td>Hobby</td><td>Free</td>
		[6]<tr>
			<td>Pro</td><td>$29 /mo</td>
↓[7]<section> FAQ
	↓[8]<h2>Common questions</h2>
```

Three header lines, then an indented tree of every actionable element.

## The three header lines

| Line | What it means |
|---|---|
| `URL: …` | The page the agent is currently looking at. Use this in your prompt to gate destination logic — "if the user named a destination matching a sitemap route and URL is not that route, navigate first." |
| `TITLE: …` | `document.title` truncated. Useful for quick orientation. |
| `VIEWPORT: 240px above · 900px visible · 1820px below` | Where the user is scrolled on the page right now. The agent uses this to decide whether to `scroll_to` an element before talking about it. |

The viewport line is the strongest hint the SDK gives the agent about user attention. Reference it in your prompt when you want narration to track what the user can actually see: "If the subject is below the visible window, call `scroll_to` first."

## The indexed tree

Every actionable element is prefixed with a numeric index in brackets: `[3]`, `[12]`, etc. The agent calls every tool with **the index** as the selector:

```
border({ selector: "5" })       // or "[5]" — both parse
click({ selector: "12" })
scroll_to({ selector: "8" })
```

The host doesn't need to know any CSS selector; the SDK's `resolveSelector(target)` looks up the numeric index in a per-turn map and returns the live Element. CSS selectors still work as a fallback for elements outside the dump.

Tab indentation reflects parent → child structure for sectioning containers (`<section>` / `<article>` / `<aside>` / `<table>` / `<tr>` / `<form>` / `<details>` / `<dl>` / `<dialog>` / `<header>` / `<footer>` / `<main>` / `<nav>` / `<hgroup>`). All other wrappers (`<div>`, `<span>`, framework `display: contents` fragments) flatten through without bumping indent — they're DOM noise the agent doesn't need to know about.

### Viewport markers

A leading `↑` or `↓` on a line means that element is **out of the current viewport**:

| Marker | Meaning |
|---|---|
| `↑` | scrolled past — above the visible window |
| (none) | currently visible to the user |
| `↓` | below the fold — user needs to scroll down |

When the agent wants to point at an element with a `↓` marker, it should call `scroll_to` first so the user can see what the next sentence is about. The SDK's bundled system prompt teaches this rhythm; host prompts only need to reinforce it for vertical layouts.

The viewport check uses `getBoundingClientRect()` at dump time, so it tracks the user's current scroll position turn-by-turn.

## What gets included

| Category | Tags | Emission |
|---|---|---|
| **Interactive** | `<a>`, `<button>`, `<input>`, `<select>`, `<textarea>`, `<label>`, `<summary>`, plus any element with an interactive ARIA role (`button` / `link` / `tab` / `menuitem` / `option` / `checkbox` / `radio` / `switch` / `combobox` / `textbox` / `slider` / `spinbutton`) or a keyboard-focusable `tabindex` with an accessible label | Numbered, no descent |
| **Headings** | `<h1>` – `<h6>` | Numbered |
| **Sections** | `<section>`, `<article>`, `<aside>`, `<fieldset>`, `<main>`, `<nav>`, `<header>`, `<footer>`, `<hgroup>`, `<table>`, `<tr>`, `<form>`, `<details>`, `<dl>`, `<dialog>` | Numbered + bump indent for children |
| **Media** | `<img>` | Numbered; emits `alt` text (or filename hint if no alt) |
| **Preformatted** | `<pre>` | Numbered; preserves newlines, capped at 600 chars |
| **Content lines** | `<p>`, `<li>`, `<td>`, `<th>`, `<dt>`, `<dd>`, `<blockquote>`, `<figcaption>`, `<caption>`, `<legend>`, `<output>`, `<meter>`, `<progress>` | Flat text, no index |

## What gets dropped

- `<script>`, `<style>`, `<noscript>`, `<template>`, `<iframe>`, `<svg>`, `<canvas>`, `<source>`, `<track>`, `<head>`, `<meta>`, `<link>` — silently skipped.
- Anything hidden by `display: none` / `visibility: hidden` / zero bounding box. (`display: contents` is the exception: the element has no box but children render, so the walker descends without bumping indent.)
- Anything matching the host's `domFilter` function passed to `WebAgentConfig`.
- Anything with `class="dddk-skip"` or attribute `data-dddk-skip` (and its subtree).

## Host opt-outs

Two ways to tell the dump "don't include this":

### Class / attribute opt-out

Add `dddk-skip` to elements you never want the agent to see — site chrome, cookie banners, footer fine print:

```html
<footer class="site-footer dddk-skip">…</footer>
<div data-dddk-skip>internal-only widget</div>
```

Both the matching element AND its entire subtree disappear from the dump.

### `domFilter` function

For dynamic conditions (route-specific filtering, user-permission-aware hiding):

```ts
new DotDotDuck({
  webAgent: {
    domFilter: (el) => !el.matches('nav.global-nav, footer, [data-cookie]'),
  },
});
```

Return `false` to drop the element + its subtree. Applies after the class-based skip.

## Size caps

The dump is capped at `domMaxLength` characters (default ~12,000). When the cap fires, the dump ends with a `[...truncated]` marker. Increase it for dense pages (long pricing tables, docs with many headings); decrease it on token-budget-sensitive deployments.

The cap is char-based not token-based, but the rest of the pipeline (`maxPromptTokens` on `WebAgentConfig`) catches over-long full prompts at the message-array level.

## Debug exposure

Every dump is mirrored to `window.__dddkDebug`:

```ts
window.__dddkDebug.lastDom          // string the LLM saw
window.__dddkDebug.lastDomAt        // ISO timestamp
window.__dddkDebug.lastDomBytes     // size
window.__dddkDebug.lastIndexMap     // Map<number, Element> the tools resolved against
window.__dddkDebug.lastLlmMessages  // full message array sent to the LLM (system + history + env block)
```

Pop devtools, type `__dddkDebug.lastDom` after any agent turn, and you'll see exactly what the model read — invaluable when narration goes sideways and you need to ask "did the agent even see that section?"

See also: [prompt-design](./prompt-design.md) for how the dump composes with the layered system prompt, [actions/catalog](./actions/catalog.md) for the indexed-selector contract every tool uses, [screenshot](./screenshot.md) for attaching a viewport / full-page screenshot alongside the text dump.
