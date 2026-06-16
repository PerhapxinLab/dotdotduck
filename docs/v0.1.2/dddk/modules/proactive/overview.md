# Proactive

Tick-driven prompt engine. The host registers prompts ("site tour",
"voice-failure hint", "commercial-page dwell"), drives a tick on its
own clock, and proactive picks the highest-priority prompt whose
triggers all fire — subject to per-session fatigue caps.

## Quick start

```ts
import { createProactive, triggers } from '@perhapxin/dddk/modules/proactive';

const proactive = createProactive({
  analytics,                           // optional: emits proactive.shown / .response
  render: createSubtitleProactiveRender(dddk),
  isPaletteOpen: () => paletteOpen,
  whenPaletteOpen: 'suppress',
  fatigue: {
    maxPerSession: 2,
    cooldownMs: 30_000,
    consecutiveDismissCap: 1,
  },
});
await proactive.init();

proactive.register({
  id: 'commercial_dwell',
  priority: 10,
  triggers: [
    triggers.pageMatch({ path: '/commercial' }),
    triggers.dwell({ ms: 30_000 }),
  ],
  surface: {
    text: 'Done browsing? Want to see the integration docs?',
    yesLabel: 'See docs',
    noLabel: 'Not yet',
  },
  onResponse: (r) => { if (r === 'yes') goto('/docs'); },
});

// Drive it on your own clock — proactive does NOT auto-tick.
setInterval(() => {
  void proactive.tick({
    page: location.pathname,
    dwellMs: Date.now() - pageEnterAt,
    customMeta: { firstVisit: isFirstVisit },
  });
}, 5000);
```

## API

- `createProactive({ analytics, memory, storage, fatigue, keys, identity, render, whenPaletteOpen, isPaletteOpen })`
- `await proactive.init()` — open storage, load persisted variant stats
- `proactive.register(prompt)` / `proactive.unregister(id)`
- `await proactive.tick(ctx)` — evaluate triggers, fire one prompt, returns its id
- `await proactive.ask({ text, yesLabel, noLabel })` — bypass triggers, render a one-off prompt
- `proactive.pause()` / `proactive.resume()`
- `proactive.explain(id)` — last-shown / variant stats / fatigue counters for a prompt
- `await proactive.dispose()`

## Registering prompts

A `PromptDefinition` is just data:

| Field | Purpose |
|---|---|
| `id` | Unique key. Used for fatigue state + analytics. |
| `category` | Optional grouping (`onboarding`, `conversion`, …). Lets `dismissPenalty.sameCategory` cool down whole groups. |
| `priority` | Higher wins when multiple prompts are eligible in the same tick. Default 0. |
| `triggers` | Array of `Trigger`. See built-ins below. |
| `triggerLogic` | `'AND'` (default) or `'OR'`. |
| `surface` | What to show: `text`, `yesLabel`, `noLabel`, `placement`, `autoTimeoutMs`, `dismissable`. |
| `onResponse` | `(response, ctx) => void` — your side effect (navigate, run skill, etc). |
| `variants` | A/B variants. Each has its own `surface`. |
| `variantSelector` | `'thompson_sampling'` (default), `'epsilon_greedy'`, or `'random'`. |

`text` may be a string OR a `(ctx) => string` so you can interpolate
the current page / dwell into the copy.

## Built-in triggers

Import as `triggers` (also re-exported as `builtin.triggers`):

| Trigger | Fires when |
|---|---|
| `triggers.pageMatch({ path })` | `ctx.page` matches the string (`includes`) or `RegExp` |
| `triggers.dwell({ ms })` | `ctx.dwellMs >= ms` |
| `triggers.idleTime({ ms })` | Alias of `dwell` (intent-only) |
| `triggers.scrollDepth({ percent })` | `ctx.scrollDepth >= percent` |
| `triggers.exitIntent()` | `ctx.customMeta.exitIntent` is truthy |
| `triggers.schedule({ everyN })` | Every Nth tick |

Custom triggers are one-liners — any `{ id, condition: (ctx) => boolean | Promise<boolean> }`:

```ts
const firstVisit: Trigger = {
  id: 'first_visit',
  condition: (ctx) => Boolean(ctx.customMeta?.firstVisit),
};
```

## The tick loop

Proactive is passive — it evaluates only when the host calls
`tick(ctx)`. Your `ctx` is what fills `TriggerContext`:

