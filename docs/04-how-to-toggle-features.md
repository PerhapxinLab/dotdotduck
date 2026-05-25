# How to toggle features on / off

Every dotdotduck feature is opt-in or runtime-toggleable. Below is the full list of toggles and how to flip each one.

---

## Voice input (hold-space STT)

**Default**: on if you wire up a `VoiceModule`.

```ts
import { VoiceModule } from '@perhapxin/dddk';

const voice = new VoiceModule({ llm: yourLLM });

const dotdotduck = new DotDotDuck({
  llm: yourLLM,
  voice: { enabled: true },   // default true
});

dotdotduck.on('voice_start', () => {
  voice.captureOnce(dotdotduck.subtitle).then((text) => {
    if (text) dotdotduck.startAgent(text);
  });
});

dotdotduck.mount();
```

**Toggle at runtime**:

```ts
dotdotduck.setVoiceEnabled(false);
dotdotduck.isVoiceEnabled(); // boolean
```

When disabled, holding space does nothing — single-tap and double-tap (accept / reject for agent prompts) still work.

---

## Subtitle (the floating prompt bar)

The subtitle bar is the dark bottom-of-screen prompt that shows agent messages, voice status, skill steps.

**Show / hide programmatically**:

```ts
dotdotduck.subtitle.show({
  text: 'Working on it...',
  type: 'agent',           // 'agent' | 'info' | 'selection'
  autoHide: 2000,          // ms, or omit for sticky
  hints: 'space to accept · esc to cancel',
  onAccept: () => { /* … */ },
  onReject: () => { /* … */ },
  onCancel: () => { /* … */ },
});

dotdotduck.subtitle.hide();
```

**Show a non-text indicator** (small badge in the corner of the bar):

```ts
dotdotduck.subtitle.showIndicator('processing', 'Translating…');
dotdotduck.subtitle.hideIndicator();
```

**Suppress all agent-driven subtitle output**:

The subtitle bar is driven by webagent events. If you want to mute it for a session without disabling the agent itself:

```ts
const original = dotdotduck.subtitle.show.bind(dotdotduck.subtitle);
dotdotduck.subtitle.show = () => {}; // muted
// restore: dotdotduck.subtitle.show = original;
```

For a permanent skin, override the subtitle CSS tokens (see [11-theming](./11-theming.md)) — `--dddk-bar-*`.

---

## Dwell (long-press to pin a DOM element)

**Opt-in**. Long-press any element for `dwellMs` (default 700ms) — a frame snaps onto it. The frame stays until the user dismisses (Esc, click outside, or popover close). Mouse movement alone never clears it.

The pinned element becomes the *next* interaction's context: Ctrl+K opens the palette with that element in the chip-bar, long-press space sends voice + the element together to the webagent.

### Minimum setup — pure selection gesture

```ts
import { Dwell } from '@perhapxin/dddk';

let pinned: HTMLElement | null = null;

const dwell = new Dwell({
  // `llm` is optional — only needed when `annotateOnSelect: true`.
  dwellMs: 1000,
  annotateOnSelect: false,       // default — no LLM popover, just pin
  onSelect: (el, selector) => {
    pinned = el;
    // Hand the element's visible text to the next palette open as context.
    const text = (el.innerText ?? el.textContent ?? '').trim().slice(0, 240);
    dddk.palette.setPinnedContext(text, selector);
  },
  onClear: () => {
    pinned = null;
    dddk.palette.clearPinnedContext();
  },
});
dwell.attachTo(dddk);
```

### With LLM annotation popover

Set `annotateOnSelect: true` to recreate the old "long-press → annotate" UX. Requires `llm`.

```ts
new Dwell({
  llm: yourLLM,
  dwellMs: 700,
  annotateOnSelect: true,
});
```

### Runtime queries / toggles

```ts
dwell.markedElement();             // currently-pinned element, or null
dwell.setEnabled(false);           // detach without unmount
dwell.isEnabled();                 // boolean
```

### Opt-out selector list

`data-no-dwell` always wins. Add more via `ignoreSelector`:

```ts
new Dwell({
  ignoreSelector: '.acme-hold-to-confirm, [data-no-dwell]',
});
```

### Require a modifier

```ts
new Dwell({ triggerModifier: 'alt' });  // Alt+long-press only
```

### Voice + pinned context

Once Dwell has pinned an element, your voice handler should prepend the element's visible text to the prompt before calling `dddk.startAgent`:

