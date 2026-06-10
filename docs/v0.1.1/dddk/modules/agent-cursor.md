# AgentCursor — visible cursor + pre-click pause

> A large floating cursor that travels to whichever element the webagent is about to click / type / scroll. Pauses briefly on arrival so the user sees what's about to happen and has time to cancel.

Opt-in. Disabled by default; attach an `AgentCursor` instance to turn it on.

## When to use

- Demo / onboarding flows where users need to **see** the agent's intent
- Sensitive flows (deletes, purchases, irreversible writes) where a visible pre-action pause is a soft safety net
- Screen-recording dddk-driven walkthroughs — the cursor + flash overlay reads on video

Don't use when:

- The agent is doing pure background work (data fetch, classification, summary generation) — there's nothing to point at
- You need a hard confirmation gate, not just a visual cue — use the subtitle's `onAccept` / `onReject` flow instead
- The user's already watching a live screen-share — they see a real cursor; doubling up is noisy

## Import

```ts
import { AgentCursor } from '@perhapxin/dddk';
import type { AgentCursorConfig } from '@perhapxin/dddk';
```

## Minimum setup

```ts
import { AgentCursor } from '@perhapxin/dddk';

const cursor = new AgentCursor({
  preClickPauseMs: 250, // pause before each action fires
  size: 32,
  travelMs: 350,
});
cursor.attachTo(dddk);
```

That's the whole API surface for normal use. The module subscribes to the agent's `before_action`, `step`, `done`, and `error` events automatically and rewires on every `agent_start` so a fresh agent session is picked up without re-attaching.

## How it works

This is purely a visualization layer — it does NOT drive actions. The flow:

1. Webagent emits `before_action` with `{ actionName, params, targetSelector? }`
2. AgentCursor queries the selector, computes its centre, and animates the cursor there over `travelMs`
3. The target element gets a `[data-dddk-agent-target]` attribute briefly (default 600ms) so host CSS can flash it
4. AgentCursor awaits `preClickPauseMs` before letting `before_action` resolve
5. Webagent runs the action; AgentCursor pulses a "click ring" on the cursor
6. On `done` / `error`, the cursor fades out

Actions without a DOM target (`wait`, `done`, etc.) leave the cursor where it is.

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `preClickPauseMs` | `250` | Pause between cursor arriving on target and the action firing. |
| `size` | `32` | Cursor size in px. |
| `color` | `var(--dddk-accent, #ec4899)` | Tint of the cursor stroke. |
| `travelMs` | `350` | Travel duration between targets. |
| `enabled` | `true` | Start enabled. Toggle later with `setEnabled()`. |

## Runtime API

```ts
cursor.setEnabled(false); // hide + skip pre-click pause
cursor.setEnabled(true);
cursor.destroy();         // unmount listeners + DOM node
```

When disabled, `before_action` returns immediately and the cursor stays hidden. Re-enabling resumes on the next action.

## Target flash CSS

The brief outline on the target element is host-stylable:

```css
[data-dddk-agent-target] {
  outline: 2px dashed var(--dddk-accent, #ec4899);
  outline-offset: 2px;
  transition: outline-color 0.2s;
}
```

Override per-element by writing your own rule that wins (higher specificity or layer).

## Interaction with other modules

- **[Dwell](./dwell.md)** — independent. The cursor moves over a pinned element if the agent acts on it; the dwell frame still owns "this is the user's current selection" semantics.
- **[InlineAgent](./inline-agent.md)** — InlineAgent doesn't fire webagent actions, so the cursor never moves for inline edits. Use the subtitle's `processing` indicator instead.
- **[MobileTrigger](./mobile-trigger.md)** — works, but the cursor concept is desktop-shaped. On touch, consider disabling AgentCursor and relying on the subtitle for narration.

## Edge case — back-to-back actions

If `before_action` fires twice before the first `preClickPauseMs` elapses, the previous pause is resolved immediately so the agent loop doesn't stall. The cursor jumps to the new target and starts a fresh pause.

## Tear-down

```ts
cursor.destroy();
```

Removes the cursor element and detaches every event listener wired to the current agent.

See also: [./subtitle.md](./subtitle.md) for narrating what the cursor is doing, [./overview.md](./overview.md) for the module index.
