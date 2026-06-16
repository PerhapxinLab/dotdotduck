# v0.1.2 release notes

Pure bug-fix release on top of v0.1.1. **No API changes, no breaking changes.** Drop-in upgrade.

## TL;DR

- Fixed the empty subtitle bar that lingered between agent turns after the user pressed Space to advance past the auto-pause hint.

## What changed

### Pause onAccept now shows the thinking pip, not an empty bar

**Symptom**: after the user pressed Space to advance past the streaming pause hint, the subtitle bar's text wiped but the bar stayed mounted (with just an × close button). For the entire 1-3s the next LLM turn took to start, the user stared at an empty box and assumed the agent had broken.

**Root cause**: the runtime called `subtitle.replaceStreamed('')` to clear the bar's text but kept the bar el in DOM with `data-dddk-bar-mode="streaming"`. That left `isStreaming()` returning `true`, which suppressed the orchestrator's `'thinking'` event handler from showing the indicator pip.

**Fix**: the post-accept handler now tears the bar down with `subtitle.hide()` and immediately surfaces the thinking pip via `subtitle.showIndicator('processing', ...)`. The next `text-delta` event creates a fresh streaming bar via `ensureStreamingBar`, which auto-clears the pip — visually continuous, no gap.

See [the commit](https://github.com/PerhapxinLab/dotdotduck/commit/a72c291) for the diff.

## Compatibility

Drop-in upgrade from v0.1.1. No config changes, no API renames, no envelope changes. Every v0.1.1 host keeps working unchanged.

## Install

```bash
pnpm add @perhapxin/dddk@0.1.2
# or: npm i @perhapxin/dddk@0.1.2
```