```ts
dddk.on('voice_start', () => {
  voice.captureOnce(dddk.subtitle).then((text) => {
    if (!text) return;
    if (pinned) {
      const ctx = (pinned.innerText ?? '').trim().slice(0, 600);
      dddk.startAgent(
        `User is asking about this on-page region:\n"""\n${ctx}\n"""\n\nQuestion: ${text}`
      );
    } else {
      dddk.startAgent(text);
    }
  });
});
```

Theming the frame: see `--dddk-dwell-frame-*` CSS variables in [11-theming](./11-theming.md).

---

## Inline AI (selection inside an editable)

**Opt-in**. Attach `InlineAgent` and any text-selection inside an `<input>`, `<textarea>`, or `[contenteditable]` triggers a floating menu anchored to the right of the selection.

```ts
import { InlineAgent } from '@perhapxin/dddk';

const inline = new InlineAgent({
  llm,
  locale: 'zh-TW',                          // built-in i18n: en / zh-TW
});
inline.attachTo(dotdotduck);
```

### Built-in actions (default 7)

| Action | English label | 中文 label |
| --- | --- | --- |
| `translate` | Translate | 翻譯 |
| `improve`   | Improve writing | 改寫 |
| `fix`       | Fix spelling & grammar | 修文法 |
| `shorter`   | Make shorter | 縮短 |
| `longer`    | Make longer | 延長 |
| `tone`      | Change to professional tone | 改成正式語氣 |
| `explain`   | Explain this | 解釋 |

**Translate sub-menu** — clicking Translate opens a language picker. Override the choices via `translateTargets`:

```ts
new InlineAgent({
  llm,
  translateTargets: [
    { code: 'en',    label: 'English' },
    { code: 'zh-TW', label: '繁體中文' },
    { code: 'ja',    label: '日本語' },
  ],
});
```

### How an action's output is computed

InlineAgent does NOT just send the selected fragment to the LLM. It builds a *context window* (~400 chars before + after the selection) and marks the fragment with `[[SEL]]` / `[[/SEL]]`. The LLM is forced to reply with a JSON object — only the `replacement` field is applied:

```
System: …strict edit-file instructions…
User:   Instruction: Translate to Japanese.

        Context (with selection marked):
        """
        她…[[SEL]]今天去買菜[[/SEL]]，然後…
        """

        Return JSON: { "replacement": "..." }
```

The host calls the LLM with `thinking: 'off'`, `jsonMode: true`, `temperature: 0` (see [03-llm-providers](./03-llm-providers.md) — these flags suppress chain-of-thought on models that have it). The replacement string is spliced into the textarea at the known offsets — no fuzzy matching, no leaked transcript.

### Runtime API

```ts
inline.addAction({ id: 'my-action', label: '…', icon: '…', instruction: '…' });
inline.removeAction('translate');         // drop a default action
inline.updateAction('improve', { instruction: 'New prompt…' });
inline.setActions([...]);                  // wholesale replace
inline.setEnabled(false);                  // detach without unmount
```

### Dynamic instructions (pick before run)

An action's `build()` runs at activation time. Use it to ask the user for more info before the LLM call. The built-in Translate action uses this for its language picker; any custom flow works:

```ts
{
  id: 'translate-custom',
  label: 'Translate to…',
  icon: '文',
  build: async ({ text, agent }) => {
    const target = await myPicker();          // your own UI / modal / palette
    if (!target) return null;                  // null = cancel cleanly
    return `Translate to ${target}. Output only the translation.`;
  },
}
```

### Keyboard

- `ArrowDown` / `ArrowUp` (or `Ctrl+N` / `Ctrl+P`) — navigate
- `Mod+Enter` (Cmd / Ctrl / Alt + Enter) — fire the highlighted action.
  Plain Enter is preserved so users can still add a newline in the editable.
- `Esc` — close the menu

### Persistence

The menu stays open as long as the selection is alive. Scroll *repositions* it (no longer hides). It only hides when:

- Selection is cleared (or shrinks below 2 chars)
- User clicks somewhere with no selection
- An action runs to completion
- `Esc` is pressed

Selections OUTSIDE an editable element are NOT handled here — they ride as palette context (`palette.context.selectionText`) for the agent.

---

## Immersive Translate (bilingual page render)

**Opt-in**. Walks the page DOM, batches blocks into LLM calls, appends translations after each block. Same convention extensions like *Immersive Translate* and *Mate* use — `<font class="dddk-imm-translate">` wrapper that survives most rich-text / PDF / Office HTML pipelines.

