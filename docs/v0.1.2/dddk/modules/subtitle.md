# dotdotduck — Subtitle UI

> The subtitle bar is dotdotduck's primary channel for talking to the user. Single Space = accept, double Space = reject, Tab = accept-one-line, Escape = cancel.

## Anatomy

The subtitle is a fixed strip at the bottom-centre of the viewport, overlaid above page content. Default look:

- Main text (up to two lines, ellipsis past that)
- A small hint row below: `Space accept · double-tap reject · Tab accept-one-line`
- Doesn't block interaction — clicks on page elements below the bar still register (pointer-events only cover the bar itself)

## Five types

| Type | Triggered by | Behaviour |
|---|---|---|
| `voice` | Speech-to-text result | Show + wait for user accept / reject |
| `selection` | InlineAgent result | Show + offer copy / accept |
| `agent` | webagent's `show_subtitle` action / agent reply | Show + let the agent continue |
| `post` | Text suggestion (autocomplete-style) | Accept inserts it / reject dismisses |
| `info` | Informational only | Sticky by default; pass `autoHide: <ms>` to dismiss automatically |

## API

```ts
import { Subtitle } from '@perhapxin/dddk';

const subtitle = new Subtitle({ locale: 'zh-TW' });

subtitle.show({
  text: 'Change the headline to "Annual Report"?',
  type: 'agent',
  onAccept: () => agent.respond('yes'),
  onReject: () => agent.respond('no'),
  onCancel: () => agent.stop(),
  onCopy: () => navigator.clipboard.writeText('...'),  // optional, surfaces a copy button
  hints: '...',                  // custom hint row, defaults to locale-aware accept/reject hint
  autoHide: 0,                   // ms; default 0 = sticky until user dismisses
  maxCharsPerPage: 220,          // paging — splits long text on sentence boundaries
});

subtitle.hide();
subtitle.isVisible();
subtitle.setLocale('en');        // swap the bundled accept/reject hint locale
subtitle.setTTSProvider(fn);     // read every subtitle aloud (see Voice docs)
subtitle.setVisibilityListener(fn);  // host hooks for gesture-manager sync
subtitle.setRunningLabel('Agent running…');  // label shown after Space accept while next LLM call is in flight
```

### Paging long content

When `text.length > maxCharsPerPage` (default 220), the bar splits the content on sentence boundaries (`. ! ? 。 ！ ？` + paragraph breaks). Space advances to the next page; only the FINAL page's `onAccept` fires the host callback. Each non-final page shows a `n/N · space → next page` hint. Set `maxCharsPerPage: 0` to render the whole text as a single (potentially scrolling) page.

### Indicator and subtitle are mutually exclusive

When a subtitle is visible, `showIndicator(state, label)` does NOT draw on top — it gets queued. The moment the subtitle hides (user accept/reject/dismiss), the queued indicator materialises. Use this for "agent finished narrating step N → start thinking about step N+1" flows.

```ts
subtitle.showIndicator('processing', 'Agent 執行中…');   // shown only when no subtitle visible
subtitle.hideIndicator();                                // also drops any pending request
```

## Multi-choice picker (`showChoice`)

`show()` is for binary yes/no (one accept callback + one reject). When the user needs to pick **one of 2–4 discrete options**, call `showChoice()` instead — the same slot renders a numbered option list plus an optional free-text input, and if you've already themed `show()` the two modes look identical.

```ts
subtitle.showChoice({
  question: 'What should I do with this?',
  options: ['Explain', 'Summarize', 'Translate', 'Other (type one)'],
  onChoose: (value, index) => {
    if (index === -1) startAgent(value);              // user typed free text
    else if (index === 0) startAgent('Explain this'); // preset option
    // ...
  },
});
```

### Options

| Field | Type | Default | Notes |
|---|---|---|---|
| `question` | `string` | — | The question itself. The TTS hook reads this verbatim — write it in natural prose. |
| `options` | `string[]` | — | 2–6 preset options. Rendered as a numbered list (1, 2, 3 …). |
| `allowFreeText` | `boolean` | `true` | Append a free-text input so the user can type an answer that isn't on the list. |
| `freeTextLabel` | `string` | (i18n default) | Placeholder for the free-text input. |
| `onChoose` | `(value, index) => void` | — | Required. See semantics below. |
| `onCancel` | `() => void` | — | Esc / programmatic close. |
| `autoHide` | `number` | — | Auto-dismiss after this many ms. Default: never; wait for user interaction. |

### `onChoose(value, index)` semantics

- `index >= 0` — User picked the option at that position; `value` is the option string.
- `index === -1` — User typed in the free-text input and pressed Enter; `value` is whatever they typed (no special "Other" sentinel — host just checks `index === -1`).

### Keyboard

| Key | Action |
|---|---|
| `1`..`9` | Pick the option at that index. |
| Click a row | Pick that option. |
| `Enter` (only inside the free-text input) | Submit with `index === -1`. |
| `Esc` | Fire `onCancel` then close. |