```ts
proactive.tick({
  page: location.pathname,
  dwellMs: Date.now() - pageEnterAt,
  scrollDepth: pctScrolled(),
  customMeta: { firstVisit, abVariant: 'B' },
});
```

The engine then, per call:

1. Honors fatigue (session cap, cooldown, consecutive-dismiss cap).
2. Honors palette state (see below).
3. Evaluates every registered prompt's triggers.
4. Picks the highest-priority eligible prompt.
5. Calls your `render(prompt, surface)`, awaits a response.
6. Updates variant stats, persists to storage, fires `onResponse`.
7. Tracks `proactive.shown` / `proactive.response` if `analytics` is wired.

A 5-second interval is usually fine. Faster ticks don't help — the
cooldown gate caps how often anything actually shows.

## Fatigue

```ts
fatigue: {
  maxPerSession: 3,         // hard cap on total shows per page session
  cooldownMs: 60_000,       // minimum gap between any two shows
  consecutiveDismissCap: 3, // stop after this many dismisses in a row
  dismissPenalty: {
    sameId: 'session',      // dismissed prompt won't re-fire this session
    sameCategory: 300_000,  // cool down whole category for 5min
  },
}
```

The dismiss counter resets to 0 on any `'yes'` or `'no'` answer.

## The `render` contract

`render` is the only piece you have to wire to UI — proactive doesn't
ship a default surface. Signature:

```ts
type RenderFn = (
  prompt: PromptDefinition,
  surface: PromptSurface,
) => Promise<'yes' | 'no' | 'dismiss'>;
```

Resolve `'yes'` / `'no'` for an explicit user choice, `'dismiss'` for
"user ignored / closed / timed out" (which counts toward the
consecutive-dismiss cap).

The dddk-frontend reference renders into the subtitle bar so prompts
share the same center-bottom surface as voice / agent / selection
output:

```ts
import type { DotDotDuck } from '@perhapxin/dddk';
import type { PromptDefinition, PromptSurface } from '@perhapxin/dddk/modules/proactive';

export function createSubtitleProactiveRender(dddk: DotDotDuck) {
  return (_prompt: PromptDefinition, surface: PromptSurface) =>
    new Promise<'yes' | 'no' | 'dismiss'>((resolve) => {
      const text = typeof surface.text === 'function'
        ? surface.text({ now: Date.now() })
        : surface.text;
      dddk.subtitle.show({
        text: `${text}  ·  ${surface.yesLabel ?? 'Yes'} / ${surface.noLabel ?? 'No'}`,
        type: 'agent',
        onAccept: () => { dddk.subtitle.hide(); resolve('yes'); },
        onReject: () => { dddk.subtitle.hide(); resolve('no'); },
        onCancel: () => { dddk.subtitle.hide(); resolve('dismiss'); },
        autoHide: surface.autoTimeoutMs,
      });
    });
}
```

For a generic adapter that targets dddk's PieceSurface system, use
the bundled `createPieceRender({ mount, locale })` helper.

## Palette coordination

If the user already has the palette open, you usually don't want a
proactive prompt fighting for attention. Wire `isPaletteOpen` and
`whenPaletteOpen`:

| Mode | Behavior |
|---|---|
| `'suppress'` (default) | Skip the tick entirely while palette is open |
| `'subtitle_only'` | Only fire prompts that the renderer can route to subtitle bar; non-Space input is treated as "didn't see it" |
| `'blur_palette'` | Render anyway; the host renderer is responsible for blurring the palette behind |

dddk exposes `isPaletteOpen()` and (via PanelSkill) `isPanelOpen()`
— combine them so a Panel doesn't get interrupted either:

```ts
isPaletteOpen: () => paletteOpen || dddk.isPanelOpen?.() === true,
```

## A/B variants

Provide `variants: [{ id, surface }, ...]` and the engine picks one
per fire using Thompson sampling over per-variant yes/no stats
(stored in IndexedDB across reloads). Use `'epsilon_greedy'` for a
cheaper bandit, `'random'` for uniform sampling, or omit `variants`
to disable.

`proactive.explain(id)` returns the live variant stats — useful for
a debug panel.

## Through the webagent

Proactive is NOT exposed as an LLM tool. Prompts are designed to
fire from host-known signals (page, dwell, custom flags) — the LLM
doesn't need a "show prompt" tool, it can just `dddk.subtitle.show()`
directly when it has something to say.

See [analytics](../analytics/overview.md) for the events proactive emits.
