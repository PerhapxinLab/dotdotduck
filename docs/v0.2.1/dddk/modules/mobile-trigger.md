# MobileTrigger — FAB + swipe entry for touch devices

> Two mobile entry points: a floating action button (FAB) that's always visible, and a rapid up-down swipe gesture that slides in top + bottom chrome bars. Tap the central voice button, open the palette, or close to return to the page.

Opt-in. Mobile-only — no-op on wide desktop viewports unless `forceEnable: true`.

## When to use

- Any production app shipping dddk to phones / tablets
- Demo pages where users will visit on mobile — the FAB is the only obvious entry point without a hardware keyboard
- Kiosks / tablets where users won't think to long-press or use Ctrl+K

Don't use when:

- Your app is desktop-only and you've set `viewport` to disable mobile rendering
- You already ship your own FAB / nav trigger — see [`bindTrigger`](#bind-your-own-trigger) to wire that into dddk instead

## Import

```ts
import { MobileTrigger } from '@perhapxin/dddk';
import type { MobileTriggerConfig, MobileFABConfig } from '@perhapxin/dddk';
```

## Minimum setup

```ts
import { MobileTrigger } from '@perhapxin/dddk';

const mobile = new MobileTrigger();
mobile.attachTo(dddk);
```

The default FAB renders bottom-right with a sparkle SVG. Tap opens the palette; long-press fires `voice_start` (same as the desktop Space gesture).

## Three ways to trigger

### 1. Default FAB

Always visible on touch devices or narrow viewports (`max-width: 768px`). Fully customisable:

```ts
new MobileTrigger({
  fab: {
    icon: '✨',           // emoji, raw HTML/SVG, or an HTMLElement
    text: 'Ask',          // optional text next to the icon
    position: 'bottom-left',
    offset: { x: 16, y: 80 },
    size: 60,
    shape: 'pill',        // 'circle' | 'square' | 'pill'
    style: { background: 'linear-gradient(45deg, #ec4899, #8b5cf6)' },
    onTap: (dddk) => dddk.palette.toggle(),
    onLongPress: (dddk) => dddk.triggerVoiceStart(),
  },
});
```

Disable the default FAB:

```ts
new MobileTrigger({ fab: false });
```

### 2. Bind your own trigger

If you already ship a header / nav button, give it the same gesture handling as the FAB:

```ts
const off = mobile.bindTrigger(document.querySelector('#my-header-btn')!, {
  onTap: (dddk) => dddk.palette.toggle(),
  onLongPress: (dddk) => dddk.triggerVoiceStart(),
});
// later: off();
```

Combine with `fab: false` so dddk doesn't render a second floating button.

### 3. Swipe gesture — top + bottom chrome

Rapid up-down finger wiggle (default ≥3 direction reversals within 700ms) slides in two semi-transparent chrome bars:

```
┌──────────────────────────────────────────┐
│ 🔍 Palette                            ✕ │  ← top bar
├──────────────────────────────────────────┤
│                                          │
│   (original page content — still         │
│    scrollable; tapping any element       │
│    triggers dwell-style                  │
│    instead of the element's own click)   │
│                                          │
├──────────────────────────────────────────┤
│              ●  (center button)          │  ← bottom bar
└──────────────────────────────────────────┘
```

Why this gesture: normal scroll only goes one direction at a time → no false positives. Doesn't collide with iOS back, Android nav, or pull-to-refresh.

**Center button** (replaces desktop Space):

| Gesture | Event |
| --- | --- |
| Single tap | `dddk:mobile-accept` |
| Double tap (< 350ms) | `dddk:mobile-reject` |
| Long press (> 200ms) | `dddk:mobile-voice-start` then `dddk:mobile-voice-end` on release |

Host listens to these `document` events and wires them to the same handlers it uses for the desktop Space gesture.

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `reversalsToTrigger` | `2` | Min direction reversals in the swipe window to trigger chrome. |
| `swipeWindowMs` | `900` | Time window (ms) the reversals must happen within. |
| `minSwipeDelta` | `18` | Min Y delta per reversal (px). Filters jitter. |
| `longPressMs` | `200` | Long-press threshold for voice. |
| `doubleTapMs` | `350` | Double-tap window. |
| `forceEnable` | `false` | Run on non-touch devices (for testing in DevTools). |
| `dwellOnTap` | `false` | When chrome is open, taps on page elements fire palette with the tapped element as context. |
| `fab` | `{}` | `MobileFABConfig \| false`. Customise or disable the default FAB. |

### FAB config (`MobileFABConfig`)

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Show the FAB. |
| `icon` | sparkle SVG | Emoji, raw HTML, or an `HTMLElement`. |
| `text` | — | Optional text next to the icon. |
| `ariaLabel` | `'Open command palette'` | ARIA label. |
| `position` | `'bottom-right'` | `'bottom-right' \| 'bottom-left' \| 'top-right' \| 'top-left'`. |
| `offset` | `{ x: 20, y: 24 }` | Pixel offset from the edges. |
| `size` | `56` | Diameter (or height for `pill`). |
| `shape` | `'circle'` | `'circle' \| 'square' \| 'pill'`. |
| `style` | — | Inline CSS overrides, applied LAST. |
| `className` | — | Extra className for host CSS targeting. |
| `onTap` | open palette | `(dddk) => void`. |
| `onLongPress` | voice start | `(dddk) => void \| null`. Pass `null` to disable. |

## Runtime API

```ts
mobile.show();              // slide in chrome bars
mobile.hide();              // slide out
mobile.toggle();            // toggle chrome
mobile.setDwellOnTap(true); // route page taps through Dwell while chrome is open
mobile.isDwellOnTap();      // boolean
mobile.setFabVisible(false); // hide / show the default FAB
mobile.getFabElement();     // the <button> if it's been mounted
mobile.destroy();           // remove FAB + chrome + listeners
```

## Viewport detection

The module reacts to live viewport changes via `matchMedia('(max-width: 768px)')`. Rotating the device or resizing the window across the breakpoint mounts / unmounts the FAB automatically. The swipe detector is only bound on real touch devices (`'ontouchstart' in window`) — mouse drag never mis-triggers it.

The FAB is hidden on wide desktop viewports via a CSS `@media` rule, even if `attachTo()` mounted it (this matters when a single host runs both desktop and mobile in one bundle).

## Tear-down

```ts
mobile.destroy();
```

Removes the FAB, both chrome bars, all event listeners, and the viewport media-query listener.

## Touch-gesture API on the orchestrator

On desktop, Space is wired to a complete gesture pipeline — accept event for script skills, intent emission for analytics, subtitle invoke. Touch devices don't have Space, so the SDK exposes the same pipeline through two public orchestrator methods you call from a FAB tap / custom button:

```ts
dddk.triggerAccept();   // same as a single-tap Space
dddk.triggerReject();   // same as a double-tap Space
```

Both fire:
- `gesture_accept` / `gesture_reject` event (script-skill runners wait on these),
- `subtitle.invokeAccept()` / `invokeReject()` (advances pause hints, accepts confirm dialogs, closes info bars),
- An `intent` event with `kind: 'agent_answered'` (so analytics records the gesture).

The recommended `MobileFABConfig.onTap` is the dual-mode pattern below — accept-when-something-needs-it, otherwise open the palette:

```ts
new MobileTrigger({
  fab: {
    onTap: (dddk) => {
      if (dddk.subtitle.isVisible()) {
        dddk.triggerAccept();   // mid-task continuation
      } else {
        dddk.palette.toggle();  // idle: open palette
      }
    },
  },
});
```

`triggerReject()` is symmetric — wire it to a "cancel" gesture (a double-tap on your own button, a hold-and-release, etc.).

Single-tap / double-tap routing on the subtitle bar itself is built in: on touch devices the bar listens for `pointerup` events and dispatches `dddk:bar-tap-accept` / `dddk:bar-tap-reject` DOM events, which the orchestrator picks up and routes through the same pipeline. No host wiring needed — script skills advance on a tap on the bar even without the FAB.

See also: [./voice.md](./voice.md) for the voice events the center button + FAB long-press fire into, [./overview.md](./overview.md) for the module index.
