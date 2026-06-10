# Triggers overview

A **trigger** is anything that turns a user gesture into a dddk intent — opening the palette, capturing a selection, holding for voice, pointing at a DOM element. Triggers are the entry points; everything else (skills, surfaces, the webagent) runs *because* a trigger fired.

There are four trigger surfaces in `@perhapxin/dddk`:

| Trigger          | Module               | Use for                                                                 |
| ---------------- | -------------------- | ----------------------------------------------------------------------- |
| Command palette  | `CommandPalette`     | Discoverable list of commands, prefix routing, attach images, AI fallback. |
| Space gestures   | `GestureManager`     | Single tap → accept · double tap → reject · hold → voice · Tab → next line · Ctrl+K → palette. |
| Spotter          | `Spotter`            | Explicit "pick a DOM element" flow — ring on hover, click to lock, drag to lasso a region. |
| Panel runtime    | `PanelRuntime`       | In-page side panel that hosts skills / surfaces / chat as long-lived UI. |

Most hosts only touch the palette directly. The rest are constructed for you inside `DotDotDuck` — you wire them through config (`gestureKey`, `camera`, `webAgent`, etc.) rather than `new`-ing them yourself.

```ts
import { DotDotDuck } from '@perhapxin/dddk';

const dddk = new DotDotDuck({
  // palette items, skills, camera, tools, ...
});
dddk.mount();

// Direct access if you need it:
dddk.palette.addItem({ ... });
dddk.spotter.start();   // opt-in: ring + lasso are off by default
```

---

## What each doc covers

- [palette](./palette.md) — registering palette items: prefix routing, sub-menus, `searchOnly`, browse mode, the agent-tool opt-in.
- [palette-actions](./palette-actions.md) — the typed `PaletteAction` union (`copy`, `insert`, `navigate`, `open_url`, `agent_task`, `render_surface`, `run_skill`, `custom`) + `runAction()`.
- [palette-attachments](./palette-attachments.md) — the camera icon (upload / screenshot), `PaletteAttachment`, how images flow into `palette.context.attachments` and through to the agent as `selection.images`.
- [gestures](./gestures.md) — single / double / long-hold space, Ctrl+K, Tab, escape; `holdThresholdMs` and `shouldIntercept`.
- [spotter](./spotter.md) — ring / lock / lasso modes for explicit element pick; when to use Spotter vs. [Dwell](../modules/dwell.md).

---

## How they relate

```
                ┌──────────────────────────────────────────┐
                │              DotDotDuck (host)           │
                │  palette · spotter · gestures · skills   │
                └──────────────────────────────────────────┘
                       ▲              ▲              ▲
                       │              │              │
   user types          │              │              │  user holds
   ⌘K + a query        │              │              │  space ≥200ms
                       │              │              │
              ┌────────┴───┐   ┌──────┴────┐   ┌─────┴──────┐
              │   palette  │   │  spotter  │   │  gestures  │
              │   row /    │   │  ring /   │   │  accept /  │
              │   action   │   │  lasso    │   │  voice /   │
              └────────────┘   └───────────┘   └────────────┘
                       │              │              │
                       └──────────────┴──────────────┘
                                      ▼
                               intent / agent task
```

The palette is the **explicit** trigger (the user typed something). Gestures are **ambient** triggers (the user reacted to something dddk showed). Spotter is **deictic** — the user is pointing at part of the page and the agent needs to know which.

All three feed the same downstream pipeline: a `PaletteAction`, a skill dispatch, or a `webagent` task. See [palette actions](./palette-actions.md) for the discriminated union that bridges palette UI into the rest of the system.

---

## Picking the right trigger

- The user knows *what* they want — palette + a registered item. Predictable, fastest path.
- The user wants to *ask in their own words* — palette + a `fallback` row that routes to the agent.
- The user is reacting to a subtitle / prompt dddk just showed — space gestures (no UI to click).
- The user needs to *show* the agent something on the page — Spotter (explicit pick) or [Dwell](../modules/dwell.md) (long-press the element itself).
- The user wants to attach an image — palette's camera button (see [attachments](./palette-attachments.md)).

Don't reinvent triggers; the ones above cover ~all known interaction needs. If you find yourself adding a global keybinding, first ask whether it should be a palette item with a `shortcut` hint instead — palette items are discoverable, keybindings aren't.

---

## What's exported

Only what's on `@perhapxin/dddk` is public. Check `src/index.ts` if you're unsure — the trigger-related exports are:

```ts
import {
  // palette
  CommandPalette, listPrefixMatches, displayPrefix,
  // gestures
  GestureManager,
  // spotter
  Spotter,
  // panel runtime
  PanelRuntime,
  // typed actions
  runAction, defaultIconFor,
} from '@perhapxin/dddk';

import type {
  PaletteItem, PaletteHandle, PaletteContext, PaletteAttachment,
  CameraOptions, CommandPaletteOptions,
  GestureCallbacks, GestureManagerOptions,
  SpotterOptions, SpotterState,
  PaletteAction, CopyAction, InsertAction, OpenUrlAction,
  NavigateAction, AgentTaskAction, RenderSurfaceAction,
  RunSkillAction, CustomAction, ActionRunContext,
} from '@perhapxin/dddk';
```
