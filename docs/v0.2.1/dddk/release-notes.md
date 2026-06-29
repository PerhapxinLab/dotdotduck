# v0.2.1 release notes

Patch release on top of v0.2.0. **No breaking changes.** Two themes:

1. **Inline diff UX for InlineAgent** — every default action now previews changes in a strikethrough-old / new panel with accept / reject / insert-below / copy + follow-up chat, instead of splicing immediately.
2. **Cursor lifecycle hardening** — the synthetic cursor now anchors to its target via RAF, hides cleanly on every terminal event, and resets state between runs.

Plus a handful of bug fixes around the planner's `finish` semantics and the command palette's keyboard navigation.

## TL;DR

- **InlineAgent default `displayAs: 'inline-diff'`** — every built-in action (improve / fix / shorter / longer / tone / translate) now shows a diff preview the user accepts or rejects, instead of immediately replacing the selection. Host opts out per-action with `displayAs: 'replace'` or globally with `InlineAgentConfig.defaultDisplayAs`.
- **New UI primitives** under `@perhapxin/dddk/ui` — `mountProcessingLine`, `mountInlineDiff`, `InlineChatSession`. Hosts not using InlineAgent (e.g. a Tiptap editor) can drive these directly.
- **Streaming into the diff panel** — `applyStreamChunk(text)` + `streamStart()` + `streamDone()` on the diff handle. Token-by-token text streams in with a blinking cursor cue; accept/reject buttons disable during stream.
- **Follow-up chat session** — `InlineChatSession` keeps prior prompts visible above the diff (auto-collapses past 3 turns into a "▼ Show N earlier edits" toggle). Each rewrite is grounded in the ORIGINAL text, not the previous output, so iteration never drifts.
- **`onCancel` on `mountInlineDiff`** — fires the instant the user clicks Reject / hits Escape / `dispose()` so callers can abort an in-flight stream BEFORE the result promise settles.
- **Cursor anchored to its target** — `position: fixed` cursor used to take one rect snapshot per move; now a RAF loop tracks the target element every frame, so page scrolls / layout shifts keep the cursor visually attached.
- **Cursor hides on every terminal event** — `final` / `error` / manual `stop` / `safeCleanup` / new run-start all clear the synthetic cursor + reset its position state so the next run enters fresh.
- **Planner `finish` semantics tightened** — `finish` now means "the run is over"; its description must NOT be a question. Informational tasks (introduce / explain / what / where / how) plan navigate-then-narrate-then-finish with no `ask` follow-up.
- **Palette arrow-key scroll preserves row title** — rows with expanded inline detail no longer get their title clipped above the fold during keyboard navigation.

## What changed

### InlineAgent inline-diff mode (the headline)

Previously every action result was spliced straight back into the selection — fast, but no preview. v0.2.1 flips the default: every built-in action shows the result in a diff panel anchored below the selection, with the original struck through and the new text added underneath. Buttons: Accept / Reject / Insert below / Copy / open follow-up chat. The selection only changes when the user accepts.

Default-on for all built-in actions. Hosts can opt back to the old behaviour:

```ts
// Per-action override
{ id: 'improve', label: 'Improve', displayAs: 'replace', ... }

// Global override (every action that doesn't specify its own displayAs)
new InlineAgent({ ..., defaultDisplayAs: 'replace' });
```

### New UI primitives (consumable without InlineAgent)

```ts
import {
  mountProcessingLine,
  mountInlineDiff,
  InlineChatSession,
} from '@perhapxin/dddk/ui';
```

- **`mountProcessingLine(opts)`** — anchors a "Processing…" line under the editing rect while the LLM is thinking. Replaceable / disposable handle.
- **`mountInlineDiff(originalText, newText, opts)`** — full diff preview panel with action buttons + follow-up composer. Returns a handle with `applyStreamChunk` / `streamStart` / `streamDone` / `pushHistoryTurn` / `dispose`.
- **`InlineChatSession`** — keeps the prior turns and the original text in scope. Each follow-up `send()` calls the host transport with `{ original, history, prompt }` so the LLM stays grounded.

Hosts driving their own editor surface (Tiptap, plain `<textarea>`, custom contenteditable) consume these directly without going through InlineAgent.

