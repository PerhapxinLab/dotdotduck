# Modules — overview

> Status: 優化中 / Tuning. APIs are stable; defaults and ergonomics are still settling as real apps stress-test them. Expect copy and default values to shift more than function signatures.

A dddk **module** is an opt-in, attachable bundle that adds one feature to a `DotDotDuck` instance without touching the orchestrator. Each follows the same shape:

```ts
import { SomeModule } from '@perhapxin/dddk';

const m = new SomeModule({ /* config */ });
m.attachTo(dddk);

// runtime toggles, mostly:
m.setEnabled(false);
m.destroy();
```

This pattern (rather than a giant `new DotDotDuck({ inline: true, dwell: true, ... })` config) is deliberate:

- **Independently toggleable.** Hosts ship only the modules they actually use; the rest is tree-shaken.
- **Self-owned lifecycle.** Each module wires its own listeners, mounts its own DOM, and tears itself down. The orchestrator doesn't have to know.
- **Replaceable per surface.** A host that wants its own InlineAgent UI can write a sibling module against the same `DotDotDuck` API surface, and the rest of dddk doesn't notice.

Modules are **different from** [triggers](../triggers/overview.md) (palette, Spotter, gestures — always present, always wired by the orchestrator) and [skills](../skills/overview.md) (host-defined tasks the agent runs). Modules sit between: built-in features that hosts pick from a menu.

## Naming convention: imports vs. displays

Module names appear in two forms depending on context:

- **Class names** (what you `import`): PascalCase — `ImmersiveTranslate`, `VoiceModule`, `InlineAgent`, `Dwell`.
- **Palette commands / docs filenames**: kebab-case — `/immersive-translate`, `voice`, `dwell`, `inline-agent`.

When you read "the dwell module" in prose, it refers to the same thing as `new Dwell(...)` and `/dwell` — just three views of the same feature. The "Class" column in the table below is the canonical import name; everything else is a presentation alias.

## The current modules

| File | Class | One-liner |
| --- | --- | --- |
| [voice](./voice.md) | `VoiceModule` | Hold-space STT, optional TTS, voice-cleanup LLM pass. |
| [subtitle](./subtitle.md) | `Subtitle` | The bottom-of-screen prompt bar — agent narration, voice status, accept / reject. |
| [dwell](./dwell.md) | `Dwell` | Long-press to pin a DOM element as the next interaction's context. |
| [inline-agent](./inline-agent.md) | `InlineAgent` | Floating selection menu inside `<input>` / `<textarea>` / contenteditable. |
| [immersive-translate](./immersive-translate.md) | `ImmersiveTranslate` | Page-wide bilingual rendering. |
| [agent-cursor](./agent-cursor.md) | `AgentCursor` | Big visible cursor + pre-click pause while the agent is acting. |
| [mobile-trigger](./mobile-trigger.md) | `MobileTrigger` | FAB + swipe-in chrome bars for touch devices. |
| [form-assist](./form-assist.md) | `FormAssistModule` | Inline "AI fill" button on each detected `<form>`. |
| [onboarding](./onboarding.md) | `OnboardingModule` | First-visit `ScriptSkill` runner with persisted "seen" flag. |
| [theme-language](./theme-language.md) | `ThemeToggleModule` + `LanguageSwitcherModule` | Two tiny utility modules grouped together — palette commands for theme and locale. |

## Cross-tab session sync

Not a module — a `DotDotDuck` config flag. Listed here because it's a feature toggle and historically lived in this doc:

```ts
new DotDotDuck({
  llm,
  webAgent: { crossTabSync: true },   // default false
});
```

When `true`, the agent session is mirrored to `localStorage` and broadcast on a `BroadcastChannel`. A new tab on the same origin picks up where the previous one left off. Same-origin only — see [agent / session-continuity](../agent/session-continuity.md).

## Tear-down

When your app unmounts (page leave, host SPA route change) — always:

```ts
dotdotduck.destroy();
// + any modules you instantiated:
voice.destroy();
dwell.destroy();
inline.destroy();
immersive.disable();          // strips injected translations
agentCursor.destroy();
mobile.destroy();
```

Calling `mount()` again afterward without `destroy` will double-bind listeners.
