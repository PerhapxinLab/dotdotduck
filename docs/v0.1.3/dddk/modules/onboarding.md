# OnboardingModule — auto-run a tour on first visit

> Wraps a regular `ScriptSkill` with a persisted "seen" flag, optional URL-based gating, and a palette command to re-run the tour. The first time a user lands on a matching page, the tour fires automatically; on subsequent visits it stays silent unless reset.

Opt-in. The module is just a thin lifecycle around a skill you've already defined — no DOM of its own.

## When to use

- A guided tour explaining where dddk's Ctrl+K, voice gesture, and dock live
- Per-feature first-run notices ("hey, you've enabled InlineAgent — here's what it does")
- New-version "what's changed" pop-ups gated to one URL

Don't use when:

- The tour needs to run **every** session (e.g. recurring training reminders) — use a normal palette command instead
- You need branching steps based on the user's account state — write a `PanelSkill` and run it conditionally yourself
- The "first-time" thing isn't a tour but a single toast — fire `dddk.subtitle.show()` from your bootstrap code

## Import

```ts
import { OnboardingModule } from '@perhapxin/dddk';
import type { OnboardingConfig } from '@perhapxin/dddk';
```

## Minimum setup

```ts
import { OnboardingModule, type ScriptSkill } from '@perhapxin/dddk';

// 1. Define the tour as a regular ScriptSkill
const tour: ScriptSkill = {
  id: 'first-time-tour',
  name: '快速導覽',
  kind: 'script',
  steps: [
    { kind: 'subtitle', text: '歡迎！按 Ctrl+K 隨時叫出指令面板。', autoHide: 4000 },
    { kind: 'subtitle', text: '長按空白鍵可以對 dddk 講話。', autoHide: 4000 },
    { kind: 'subtitle', text: '長按頁面上任何元素 → 它會被鎖定成下個操作的 context。', autoHide: 4000 },
  ],
};

// 2. Register it with your skill registry as usual
dddk.skills.register(tour);

// 3. Wrap it in OnboardingModule
const onboarding = new OnboardingModule({
  skill: tour,
  storage: localStorageAdapter,         // your StorageAdapter
  runOnPath: ['/', '/dashboard'],       // only auto-run on these paths
  startDelayMs: 800,                    // wait for host to finish rendering
});

// 4. After dddk.mount(), let it decide whether to run
dddk.mount();
onboarding.maybeRun((id) => dddk.skills.run(id));

// 5. Add palette commands so the user can re-watch
onboarding.registerOn(dddk.palette, (id) => dddk.skills.run(id));
```

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `skill` | — | The `ScriptSkill` to run. Required. |
| `storage` | — | `StorageAdapter` for the "seen" flag. Required. |
| `storageKey` | `dddk.onboarding.seen.<skill.id>` | Where the flag lives. |
| `runOnPath` | any page | `string \| RegExp \| Array<string \| RegExp>` — gate by `location.pathname`. |
| `startDelayMs` | `500` | Wait this long after `maybeRun()` before starting the skill. |

## Runtime API

```ts
onboarding.maybeRun(runSkill);  // auto-run if not seen + path matches
onboarding.markSeen();          // mark seen without running (e.g. after user manually completes)
onboarding.reset();              // forget the flag so the tour runs again next visit
onboarding.hasSeen();            // boolean
onboarding.paletteCommands(run); // returns PaletteItem[] for manual registration
onboarding.registerOn(palette, run); // shortcut: registers commands on a palette
```

The auto-registered palette command is `重看導覽` — calling it resets the seen flag and immediately re-runs the tour.

## URL gating

`runOnPath` accepts mixed strings and regexes:

```ts
new OnboardingModule({
  skill: tour,
  storage,
  runOnPath: [
    '/',
    /^\/projects\/[^/]+$/,    // any single project page
    /^\/onboarding/,           // every page under /onboarding
  ],
});
```

Strings match **exactly**; regexes use `.test()`. The check runs on every `maybeRun()` call, so route changes that re-call it will re-evaluate.

## Storage shape

```ts
interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}
```

Any KV that satisfies this works. The default key is namespaced by skill id so multiple onboarding modules don't collide. Override with `storageKey` if you need cross-version invalidation (e.g. `dddk.onboarding.seen.v2.tour`).

## Two ways to "complete"

The auto-run path calls `markSeen()` after the skill resolves — so a skill that throws does not mark seen, and the user gets another chance next visit. If your skill should mark seen even on partial completion (e.g. the user dismissed mid-tour), call `markSeen()` from inside the skill's step handlers.

## Tear-down

There's nothing to clean up — `OnboardingModule` holds no listeners or DOM. The palette commands stay registered until you call `palette.removeItem(id)` or destroy the palette.

See also: [../skills/how-to-add-a-skill.md](../skills/how-to-add-a-skill.md) for the underlying `ScriptSkill` shape, [./overview.md](./overview.md) for the module index.
