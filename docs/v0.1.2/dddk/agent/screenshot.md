# webagent — Screenshot

> Attach a visual snapshot of the page to every LLM turn, alongside the indexed DOM dump.

Disabled by default. The DOM dump is enough for most narration tasks — text, links, headings, table rows. Turn screenshots on when the agent needs to comment on visual content the dump can't convey: charts, custom canvases, complex visual layouts, image-heavy product cards.

## Quick start

```ts
import { WebAgent } from '@perhapxin/dddk';

const agent = new WebAgent({
  llm: ...,
  screenshot: true,         // shorthand → viewport mode
});
```

Or with full options:

```ts
new WebAgent({
  llm: ...,
  screenshot: {
    mode: 'full-page',      // 'viewport' (default) | 'full-page'
    maxSegmentHeight: 4000, // split tall pages into N images of this height
    maxImages: 3,           // hard cap per turn
    quality: 0.75,          // JPEG quality 0–1
    scale: 0.75,            // downscale factor 0.25–2
  },
});
```

## Modes

| Mode | What it captures | Images per turn |
|---|---|---|
| `viewport` | What the user currently sees | 1 |
| `full-page` | The full scroll height, auto-split when taller than `maxSegmentHeight` | 1–`maxImages` |

`viewport` is cheaper and matches what the user sees right now. `full-page` is what you want when the agent should reason about the whole page (pricing comparison across long tables, a docs page from top to bottom).

## Peer dependency

Out of the box, capture uses [`html2canvas`](https://www.npmjs.com/package/html2canvas) — an optional peer dependency loaded only when screenshots are enabled.

```bash
pnpm add html2canvas
```

If the host enables `screenshot` without installing it, capture silently no-ops and the agent runs text-only. No errors, no crash — just no images.

## Bringing your own capture

For server-side rendering, headless browser screenshots, or any other source, pass a `capture` function:

```ts
new WebAgent({
  llm: ...,
  screenshot: {
    mode: 'full-page',
    capture: async (mode) => {
      // Return one or more data URLs (or remote URLs the LLM can fetch).
      const res = await fetch('/api/render', { method: 'POST', body: JSON.stringify({ mode, url: location.href }) });
      const { images } = await res.json();
      return images;
    },
  },
});
```

When `capture` is provided, `html2canvas` is not loaded.

## How the images are sent

Captured images become `{ type: 'image', image: dataUrl }` content parts on the same user message that carries the per-turn DOM dump. Adapters translate to the provider's image-input shape — OpenAI's `image_url`, Google's `inlineData`, etc.

## Cost considerations

Each image costs tokens. With the defaults (`maxImages: 3`, `scale: 0.75`, `quality: 0.75`) a viewport screenshot adds roughly the same as a few thousand tokens of text. Multiply by `maxImages` for full-page.

If cost matters, prefer `viewport` mode and lean on the indexed DOM dump for the rest of the page. The dump is text-cheap and already lossless for anything with a label.

## When to skip

- Text-heavy sites (docs, blogs, settings panels) — the DOM dump captures everything.
- Latency-sensitive flows — each capture adds ~300 ms (more on slow devices).
- Cross-origin pages or shadow-DOM-heavy widgets — `html2canvas` has known limitations there; verify with your specific page first.