**Focus guard**: When focus is in another `<input>` / `<textarea>` / `<select>` / contenteditable, the digit keys are **not** intercepted — so opening the palette (or any other input) while the picker is up doesn't eat the user's first keystroke. Clicks and Esc still work normally.

### When to pick `showChoice` vs `show`

Use `showChoice()` when the user must pick **one of 2–4 discrete options** ("Explain / Summarize / Translate"). Use `show()` when the question is yes-or-no. Both route through the same subtitle slot — the visual language is consistent, only the shape of the answer differs.

## Keyboard map (single subtitle)

While a subtitle is showing:

| Key | Action |
|---|---|
| `Space` (single tap) | onAccept |
| `Space` (double tap) | onReject |
| `Tab` | onAcceptLine — accept only the first line, keep the rest displayed |
| `Escape` | onCancel |
| `Ctrl+Space` | Accept while focused inside an input |

## Voice indicator

When voice is active (or the agent is between steps), a small indicator (bouncing dots + label) appears — distinct UI from the main subtitle:

```ts
subtitle.showIndicator('listening', 'Listening — release to stop');
subtitle.showIndicator('processing', 'Processing…');
subtitle.hideIndicator();
```

Indicator and subtitle never both render at once — when a subtitle is showing, indicator requests are queued and surface only after the subtitle hides. See the "Indicator and subtitle are mutually exclusive" section above.

## Surface integration

Short interactions (single-pick / confirm) use `inline` placement — a small surface mounts above the subtitle. The host listens to the `surface` event and decides where to render:

```ts
dotdotduck.on('surface', ({ surface, placement }) => {
  if (placement === 'inline') mountAboveSubtitle(surface);
  else if (placement === 'center') mountModal(surface);
  else if (placement === 'dock') mountInDock(surface);
});
```

See [../surfaces/renderer.md](../surfaces/renderer.md) for the full flow.

## Theming (highlights)

Full token list in [../theming.md](../theming.md). Subtitle-specific variables:

```css
:root {
  --dddk-bar-bg: rgba(255, 255, 255, 0.95);
  --dddk-bar-text: #1a1a1a;
  --dddk-bar-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
  --dddk-bar-radius: 12px;
  --dddk-bar-padding: 12px 16px;
  --dddk-bar-bottom: 24px;
  --dddk-bar-max-width: 640px;
  --dddk-bar-z-index: 10000;
  --dddk-bar-font: system-ui, -apple-system, sans-serif;
}

[data-theme="dark"] {
  --dddk-bar-bg: rgba(28, 28, 28, 0.95);
  --dddk-bar-text: #ffffff;
}
```

## DOM structure

Every node carries a `data-dddk-ui` attribute so hosts can introspect or clean up:

```html
<div data-dddk-ui="bar" data-dddk-bar-type="agent">
  <div data-dddk-ui="bar-text">subtitle text</div>
  <div data-dddk-ui="bar-hints">Space accept · double-tap reject</div>
  <div data-dddk-ui="bar-buttons">
    <button data-dddk-action="accept" aria-label="Accept">✓</button>
    <button data-dddk-action="reject" aria-label="Reject">✕</button>
    <button data-dddk-action="copy" aria-label="Copy">⎘</button>
  </div>
</div>
```

Button glyphs are monochrome Unicode (`✓` `✕` `⎘`) — never multi-colour emoji.

## Multiple subtitles

There is at most one subtitle bar at any moment. A new `show()` replaces the previous one (unless the previous is an `info` subtitle in the middle of its auto-hide window).

If the agent calls `show()` repeatedly, later calls overwrite earlier ones. For a "step-by-step" reveal, sequence them in host code:

```ts
const steps = ['Step 1', 'Step 2', 'Step 3'];
for (const step of steps) {
  subtitle.show({ text: step, type: 'info', autoHide: 1500 });
  await new Promise(r => setTimeout(r, 1500));
}
```

## Responsive

- Mobile (`< 640px`): the bar becomes full-width; hints wrap to a second line.
- The bar auto-offsets above the on-screen keyboard when one is showing.

## What it doesn't do

- No floating / draggable mode
- Never pinned to a specific page coordinate (always fixed-bottom)
- No multi-instance mode
- No rich markdown (the bar renders plain text + light emoji only)

## Verify it works

After construction:

1. `subtitle.show({ text: 'hello', type: 'agent' })` → a rounded bar appears at the bottom-centre.
2. Press Space once → `onAccept` fires; double-tap Space → `onReject` fires.
3. `subtitle.showChoice({ question: '?', options: ['a','b','c'] })` → numbered list rendered; press `2` → `onChoose('b', 1)` fires.
4. If the bar never shows, check `--dddk-bar-z-index` isn't being overridden by a higher-z host element.
