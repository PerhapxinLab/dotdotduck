# InlineAgent — selection menu inside editables

> A floating menu that pops up below selected text inside an `<input>`, `<textarea>`, or `[contenteditable]`. Pick an action; the selection is replaced by the LLM's edit.

Opt-in. Disabled by default; attach an `InlineAgent` instance to turn it on.

## When to use

- Rewriting / translating / shortening / fixing text the user is currently editing
- Domain-specific transforms that should land directly into the form field (e.g. "convert this email draft to a customer-support tone")

Don't reach for InlineAgent when:

- The selection is in **non-editable** page content — that's the palette flow (`palette.context.selectionText`), not this module
- You want the LLM to generate freeform output for the user to *read* — use [Subtitle](./subtitle.md) + an agent task instead
- You want to drive multi-step edits across many fields — use a [skill](../skills/overview.md) so the user sees one progress UI, not seven popovers

## Import

```ts
import { InlineAgent } from '@perhapxin/dddk';
import type { InlineAgentConfig, InlineAction } from '@perhapxin/dddk';
```

## Minimum setup

```ts
import { InlineAgent } from '@perhapxin/dddk';

const inline = new InlineAgent({
  llm,
  locale: 'zh-TW', // built-in i18n: 'en' | 'zh-TW'
});
inline.attachTo(dddk);
```

That's it. Any selection ≥ 2 chars inside an editable element will pop the menu.

## Built-in actions

Seven defaults ship out of the box:

| `id` | English label | 中文 label |
| --- | --- | --- |
| `translate` | Translate | 翻譯 |
| `improve` | Improve writing | 改寫 |
| `fix` | Fix spelling & grammar | 修文法 |
| `shorter` | Make shorter | 縮短 |
| `longer` | Make longer | 延長 |
| `tone` | Change to professional tone | 改成正式語氣 |
| `explain` | Explain this | 解釋 |

Translate is a **dynamic** action — clicking it opens a language sub-menu. Override the offered languages with `translateTargets`:

```ts
new InlineAgent({
  llm,
  translateTargets: [
    { code: 'en', label: 'English' },
    { code: 'zh-TW', label: '繁體中文' },
    { code: 'ja', label: '日本語' },
  ],
});
```

## How a call is built

InlineAgent does NOT just send the selected fragment to the LLM. It assembles a **context window** of ~400 chars before + after the selection and marks the fragment with `[[SEL]]` / `[[/SEL]]`. The LLM is asked for a JSON object — only the `replacement` field is applied:

```
System: …strict edit-file instructions…
User:   Instruction: Translate to Japanese.

        Context (with selection marked):
        """
        她…[[SEL]]今天去買菜[[/SEL]]，然後…
        """

        Return JSON: { "replacement": "..." }
```

The call uses `thinking: 'off'`, `jsonMode: true`, `temperature: 0` — deterministic edits with no chain-of-thought leakage. The replacement is spliced into the editable at the known offsets (`selectionStart` / `selectionEnd` for `<input>` / `<textarea>`; the live `Range` for contenteditable). No fuzzy matching, no transcript leak.

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `llm` | — | `LLMSource` (required). |
| `actions` | seven defaults | Override the entire action list. |
| `locale` | `'en'` | `'en' \| 'zh-TW'` for built-in labels. |
| `translateTargets` | en / zh-TW / ja | Languages offered by the Translate sub-menu. |
| `hideAfterMs` | `0` | Auto-hide after N ms of no selection change. `0` = never. |
| `ignoreSelector` | — | Never trigger inside elements matching this. |
| `shortcut` | `mod+.` | Reserved — keyboard shortcut to open the menu programmatically (not yet wired). |

## Runtime API

```ts
inline.addAction({
  id: 'my-action',
  label: '…',
  icon: '…',
  instruction: 'Rewrite as if the user were a pirate.',
});
inline.removeAction('translate');         // drop a default
inline.updateAction('improve', { instruction: 'New prompt…' });
inline.setActions([...]);                  // wholesale replace
inline.setEnabled(false);                  // detach without unmount
inline.isEnabled();                        // boolean
inline.destroy();                          // unmount listeners + menu
```

## Dynamic instructions — ask before run

An action's `build()` runs at activation time. Use it to gather input before the LLM call. The built-in Translate uses this for its language picker; any custom flow works:

```ts
{
  id: 'translate-custom',
  label: 'Translate to…',
  icon: '文',
  build: async ({ text, agent }) => {
    const target = await myPicker();          // your own UI / modal / palette
    if (!target) return null;                  // null = cancel cleanly, no LLM call
    return `Translate to ${target}. Output only the translation.`;
  },
}
```

`build` wins over `instruction` if both are set.

## Keyboard

- `ArrowDown` / `ArrowUp` (or `Ctrl+N` / `Ctrl+P`) — navigate
- `Mod+Enter` (Cmd / Ctrl / Alt + Enter) — fire the highlighted action.
  Plain Enter is preserved so users can still add a newline in the editable.
- `Esc` — close the menu

## Persistence — when the menu shows / hides

The menu stays visible as long as the selection is alive. Scroll **repositions** it (does not hide). It only hides when:

- Selection is cleared or shrinks below 2 chars
- User clicks somewhere with no selection
- An action runs to completion
- `Esc` is pressed
- `inline.setEnabled(false)` is called

Selections **outside** an editable element are NOT handled here — they ride as palette context (`palette.context.selectionText`) for the agent.

## Positioning

The menu opens **below the selection** by default:

- Vertical: anchored 6px below `selection.rect.bottom`, growing downward. The menu only flips to **above** the selection when there isn't enough room below AND there's more room above. Opening alongside the selection (top-aligned) was overlapping the user's own text on narrow screens.
- Horizontal: anchored at the right edge of the selection. Flips left when overflowing the viewport.

For `<input>` and `<textarea>` the selection rect is computed via a mirror-div technique (clone typographic styles, find caret coords for `selectionStart` / `selectionEnd`). This matters: anchoring to the input element's bbox would put the menu next to the textarea border, not next to the selected text.

## Error handling

LLM provider errors are humanised into a one-line subtitle so the user doesn't see a stack trace. The full raw error goes to `console.warn`. Common cases:

| Status | English subtitle | 中文 subtitle |
| --- | --- | --- |
| 429 | `<vendor> rate limit — wait a few seconds and retry` | `<vendor> 速率上限,稍等幾秒再試` |
| 5xx | `<vendor> is having a moment — please retry` | `<vendor> 暫時忙線,請再試一次` |
| 400 | `<vendor> rejected the request (bad shape)` | `<vendor> 拒絕請求(請求格式問題)` |
| 401 / 403 | `<vendor> auth failed` | `<vendor> 認證失敗` |

## Tear-down

```ts
inline.destroy();
```

Removes listeners, the menu, and the sub-menu. Always call this in your SPA route-change / unmount path.

See also: [./dwell.md](./dwell.md) for the non-editable counterpart, [./overview.md](./overview.md) for the module index.