### Streaming + chat history strip

The diff panel supports per-chunk text streaming with a blinking cursor cue:

```ts
const panel = mountInlineDiff(original, '', { ... });
panel.streamStart();
for await (const chunk of llmStream) panel.applyStreamChunk(chunk);
panel.streamDone();
```

While `streamStart()` to `streamDone()` is in flight, the accept / reject buttons disable so the user can't act on a half-streamed result.

Follow-up prompts via `pushHistoryTurn(prompt)` show as chips above the diff. Past 3 turns the chip strip auto-collapses into a `▼ Show N earlier edits` toggle so long iteration sessions don't grow the panel out of the viewport.

### onCancel hook

```ts
mountInlineDiff(original, '', {
  onCancel: () => abortStreamingController.abort(),
  // ...
});
```

Fires the instant the user clicks Reject, hits Escape, or the caller calls `panel.dispose()`. Lets the host kill an in-flight LLM stream BEFORE waiting for the result promise to settle. Without this, a clicked-Reject still had a few seconds of useless tokens flowing.

### Cursor anchored to its target (RAF tracking)

The synthetic cursor (`cursorTrail: true`) was `position: fixed` with a one-time rect snapshot per move call. Page scrolls / layout shifts AFTER the move left the cursor visually orphaned — pointing at whatever happened to be at that viewport pixel.

Now: after the initial glide animation lands, `setCursorAnchor(targetEl)` starts a `requestAnimationFrame` loop that re-reads `targetEl.getBoundingClientRect()` every frame and updates the cursor's transform. The cursor follows the element through scroll / resize / layout shift in real time. Released on `hideCursor` / `destroyCursor` / next move call / element disconnect from DOM.

Also dropped the "big element → top-left inset" heuristic from v0.2.0 — that was patching over the wrong layer (the model sometimes picks an entire `<section>` as the narrate `about` target, which is a model-selection problem, not something for the cursor positioning to second-guess). Back to plain rect center.

### Cursor hides on every terminal event

`hideCursor` existed in v0.2.0 but was never called anywhere. The synthetic cursor stuck on screen indefinitely after a run ended. Now wired into:

- `runAgent` start (clears any leftover cursor from prior run)
- `final` event handler (clean loop end)
- `error` event handler (failure path)
- `safeCleanup` (catch-all stream-exit)
- `agentStop` (manual stop / voice / palette / esc / double-tap)

Plus `hideCursor` now resets `lastX / lastY` to the "first use" sentinel, so the next run's entrance glide enters from off-screen-left, not from wherever the previous run finished.

### Planner: finish is terminal, ask is rare

The planner was generating `finish` todos whose description was framed as a question ("確認你是否要..."), and the loop materialised that as a narrate ending with a follow-up question — even when the user just asked for an introduction.

Tightened intent semantics in the planner prompt:

- **`ask`**: pause for user input. ONLY when the next agent step literally cannot proceed without a user choice. Not a friendly follow-up.
- **`finish`**: signals the run is over. Description states what was delivered, never a question.
- **Information-request shortcut**: if the user's task is informational (introduce / explain / tell / show / what / where / how), the plan is `navigate-then-narrate-then-finish`. No `ask` to qualify needs the user did not bring up.

Mirrored in the WebAgent loop's appendSystemPrompt so the model writing the actual narrates respects the same rule: cover the ask once, `is_final: true` the same turn, no follow-up question in the narrate text.

### Palette: keep active row's title visible on tall rows

Rows with expanded inline detail (orders / cart / etc.) can exceed the list viewport. The original `scrollIntoView({block: 'nearest'})` aligned the row's bottom, clipping the title off the top during arrow-key navigation.

Replaced with manual `scrollTop` computation that prioritises keeping the row's TOP visible. RAF-delayed so async detail layout has time to settle before the rect read.

## Migration

No code changes required. Drop-in replacement for v0.2.0.

If you want to opt OUT of the new inline-diff preview behaviour and restore v0.2.0's instant-splice:

```ts
new InlineAgent({ ..., defaultDisplayAs: 'replace' });
```

Or per-action:

```ts
{ id: 'translate', label: 'Translate', displayAs: 'replace', ... }
```
