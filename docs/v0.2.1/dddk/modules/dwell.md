# Dwell — long-press to pin a DOM element

> Long-press any visible element for ~700ms and a selection frame snaps onto it. The element becomes the "pinned context" for the next interaction — palette open, voice question, or LLM annotation popover.

Opt-in. Disabled by default; attach a `Dwell` instance to turn it on. Similar in shape to the iOS context-menu long-press: press, hold without moving, the frame appears; release before the timer fires and normal click / drag / text-selection proceeds as if nothing happened.

## When to use

Dwell is the "this thing on the page" pointer. Use it when:

- The user wants to ask a question **about** an element ("what is this button for?", "summarise this paragraph")
- A skill needs an arbitrary on-page region as context, but the element doesn't have a well-known selector you can hard-code
- You want a touchable equivalent of "right-click → inspect" for non-technical users

Don't reach for Dwell when:

- The user is selecting **text** inside an editable — that's [InlineAgent](./inline-agent.md)'s job
- You already know the selector and just want to drive the agent — call `dddk.startAgent()` directly
- You're driving with Spotter (the cursor-ring trigger that also pins elements) — pick one, not both, or they fight for the same gesture; see [Clash with Spotter](#clash-with-spotter) below

## Import

```ts
import { Dwell } from '@perhapxin/dddk';
import type { DwellConfig } from '@perhapxin/dddk';
```

## Minimum setup — pure selection gesture

The default mode does NOT call the LLM. The frame appears, your `onSelect` callback fires, the element is remembered. Subsequent actions (palette open, voice prompt) read the pinned element.

```ts
import { Dwell } from '@perhapxin/dddk';

let pinned: HTMLElement | null = null;

const dwell = new Dwell({
  // `llm` is optional — only needed when `annotateOnSelect: true`.
  dwellMs: 700,
  annotateOnSelect: false, // default — no LLM, just pin
  onSelect: (el, selector) => {
    pinned = el;
    // Hand the element's visible text to the next palette open as context.
    const text = (el.innerText ?? el.textContent ?? '').trim().slice(0, 240);
    dddk.palette.setPinnedContext(text, selector);
  },
  onClear: () => {
    pinned = null;
    dddk.palette.clearPinnedContext();
  },
});

dwell.attachTo(dddk);
```

## With LLM annotation popover

Set `annotateOnSelect: true` to recreate the legacy "long-press → AI annotation" UX. After the frame appears, the element's reachable DOM is sent to the `inline` LLM role; the response renders as a tight popover next to the cursor with a label and up to 3 suggested actions.

```ts
new Dwell({
  llm: yourLLM,
  dwellMs: 700,
  annotateOnSelect: true,
});
```

The popover JSON shape:

```json
{
  "label": "Refund button for order ORD-1002",
  "actions": ["Refund", "Copy order ID", "Open customer profile"]
}
```

Override the system prompt with `systemPrompt: '...'` for domain-specific labels.

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `llm` | — | `LLMSource`. Required if `annotateOnSelect: true`. |
| `dwellMs` | `700` | Hold time before selection fires. |
| `annotateOnSelect` | `false` | Run the LLM annotation popover after pin. |
| `onSelect` | — | `(el, selector?) => void`. Fires every time an element is pinned. |
| `onClear` | — | Fires when the pinned element is dismissed. |
| `maxContextChars` | `800` | Cap on DOM text sent to the LLM. |
| `systemPrompt` | built-in | Override the annotation prompt. |
| `enabled` | `true` | Start enabled. Toggle later with `setEnabled()`. |
| `ignoreSelector` | — | Extra selector for elements that should never trigger. |
| `ignoreDefaults` | `false` | Skip the built-in ignore list (input, textarea, contenteditable, etc.). |
| `triggerModifier` | `null` | Require `'alt' \| 'shift' \| 'meta' \| 'ctrl'` to be held during press. |
| `enableOnTouch` | `false` | Run the long-press detector on touch devices (collides with OS long-press). |

