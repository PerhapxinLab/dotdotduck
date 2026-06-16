# Placements — canonical screen slots

> Every transient UI piece (subtitle bar, indicator chip, palette, dock, modal, banner, FAB, toast) shares one stylesheet. `Placements` centralises the slots so host-supplied UI uses the same coordinate system as the SDK.

## Why

Previously subtitle / mobile-trigger / proactive renderer / palette each wrote their own `position: fixed; bottom: 24px; left: 50%; …` — the same idea scattered across six or seven files. Every tweak drifted. A single stylesheet that owns slots and z-index means you change one place to retune.

## 8 slots

| Slot | Position | z-index | Use for |
| --- | --- | --- | --- |
| `subtitle` | Bottom-centre horizontal bar | 9500 | Main subtitles, agent prose, proactive prompts |
| `indicator` | Small chip above the subtitle | 9510 | Voice listening / processing chips |
| `palette` | Upper-centre modal-like input | 9600 | CommandPalette / PanelRuntime |
| `dock` | Right-edge full-height column | 9400 | Persistent side panel (chat history, inspector) |
| `modal` | Fullscreen centred + backdrop | 9700 | Full-attention dialog, forms |
| `banner` | Full-width pinned to top | 9300 | System messages, version notices |
| `fab` | Bottom-right floating action button | 9200 | Mobile primary trigger |
| `toast` | Top-centre transient notification | 9800 | Brief success / error messages |

z-index ladder (low → high): `fab(9200) < banner(9300) < dock(9400) < subtitle(9500) < indicator(9510) < palette(9600) < modal(9700) < toast(9800)`.

## API

```ts
import {
  Placements,
  applyPlacement,
  clearPlacement,
  ensurePlacementStyles,
  PLACEMENT_ATTR,
} from '@perhapxin/dddk';
import type { PlacementSlot, PlacementHandle } from '@perhapxin/dddk';

type PlacementSlot =
  | 'subtitle' | 'indicator' | 'palette' | 'dock'
  | 'modal'    | 'banner'    | 'fab'     | 'toast';
```

### Low-level: `applyPlacement(el, slot)`

Tag an element with the slot attribute (`data-dddk-slot="<slot>"`). The host appends it to the DOM; positioning is owned by the dddk stylesheet.

```ts
const el = document.createElement('div');
el.textContent = 'Upload complete';
document.body.appendChild(el);
applyPlacement(el, 'toast');     // appears in the top-centre toast slot
// 3 seconds later
setTimeout(() => clearPlacement(el), 3000);
```

`ensurePlacementStyles()` is called automatically on the first `applyPlacement`; it injects the stylesheet once (idempotent).

### High-level: `Placements.mount(slot, content)`

Skip the element-lifecycle boilerplate with this helper:

```ts
const placements = new Placements();

const handle: PlacementHandle = placements.mount('subtitle', `<div>Thinking…</div>`);
// ...later
handle.update(`<div>Found 3 results</div>`);
handle.unmount();
```

`mount` accepts a string (becomes `innerHTML`) or an `HTMLElement` (appended). The returned handle exposes `update(html)` and `unmount()` so writing tiny widgets stays compact.

## Picking a slot

| Situation | Use | Why |
| --- | --- | --- |
| One-sentence "done" | `subtitle` | Non-blocking, dismissable, paired with voice |
| "Recording" indicator | `indicator` | Lives next to the subtitle without competing for content |
| `/command` input panel | `palette` | Already used internally by dddk |
| Customer chat window, code inspector | `dock` | Persistent — user closes it when ready |
| "Fill this form to continue" | `modal` | Full-attention; must be handled |
| "v2.0 just shipped" | `banner` | Full-width + prominent, doesn't block interaction |
| Mobile ⌘K equivalent | `fab` | Replaces a desktop keyboard shortcut |
| "Copied", "Saved" | `toast` | Brief, no user response needed |

Decision tree:
1. Does the user need to respond? Yes → `modal`. No → 2.
2. Should it stay until dismissed? Yes → `dock` / `banner` / `fab`. No → 3.
3. Is it a transient notification? Yes → `toast`. No → `subtitle` / `indicator`.

## Customising appearance

Every slot exposes CSS variables (position, width, z-index):

```css
:root {
  --dddk-bar-bottom: 32px;            /* subtitle distance from bottom */
  --dddk-bar-max-width: 880px;
  --dddk-palette-top: 8%;             /* palette distance from top */
  --dddk-palette-max-width: 720px;
  --dddk-dock-width: 420px;
  --dddk-modal-backdrop: rgba(15, 23, 42, 0.6);
  --dddk-fab-right: 24px;
  --dddk-fab-bottom: 32px;
  --dddk-toast-top: 32px;
}
```

z-index values are also variables (`--dddk-z-bar`, `--dddk-z-palette`, …), so the host can rearrange the ladder without forking CSS.

## Relationship to SurfacePlacement

`SurfacePlacement` (the string accepted by `SkillTools.surface(...)` and `SurfaceSkill`) uses the same names as `PlacementSlot`, so they're interchangeable:

```ts
import type { SurfacePlacement, PlacementSlot } from '@perhapxin/dddk';

const slot: PlacementSlot = (surfacePlacement === 'center' ? 'modal' : surfacePlacement);
applyPlacement(myDialog, slot);
```

(`'center'` is a legacy alias for `'modal'`.)

## See also

- [renderer.md](./renderer.md) — pass the rendered Surface element to a slot via `applyPlacement`.
- [pieces-catalog.md](./pieces-catalog.md) — individual Pieces should never set `position: fixed` themselves; the placement layer owns positioning.
