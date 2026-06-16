# Spotter

`Spotter` is the **explicit "pick an element" picker**. The user moves the mouse, dddk frames whatever they hover, they click to lock, or they drag to lasso a region. The agent then knows exactly which DOM node(s) the user is talking about.

`DotDotDuck` constructs a `Spotter` instance for you, but `enableRing: false` is the default — Spotter doesn't render anything until you start it.

```ts
import { DotDotDuck } from '@perhapxin/dddk';

const dddk = new DotDotDuck({ /* ... */ });
dddk.mount();

// Turn on the hover ring (e.g. when the user picks "select an element"):
dddk.spotter.start();

// When done:
dddk.spotter.destroy();
```

---

## The three states

| State    | What the user sees                                | How it ends                                                |
| -------- | ------------------------------------------------- | ---------------------------------------------------------- |
| `idle`   | Nothing.                                          | —                                                          |
| `ring`   | Pink animated frame around the hovered element.  | Mouse moves away (ring disappears) or click to lock.       |
| `lock`   | Frame pinned around a chosen element.            | Host calls `unlock()` or user starts a new action.         |
| `lasso`  | Dashed rect being drawn under the cursor.        | Mouse-up commits the region; <5px wide cancels.            |

State transitions:

```
idle ─(hover 200ms)→ ring ─(click)→ lock ─(unlock)→ idle
  └─(beginLasso)→ lasso ─(endLasso)→ idle
```

Ring shows after a 200ms hover dwell so the screen doesn't flash a frame around every paragraph the user pauses on. `ringDelay` is configurable.

---

## Constructor: `SpotterOptions`

| field             | type                                          | default | what it does                                                |
| ----------------- | --------------------------------------------- | ------- | ----------------------------------------------------------- |
| `ringDelay`       | `number`                                      | `200`   | ms of hover required before the ring appears.               |
| `enableRing`      | `boolean`                                     | `true`  | Hover-to-frame. `DotDotDuck` overrides this to `false`.    |
| `enableLasso`     | `boolean`                                     | `true`  | Drag-to-region.                                              |
| `ignoreSelector`  | `string`                                      | —       | CSS selector for elements Spotter must never frame. dddk passes `[data-dddk-ui]` so the palette / subtitle don't trigger it. |
| `onRingShow`      | `(info: { selector, element, rect }) => void` | —       | Fires every time the ring appears around a new element.    |
| `onRingHide`      | `() => void`                                  | —       | Fires when the ring goes away.                             |
| `onLock`          | `(info: { selector, element }) => void`       | —       | Fires when the user pins the current ring as a lock.       |
| `onLassoComplete` | `(info: { elements, bounds }) => void`        | —       | Fires on mouse-up after a valid lasso drag.                |

The orchestrator's `dddk.spotter` is wired to forward all four callbacks as dddk events (`pointer_ring_show`, `pointer_ring_hide`, `pointer_lock`, `pointer_lasso`) — so for most cases you just listen on `dddk.on(...)` instead of constructing your own.

---

## Direct API

```ts
spotter.start();              // attach the mousemove listener
spotter.destroy();            // detach + clear ring + cancel lasso
spotter.getState();           // 'idle' | 'ring' | 'lock' | 'lasso'

spotter.lockCurrent();        // pin whatever's currently in ring; returns
                              // { selector, element } or null

spotter.beginLasso(x, y);     // explicit start (use from a hotkey)
spotter.updateLasso(x, y);    // usually wired automatically via mousemove
spotter.endLasso(commit);     // commit:true fires onLassoComplete

spotter.unlock();             // drop the lock, return to idle
```

`lockCurrent()` is typically called from `GestureManager.onVoiceStart` so that long-press-while-hovering pins the hovered element for the agent.

---

## Wiring it into your app

### Scenario A — "Pick an element" mode

User clicks a toolbar button → ring starts → user clicks an element → you do something with the selector:

```ts
import type { SpotterOptions } from '@perhapxin/dddk';

function startElementPick() {
  dddk.spotter.start();
  const off = dddk.on('pointer_lock', ({ selector }) => {
    off();
    dddk.spotter.destroy();
    dddk.startAgent(`Tell me about this element.`, {
      selection: { element: selector },
    });
  });
}
```

### Scenario B — Lasso a region for the agent

```ts
function startLasso() {
  dddk.spotter.start();
  // Custom hotkey starts the lasso at the cursor (your code captures cursor pos).
  document.addEventListener('mousedown', (e) => {
    if (!e.shiftKey) return;
    dddk.spotter.beginLasso(e.pageX, e.pageY);
    const upOnce = (ev: MouseEvent) => {
      dddk.spotter.endLasso(true);
      document.removeEventListener('mouseup', upOnce);
    };
    document.addEventListener('mouseup', upOnce);
  });

  dddk.on('pointer_lasso', ({ elements, bounds }) => {
    const selectors = elements.map((el) => el.tagName.toLowerCase()).join(', ');
    dddk.startAgent(`The user circled this region: ${selectors} (${bounds.width}×${bounds.height}).`);
  });
}
```

`pointer_lasso` carries the list of fully-contained `HTMLElement`s and the bounding `DOMRect`. The list is currently a full-DOM O(n) scan — fine for the deliberate-gesture use case but don't fire it 60 times a second.

---

## Spotter vs. Dwell — when to use which

Both let the user "point at an element." The difference is in the gesture:

| Surface | Trigger             | Best for                                                                   |
| ------- | ------------------- | -------------------------------------------------------------------------- |
| Dwell   | Long-press an element | Mobile + desktop. User holds on the *element itself*; no separate picker mode. See [Dwell](../modules/dwell.md). |
| Spotter | Hover with ring + click | Power-user pick flow where the user explicitly enters "point at something" mode (toolbar button, `/inspect` skill). |

Rule of thumb: if the gesture happens *in passing* (user is reading, sees something, long-presses it), use Dwell. If the gesture is *a mode the user enters* ("Help me pick an element"), use Spotter.

The two can coexist — Dwell takes long-press, Spotter takes hover+click — but if both are enabled, document why; users get confused when two similar gestures both pin elements with subtly different behaviour.

---

## When NOT to use Spotter

- **Selecting text** — just use `window.getSelection()`. The palette's chip-bar reads it automatically on open.
- **Confirming an agent step** — that's [gestures](./gestures.md) (`onAccept`).
- **Long-press to pin** — use [Dwell](../modules/dwell.md). Spotter's ring is for "rest your mouse and we'll frame what's under it," not for explicit long-press.
- **Hover tooltips** — use HTML `title` or your own tooltip lib. Spotter is heavier and has app-level state.
