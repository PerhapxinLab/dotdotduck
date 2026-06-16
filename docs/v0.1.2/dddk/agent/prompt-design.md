# Prompt design — CoT envelope + two-block system

> Status: shipped in `src/agent/webagent/prompt.ts` + `cot.ts`.

## What the model actually sees

Every webagent turn sends OpenAI a payload split into four parts:

```
messages[0] system            ← SDK default block + dev block
messages[1..N-1]              ← history turns (user / assistant(tool_call) / tool)
messages[N] last user msg     ← env block: current URL + Page DOM (+ images)
tools[]                       ← one agent_turn wrapper only
toolChoice                    ← forces every turn to call agent_turn
```

Two design lines:
- **System prompt = SDK default + host dev block**, concatenated once;
- **agent_turn is the envelope wrapper**, every action (narrate / navigate / click …) goes inside its `actions[]`, and the model emits exactly one agent_turn per turn.

## System prompt content (CoT mode)

`renderCotDefault()` emits, top to bottom:

| Section | Source | Content |
|---|---|---|
| identity | `agentName` + `siteName` + auto date | `You are <agent> on <site>, an in-page assistant. Today is YYYY-MM-DD.` |
| persona | `WebAgentConfig.persona` | First-person identity (host opt-in) |
| `# Tools` | `renderToolReference(cotToolRefs)` | Each action's name + description + JSON Schema |
| `# Envelope` | Hardcoded | `memory` / `todos_remaining` / `actions` field reference |
| `# DOM` | Hardcoded | DOM dump format: `[id]` / `↑↓` / how selectors work |
| dev block | `appendSystemPrompt` | Host-authored sitemap, navigation, narration, language rules |

Date lives in the identity line because it's session-stable — putting it there doesn't break the prompt cache prefix.

## agent_turn envelope

```ts
agent_turn({
  memory: string,                    // 1-2 sentence private progress note
  todos_remaining: string[],         // what's still owed to the original request
  actions?: Array<                   // what to run this turn
    { narrate: string } |
    { tool: string, args: object }
  >,
})
```

The runtime walks `actions[]` in order:
- `narrate` → typewriter into subtitle bar; auto-pauses for Space after each;
- `tool` → confirm gate (if needed) + dispatch through `executeAction`;
- empty / omitted `actions` → loop ends.

The pause is **intra-turn** (between actions in the same actions[]) — NOT a hand-off to a future turn. To batch work, put everything in one `actions[]`.

## Env block (last user message)

`renderPageStateBlock()` emits:

```
# Current page
- URL: /commercial

# Page DOM
[3a2b]<section>...
↓[4e1c]<table>...
```

Plus image content parts for any screenshots / palette attachments queued for this turn.

URL stays here because it changes on every navigate — putting it in system would break cache. DOM dump same reason, re-read every turn.

## History does NOT carry DOM

Past turn messages only persist:
- user turn: text + selection (no DOM);
- agent_step: `agent_turn` call + tool reply (with `memory` / `todos_remaining` / `action_results`);
- agent_final: final paragraph.

Reason: a DOM dump is 3-5K tokens per turn — multiplying by N is wasteful and the prompt cache already gets prefix stability for free with append-only history. The trade-off is the model can't recall "the pricing table I saw earlier on /pricing"; if it needs that, it should write the key facts into `memory` itself.

## Override layers

```
systemPrompt: (ctx, defaultPrompt) => string   // wraps default
systemPrompt: string                           // hard replace
appendSystemPrompt                             // appended after SDK default (dev block)
actionOverrides[name]                          // per-tool description rewrite / append
persona                                        // identity / voice / constraints
```

Precedence: function > string > otherwise default + appendSystemPrompt. `actionOverrides` is orthogonal — it always applies to each action's description inside the `# Tools` section regardless of how the rest of the system prompt is assembled.

### actionOverrides — rules colocated with the tool

Tool-specific rules ("which palette commands are registered", "navigate doesn't pre-narrate", "border every subject before narrating") belong here rather than in `appendSystemPrompt` — the rule sits next to the tool description, so the model sees tool + rule together inside `# Tools` instead of cross-referencing the dev block.

```ts
new WebAgent({
  llm,
  actionOverrides: {
    navigate: {
      appendDescription: 'Site rule: just call this tool directly, no pre-narrate.',
    },
    click: {
      appendDescription: '`selector` MUST be a `[id]` hash from the DOM dump, never an invented `#thing` CSS selector.',
    },
    border: {
      description: 'Custom description (replaces the SDK default entirely).',
    },
  },
});
```

- `appendDescription` — concatenated after the SDK default with a `\n`. Most common.
- `description` — hard replace; the SDK default is dropped entirely. Use sparingly.
- If both are set, `description` wins.

Applies to all actions — builtin (navigate / click / border ...), orchestrator-registered (`palette_*` agentTool), host-registered via `dddk.tools.register`, and `customActions`.

`appendSystemPrompt` is reserved for cross-cutting rules: sitemap, language, narrate formatting style.

### 80% case: `persona` + `appendSystemPrompt`

```ts
new WebAgent({
  llm,
  persona: 'You are the Acme assistant. Speak as "we" when describing what Acme provides.',
  appendSystemPrompt: [
    '# Sitemap — what the user wants → which page',
    '- `/orders` — view orders, returns, invoices.',
    '- `/account` — change profile, payment methods, address.',
    '',
    '# Navigation',
    'To go to another page, just call navigate. Do not pre-narrate.',
    '',
    '# Narration',
    '- When explaining or guiding through the page, every narrate must call border on the element it refers to first.',
    '- Use `\\n` to split multi-item content (plans, steps, options) onto separate lines.',
    '',
    '# Language',
    'Reply in the language the user last used.',
  ].join('\n'),
});
```

### Hard takeover: `systemPrompt: string`

Wipes the SDK default (including envelope rules). You must copy the envelope rules into your own string or the model won't know how to call `agent_turn`. Use the function form instead in most cases.

## Tool list location

In CoT mode OpenAI's `tools[]` only carries one `agent_turn` (with forced `toolChoice`). The real actions (navigate / click / scroll_to / border / fill_input / …) live in the system prompt's `# Tools` section with their name + description + JSON Schema, for the model to populate `agent_turn.actions[].tool`.

To add an action use `WebAgentConfig.customActions`; to remove a builtin use `disableBuiltinActions`; to enable `present_surface` set `allowPresent: true`.

## Debug

`window.__dddkDebug.lastLlmMessages` holds the last messages array sent; `window.__dddkDebug.turnLog` keeps a rolling 50-entry summary of each turn's envelope. The console also logs `[dddk webagent] turn` with memory / todos / actions per turn.

## Why the SDK default is English

LLMs respond most reliably to English imperative instructions and stable tool-calling. The dev block lets the host write whatever language they want; the host's reply-language rule overrides the English default.
