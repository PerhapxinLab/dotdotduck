# Gestures

`GestureManager` turns keyboard activity into dddk's ambient gestures: accept, reject, voice, palette toggle, escape. It runs at the `document` level in capture phase so it sees keys before the browser's built-in shortcuts (Ctrl+K, scroll-on-space, etc.).

You almost never `new` it yourself — `DotDotDuck` constructs one on `mount()` and wires it to `palette`, `subtitle`, and the webagent. You shape it through `DotDotDuckConfig`:

```ts
import { DotDotDuck } from '@perhapxin/dddk';

new DotDotDuck({
  gestureKey: 'space',        // or 'ctrl' (legacy migration). Default 'space'.
  voice: { enabled: true },   // false to disable hold-to-dictate
}).mount();
```

If you need finer control (custom shouldIntercept, a non-default hold threshold) you can construct `GestureManager` directly — it's exported.

---

## The gesture vocabulary

| Input                        | Fires                         | When                                                             |
| ---------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| Single space tap (<200ms)    | `onAccept`                    | Only when something is "awaiting" (subtitle visible / palette open). |
| Double space tap (<350ms)    | `onReject`                    | Always. Cancels the latest pending UI.                           |
| Long space hold (≥200ms)     | `onVoiceStart` → `onVoiceEnd` | Begins voice dictation; ends on key release.                     |
| `Tab` (when suggestion up)   | `onAcceptLine`                | Accept the next line of a streaming subtitle.                    |
| `Escape`                     | `onEscape`                    | Always. Dismisses palette, subtitle, spotter lock.               |
| `Ctrl+K` / `Cmd+K`           | `onPaletteToggle(selection)`  | Always. Captured selection text is passed along.                 |
| `Ctrl+Space` inside an input | `onAccept`                    | Accept while typing, without disturbing the input text.          |

A few subtleties:

- **Space in inputs** — keydown is `preventDefault`'d. If the user releases before the hold threshold, dddk inserts a literal space at the caret. If they hold past the threshold, voice starts and no space is inserted. So normal typing still works; long-press still dictates.
- **`hasSuggestion`** — the orchestrator flips this when the subtitle bar is visible. A single tap only fires `onAccept` while `hasSuggestion` is true; otherwise it's swallowed (so accidentally tapping space on a page with nothing pending doesn't do anything weird).
- **Voice gating** — `voice: { enabled: false }` makes `onVoiceStart` / `onVoiceEnd` no-op upstream. The hold is still detected (so palette doesn't open from the same hold), but no `voice_start` event fires.

---

## `GestureManagerOptions`

| field              | type                                | default     | what it does                                                  |
| ------------------ | ----------------------------------- | ----------- | ------------------------------------------------------------- |
| `callbacks`        | `GestureCallbacks`                  | —           | The seven handlers (table above).                             |
| `shouldIntercept`  | `() => boolean`                     | `() => hasSuggestion` | Called on every space keydown to decide whether dddk owns this keystroke. |
| `gestureKey`       | `'space' \| 'ctrl'`                 | `'space'`   | The key that means "gesture." Use `'ctrl'` for back-compat with old UIs. |
| `holdThresholdMs`  | `number`                            | `200`       | Hold duration before voice fires. Lower = snappier but more mis-fires. |

### `GestureCallbacks`

```ts
interface GestureCallbacks {
  onAccept: () => void;
  onReject: () => void;
  onAcceptLine: () => void;
  onVoiceStart: (selection: string, images: string[]) => void;
  onVoiceEnd: () => void;
  onPaletteToggle: (selection: string) => void;
  onEscape: () => void;
}
```

`onVoiceStart` receives a pre-captured selection (the text the user had highlighted at the moment they started holding) and any `<img src>`s inside that selection — same pattern as the palette's chip-bar.

---

## Tuning `holdThresholdMs`

Default 200ms is the sweet spot from internal testing.

- **Lower (150ms)** — feels instantaneous for voice but raises false-fires when users hesitate mid-tap. OK for power-user-only apps.
- **Higher (300–400ms)** — almost no false-fires but voice feels laggy; users assume the key is broken. Avoid unless you have data saying users complain.

This is a global setting — there's no per-context threshold. If you need conditional behaviour, gate it in `shouldIntercept`.

---

## `shouldIntercept`

By default dddk only swallows space when *something is pending* (subtitle visible, palette open). Plain pages let space scroll as usual.

The most common reason to override is to keep gestures from triggering inside specific inputs where even Ctrl+Space would be wrong:

```ts
import { GestureManager } from '@perhapxin/dddk';

const gestures = new GestureManager({
  callbacks: { ... },
  shouldIntercept: () => {
    // Don't intercept while the user is in a code editor.
    if (document.activeElement?.closest('.monaco-editor')) return false;
    return dddk.subtitle.isVisible() || dddk.palette.isOpen();
  },
});
gestures.start();
```

dddk's space-in-input handling (preventDefault on keydown, insert-on-tap, voice-on-hold) only runs when `shouldIntercept()` returns true for that keystroke. Return `false` and the key behaves normally.

---

## When to construct it manually

99% of hosts let `DotDotDuck` build the `GestureManager`. Build your own only if you're:

- Embedding dddk inside an existing app that already owns the keyboard (e.g. a Vim-bindings IDE) and want to share `GestureManager` between layers.
- Writing a test harness that needs to fire `onVoiceStart` synthetically.
- Replacing dddk's palette / subtitle wiring entirely.

Wire-up pattern:

```ts
import { GestureManager } from '@perhapxin/dddk';

const gestures = new GestureManager({
  callbacks: {
    onAccept:        () => yourAcceptHandler(),
    onReject:        () => yourRejectHandler(),
    onAcceptLine:    () => yourAcceptHandler(),
    onVoiceStart:    (sel, imgs) => yourVoiceStart(sel, imgs),
    onVoiceEnd:      () => yourVoiceEnd(),
    onPaletteToggle: (sel) => yourPalette.toggle(sel),
    onEscape:        () => yourDismiss(),
  },
  shouldIntercept: () => isAnyDddkUIVisible(),
  holdThresholdMs: 200,
});
gestures.start();

// later — when a suggestion appears / disappears
gestures.hasSuggestion = true;
gestures.hasSuggestion = false;

// teardown
gestures.destroy();
```

---

## Related

- [palette](./palette.md) — `Ctrl+K` routes through `onPaletteToggle`.
- [spotter](./spotter.md) — long-press while hovering an element bridges into Spotter's lock mode if Spotter is started.
- [subtitle](../modules/subtitle.md) — `onAccept` / `onReject` fire the subtitle's accept/reject callbacks for you.