```ts
import { ImmersiveTranslate } from '@perhapxin/dddk';

const immersive = new ImmersiveTranslate({
  llm,
  batchSize: 30,        // blocks per LLM call (default 30)
  batchCharCap: 4500,   // OR break a batch at this char total (default 4500)
});
immersive.attachTo(dddk);

// Drive from a palette item (see /immersive_translate in the demo):
immersive.enable('zh-TW');      // run a full translation pass
immersive.disable();            // strip injected translations
immersive.toggle('ja');         // shorthand
```

### How a single LLM call handles many blocks

Prompt: JSON array of source strings, one per block. Response must be a JSON array of the same length. A 200-paragraph article costs ~7 calls, not 200.

```json
// Request
["The agent runs in the visible DOM…", "Selection rides as context…", ...]
// Response
["agent 在可見的 DOM 範圍內執行…", "選取會作為 context…", ...]
```

The module passes `thinking: 'off'`, `jsonMode: true`, `temperature: 0.2` to the LLM — the answer is deterministic translation, not reasoning.

### Caching

Translations are cached per `(source-text-hash, target-language)` in an in-memory `Map`. Pass `cache: { get(key), set(key, val) }` to persist across reloads (e.g. backed by `localStorage`).

### PDF / docx scope

Works when the document is *in the DOM* — pdf.js's selectable-text overlay, `mammoth.js`-rendered docx, etc. Native PDF plugins and cross-origin Office Online iframes are out of reach (browser sandboxing). The `<font>` wrapper choice means: if your host renders PDF/docx as inline HTML, the bilingual layout is preserved when the user saves / exports.

---

## Theme switch (light / dark)

Built in. Use the `ThemeToggleModule` or set the data attribute directly.

```ts
import { ThemeToggleModule } from '@perhapxin/dddk';

const theme = new ThemeToggleModule();
theme.registerOn(dotdotduck.palette);   // adds /theme command
theme.apply();                    // apply current preference

// programmatic:
theme.set('dark');                 // 'light' | 'dark' | 'system'
theme.toggle();                    // light ↔ dark
```

Or just:

```ts
document.documentElement.dataset.theme = 'dark';
```

All dotdotduck surfaces re-render via CSS tokens. See [11-theming](./11-theming.md) for the full token reference + custom modes (sepia, high-contrast, etc.).

---

## Language switcher

```ts
import { LanguageSwitcherModule } from '@perhapxin/dddk';

const lang = new LanguageSwitcherModule({
  available: [
    { code: 'en', label: 'English' },
    { code: 'zh-TW', label: '繁體中文' },
    { code: 'ja', label: '日本語' },
  ],
  current: 'en',
  onChange: (code) => { yourI18n.setLocale(code); },
});

lang.registerOn(dotdotduck.palette);   // adds /language command
```

dotdotduck does not own your i18n — you wire the `onChange` callback to whatever locale system your app uses (next-intl, sveltekit-i18n, vue-i18n, your own).

---

## Mobile chrome

**Opt-in**. Mobile-only — no-op on desktop.

```ts
import { MobileTrigger } from '@perhapxin/dddk';

const mobile = new MobileTrigger();
mobile.attachTo(dotdotduck);
```

Gesture: rapid up-down swipe ≥3 reversals in 700ms. Won't fire on normal scroll. Top + bottom chrome bars appear; user can tap palette icon, central voice button, or close.

Toggle at runtime: `mobile.show()` / `mobile.hide()` / `mobile.toggle()`.

---

## Agent cursor (visible cursor + pre-click pause)

**Opt-in**. Shows a large floating cursor when the webagent is acting.

```ts
import { AgentCursor } from '@perhapxin/dddk';

const cursor = new AgentCursor({
  preClickPauseMs: 250,   // pause before each action fires
  size: 32,
  travelMs: 350,
});
cursor.attachTo(dotdotduck);
```

**Runtime toggle**:

```ts
cursor.setEnabled(false);
```

---

## Cross-tab session sync

```ts
new DotDotDuck({
  llm,
  webAgent: { crossTabSync: true },   // default false
});
```

When `true`, the agent session is mirrored to localStorage + broadcast on a `BroadcastChannel`. A new tab on the same origin picks up where the previous one left off. Same-origin only — see [webagent / 12-session-continuity](../../webagent/docs/12-session-continuity.md).

---

## Tear-down

When your app unmounts (page leave, host SPA route change, etc.) — always:

```ts
dotdotduck.destroy();
// + any modules you instantiated:
voice.destroy();
selection.stop();
dwell.destroy();
agentCursor.destroy();
mobile.destroy();
```

Calling `mount()` again afterward without `destroy` will double-bind listeners.
