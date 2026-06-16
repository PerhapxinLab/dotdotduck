# ImmersiveTranslate — bilingual page rendering

> Walk the page DOM, batch translatable blocks into LLM calls, append the translation after each block. The output convention — a `<font class="dddk-imm-translate">` wrapper after each source block — was chosen because it survives most rich-text editors and PDF / Office HTML pipelines without being styled away by host CSS.

Opt-in. Disabled by default; attach an `ImmersiveTranslate` instance, then call `enable(targetLang)` from a palette command, button, or other host trigger.

## When to use

- Reading a long article in a foreign language and you want the translation **alongside** the original, not replacing it
- Translating user-facing docs / blog posts / KB articles inside an existing CMS preview
- Any page where the user wants to learn vocabulary by comparing source and target line-by-line

Don't use when:

- The text is in **editable** fields — use [InlineAgent](./inline-agent.md) to translate per-selection
- The page renders content through a native PDF plugin or a cross-origin Office Online iframe — the DOM isn't reachable
- The user wants a single string translated — call `llm.complete()` directly, no module needed

## Import

```ts
import { ImmersiveTranslate } from '@perhapxin/dddk';
import type { ImmersiveTranslateConfig } from '@perhapxin/dddk';
```

## Minimum setup

```ts
import { ImmersiveTranslate } from '@perhapxin/dddk';

const immersive = new ImmersiveTranslate({
  llm,
  batchSize: 8,       // blocks per LLM call (default 8 — small batches fan out further in parallel)
  batchCharCap: 1200, // OR break a batch at this char total (default 1200)
});
immersive.attachTo(dddk);

// Drive from a palette item (see /immersive_translate in the demo):
await immersive.enable('zh-TW', '繁體中文'); // run a full translation pass
immersive.disable();                          // strip injected translations
await immersive.toggle('ja');                 // shorthand
```

## How a single LLM call handles many blocks

The prompt sends a JSON array of source strings, one per block. The response must be a JSON array of the same length. Batches fan out in parallel with `Promise.all`, so wall-clock time is bounded by the slowest single batch, not the sum of all batches.

```json
// Request
["The agent runs in the visible DOM…", "Selection rides as context…", "…"]
// Response
["agent 在可見的 DOM 範圍內執行…", "選取會作為 context…", "…"]
```

LLM flags: `thinking: 'off'`, `jsonMode: true`, `temperature: 0.2` — deterministic translation, not reasoning.

## Block detection

The DOM walker visits every element matching these block-level tags and treats its `innerHTML` (not `textContent`) as one unit:

```
p, li, h1, h2, h3, h4, h5, h6, blockquote,
figcaption, td, th, dt, dd, summary, caption
```

Skipped automatically:

- `[data-dddk-ui]` — dddk's own UI
- `[data-dddk-no-translate]` — host opt-out per element
- `script`, `style`, `noscript`, `svg`, `code`, `pre`, `kbd`
- `.dddk-imm-translate` — already-translated nodes
- Elements whose `textContent` is < 2 chars after trim
- Elements that contain a block-level child (so nesting doesn't double-translate)

Add more via `ignoreSelector`:

```ts
new ImmersiveTranslate({
  llm,
  ignoreSelector: '.ads, .footer-legalese',
});
```

## Inline-tag preservation

The block's `innerHTML` is sent — so inline tags like `<a>`, `<strong>`, `<em>`, `<code>`, `<span>` are visible to the LLM. The system prompt instructs the model to preserve them verbatim and around the same content. URLs, numbers, dates, and proper nouns are kept as-is unless they have an established translation.

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `llm` | — | `LLMSource` (required). |
| `batchSize` | `8` | Max blocks per LLM call. Smaller = more parallel fan-out. |
| `batchCharCap` | `1200` | OR break a batch at this combined char total. |
| `ignoreSelector` | — | Extra CSS selector for elements to skip. |
| `root` | `document.body` | Walk only inside this element. |
| `cache` | in-memory `Map` | `{ get(key), set(key, val) }` — persist across reloads. |

## Caching

Translations are keyed by `(source-text-hash, target-language)` using a 32-bit FNV-1a hash. The default in-memory `Map` is wiped on reload; back it with `localStorage` (or any KV) for persistence:

```ts
new ImmersiveTranslate({
  llm,
  cache: {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
  },
});
```

A cached entry never hits the LLM, so re-enabling the same language on the same page is instant.

## Wrapper element — why `<font>`

The translation is appended as `<font class="dddk-imm-translate">` (with a leading `<br>` for visual separation). The legacy `<font>` tag is a deliberate choice because:

- It survives most rich-text editors (TinyMCE, ProseMirror, Quill) without being styled away
- PDF viewers (pdf.js) and Office Online overlays preserve it when the user copies / exports
- It's inline by default, so block layout isn't disturbed

If a host needs a different tag, fork — there's no per-instance override.

## PDF / docx scope

Works when the document is **in the DOM**:

- pdf.js's selectable-text overlay (Chrome's built-in viewer, Mozilla pdf.js)
- `mammoth.js`-rendered docx
- Any HTML preview component

Out of reach (browser sandboxing):

- Native PDF plugins (the browser's built-in plugin viewer, not the JS overlay)
- Cross-origin Office Online iframes (Microsoft / Google embeds)

The `<font>` wrapper choice means: if your host renders PDF / docx as inline HTML, the bilingual layout is preserved when the user saves / exports.

## Progress UI

Each batch updates the subtitle bar:

```
沉浸式翻譯 → 繁體中文 (148 blocks)
沉浸式翻譯 30/148 → 繁體中文
沉浸式翻譯 60/148 → 繁體中文
...
沉浸式翻譯完成 (148 blocks)
```

Hosts can override by listening for the standard `subtitle` events and rendering their own progress UI.

## Runtime API

```ts
await immersive.enable('zh-TW', '繁體中文');  // run a full pass
immersive.disable();                          // strip translations
await immersive.toggle('ja', '日本語');        // shorthand
immersive.isEnabled();                        // boolean
immersive.language();                         // currently-active target lang, or null
```

Calling `enable()` with the same language twice is a no-op. Switching languages auto-disables the previous pass first.

## SPA navigation auto-cleanup

`attachTo(dddk)` installs a route-change listener (`popstate` + patched `history.pushState` / `replaceState`). On any SPA route change, the module **automatically calls `disable()`** to strip the previously-injected `<font class="dddk-imm-translate">` siblings. Without this, the host SPA swaps its page slot but the translation nodes stay attached to the still-mounted parents — they bleed into the next route, making it look like two pages are stacked. The cleanup is idempotent (re-calling `attachTo` replaces the previous listener) and host-agnostic (SvelteKit / Next / Vue Router all funnel SPA nav through the same APIs).

## Failure handling

If a single batch fails, that batch is skipped (logged as `[immersive-translate] batch failed`) and the rest of the document continues. The page is never left in a partially-mutated, can't-recover state — `disable()` always strips everything cleanly via the `.dddk-imm-translate` class.

See also: [./inline-agent.md](./inline-agent.md) for per-selection translation inside editables, [./overview.md](./overview.md) for the module index.