## Dismissal semantics — the frame persists

The frame represents **selection state**, not a hover preview. Once pinned, the only ways to clear it:

- `Esc` key
- Mousedown anywhere outside the marked element / popover
- The popover's own close button
- `dwell.setEnabled(false)` or `dwell.destroy()`

What does **not** clear it (deliberate, to fight a recurring regression):

- Mouse movement
- The LLM annotation call failing or timing out
- A new agent task starting

If you need to programmatically clear it, just call:

```ts
dwell.setEnabled(false);
dwell.setEnabled(true);
```

## Opt-out selector list

The default ignore list is:

```
[data-no-dwell], input, textarea, select,
[contenteditable], [contenteditable="true"], [draggable="true"]
```

`data-no-dwell` always wins. To add more without losing the defaults:

```ts
new Dwell({
  ignoreSelector: '.acme-hold-to-confirm, .acme-pricing-card',
});
```

To replace the defaults entirely (rare):

```ts
new Dwell({
  ignoreSelector: '.only-this-ignored',
  ignoreDefaults: true,
});
```

## Require a modifier

On sites that already use plain long-press for their own UI, hold a modifier to disambiguate:

```ts
new Dwell({ triggerModifier: 'alt' });  // Alt + long-press only
```

## Runtime API

```ts
dwell.markedElement();   // currently-pinned element, or null
dwell.setEnabled(false); // detach without unmount
dwell.setEnabled(true);  // re-enable
dwell.isEnabled();       // boolean
dwell.destroy();         // unmount listeners + popover
```

## Cookbook: Dwell long-press → multi-choice picker

This is the flagship interaction pattern for Dwell. The flow:

1. User long-presses an element. Dwell pins the frame on it and feeds the element's signature into `palette.setPinnedContext` so the next palette open sees it as context.
2. Immediately after pinning, the host opens a [`subtitle.showChoice`](./subtitle.md#multi-choice-picker-showchoice) picker asking *what* to do with the selection — usually a 3-option list of the most common asks plus an `Other (type one)` free-text fallback.
3. The user picks (`1`/`2`/`3`, click, or types into Other). The host translates the pick into a task string and calls `dddk.startAgent(task, { selection: { text, elements } })`.

```ts
const dwell = new Dwell({
  dwellMs: 500,
  annotateOnSelect: false,
  onSelect: (el, selector) => {
    pinned = el;

    // Hand the pinned element's signature to the palette as context.
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = el.classList.length
      ? '.' + Array.from(el.classList).slice(0, 3).join('.')
      : '';
    const sig = `<${tag}${id}${cls}>`;
    const inner = (el.innerText ?? el.textContent ?? '').trim().slice(0, 200);
    const ctx = inner ? `${sig} ${inner}` : sig;
    dddk.palette.setPinnedContext(ctx, selector, { kind: 'dom' });

    // Multi-choice picker right after pinning — the user just said
    // "I care about THIS thing", so surface the most common asks
    // (Explain / Summarise / Translate) plus an Other slot. Pick one
    // and the webagent runs immediately with the pinned element as
    // SelectionContext.
    dddk.subtitle.showChoice({
      question: 'What should I do with this?',
      options: [
        'Explain this',
        'Summarise',
        'Translate to 繁體中文',
        'Other (type one)',
      ],
      allowFreeText: true,
      autoHide: 8000,
      onChoose: (value, index) => {
        const task =
          index === 0 ? 'Explain in plain language what this selected element is and what it does.'
          : index === 1 ? "Summarise the key points of the user's selected section."
          : index === 2 ? "Translate the user's selected section to 繁體中文, preserving meaning and tone."
          : value; // free-text: pass the user's typed prompt straight through
        dddk.startAgent(task, {
          selection: { text: ctx, elements: [selector] },
        });
      },
      // onCancel intentionally omitted — Esc just dismisses the picker
      // and leaves the pin frame alone so palette / voice still work.
    });
  },
  onClear: () => {
    pinned = null;
    dddk.palette.clearPinnedContext();
  },
});
```

### Why this pattern

Earlier dddk hosts used a *time-based* proactive ("user has been dwelling on `/commercial` for 30 seconds — show a Yes/No proactive about the page"). Direct response to a deliberate user gesture beats time-based interruption every time: the user just told you which element they care about, so the moment to surface the picker is now, not 30 seconds from now.

### Behaviour notes

- `autoHide: 8000` — the picker dismisses itself after 8 seconds if the user ignores it, so a long-press that turned out to be accidental doesn't camp on the screen.
- `Esc` dismisses the picker but the Dwell pin **stays**. The pinned frame is selection state (see [Dismissal semantics](#dismissal-semantics--the-frame-persists)), so palette / voice triggered from it after dismissing the picker still see it as context. To clear the pin too, the user does the normal Dwell-clear gesture (Esc again with no picker open, mousedown outside, etc.).
- `index === -1` (free-text) is passed straight through as the task. There is no special "Other" sentinel string — the host distinguishes via the index, then routes the typed value as the agent prompt.

### When you don't want this

If you want Dwell to be a pure pinning gesture with no follow-up question (e.g. a workflow where palette open is the only intended next step), just omit the `showChoice` call inside `onSelect`. Dwell will still pin the frame and set the palette's pinned context; nothing else happens until the user does something else.

## Wiring Dwell into voice prompts

Once an element is pinned, your `voice_start` handler should prepend its visible text to the prompt before calling `dddk.startAgent`:

```ts
dddk.on('voice_start', () => {
  voice.captureOnce(dddk.subtitle).then((text) => {
    if (!text) return;
    if (pinned) {
      const ctx = (pinned.innerText ?? '').trim().slice(0, 600);
      dddk.startAgent(
        `User is asking about this on-page region:\n"""\n${ctx}\n"""\n\nQuestion: ${text}`,
      );
    } else {
      dddk.startAgent(text);
    }
  });
});
```

See [voice.md](./voice.md) for the voice-input pipeline this slots into.

## Clash with Spotter

Spotter (the cursor-ring trigger, see [../triggers/spotter.md](../triggers/spotter.md)) also pins elements — by hovering with the cursor ring instead of long-pressing. The two cover the same job from different ergonomics:

- **Spotter** — keyboard / pointer-precise; great for desktop power users
- **Dwell** — discoverable, works on cards and paragraphs without a cursor ring

Pick one as the primary. Running both is supported but the same element can get pinned twice (once by each), and `palette.setPinnedContext` will be called by whichever fires last. If you must run both, make sure their `onSelect` handlers are idempotent and share the same `pinned` variable.

## Touch behaviour

`enableOnTouch` defaults to `false`. The OS already uses long-press for text selection / context menus on iOS and Android, and mobile users typically interact via the [MobileTrigger](./mobile-trigger.md) chrome instead. Turn `enableOnTouch: true` on touch-only kiosks where the OS long-press is fine to override.

## Theming

The selection frame is a host-styled `[data-dddk-dwell-target]` attribute. Customise via CSS variables (see [../theming.md](../theming.md)):

```css
:root {
  --dddk-dwell-frame-color: var(--dddk-accent, #ec4899);
  --dddk-dwell-frame-width: 2px;
  --dddk-dwell-frame-offset: 4px;
  --dddk-dwell-frame-radius: 6px;
}
```

The annotation popover (when `annotateOnSelect: true`) ships its own scoped styles; override via the `[data-dddk-ui="dwell"]` attribute selector.

## Tear-down

```ts
dwell.destroy();
```

Removes listeners, popover, and the selection-frame attribute. Always call this in your SPA route-change / unmount path or you'll double-bind on the next `attachTo()`.

See also: [./overview.md](./overview.md) for the full module index.
