# webagent — Modules

> Opt-in modules — import only the ones you need. Each is independent, usable on its own, and can also be invoked by the agent as an action.

## Immersive Translate

### What it is
Live, inline translation on the page — does NOT replace the original; inserts the translation below each paragraph (same style as the chrome extension "Immersive Translate").

### API
```ts
import { immersiveTranslate, removeImmersiveTranslation } from '@perhapxin/dddk';

await immersiveTranslate({
  targetLang: 'zh-TW',
  llm: provider,
  glossary?: { 'API': 'API (Application Programming Interface)', ... },
  cache?: boolean,            // default true; stored in sessionStorage
  layout?: 'below' | 'side',  // default 'below'
  scope?: HTMLElement | string,  // default document.body
});

removeImmersiveTranslation();
```

### v1 features
- DOM walk + paragraph extraction
- Batched translation (15 paragraphs per request — token-efficient)
- Inserts a sibling element (original text preserved)
- **Glossary** (force-fixed translations for enterprise terms)
- **Side-by-side layout** (in addition to "below")
- **Translation cache** (same paragraph never re-translated)
- **HTML formatting preserved** (bold, links, inline code)
- Auto source-language detection
- Progress reporting (large pages show progress)

### Used as a webagent action
The LLM can call the `immersive_translate` action (registered via `customActions`).

### Not in v1
- PDF / EPUB translation (separate future package, `@perhapxin/translate-pdf`)
- Video subtitles (same)
- OCR translation for images (same)

---

## TTS (Text-to-Speech)

### API
```ts
import { TTS } from '@perhapxin/dddk';

const tts = new TTS({
  provider?: 'web-speech' | 'openai-tts' | 'gemini-tts',  // default 'web-speech'
  voice?: string,
  rate?: number,
  pitch?: number,
});

await tts.speak('Hello world');
tts.stop();
tts.on('end', () => { ... });
```

### Why Web Speech is the default
- Zero cost (built into the browser)
- Zero latency (no network)
- Trade-off: voice quality is below cloud providers; multi-language coverage is uneven

### Cloud providers
- `openai-tts` — `tts-1-hd`, requires `OPENAI_API_KEY`
- `gemini-tts` — Gemini TTS API, requires `GEMINI_API_KEY`

### Agent integration
When the agent calls `show_subtitle`, if the host has wired up TTS:

```ts
agent.on('subtitle', (text) => {
  myUI.showBar(text);
  tts.speak(text);  // read aloud in parallel
});
```

---

## Selection Agent

### What it is
User selects some text → operate on the selection (translate / summarize / rewrite / explain / search). Used by dddk's long-press-Space flow.

### API
```ts
import { InlineAgent } from '@perhapxin/dddk';

const sa = new InlineAgent({ llm: provider });

const result = await sa.process(
  selectedText,
  instruction,    // what the user said: "translate", "summarize", "make it more formal"
  images?,        // images within the selection
);
```

### Special result formats
The result can be plain text or one of two control formats that trigger deeper host behaviour:

- `[NAVIGATE:/path]` — for commands like "go to settings"; the host routes to the path.
- `[AGENT:task]` — for commands like "do X for me"; the host hands off to the full agent loop.

```ts
const result = await sa.process(text, instruction);

if (result.startsWith('[AGENT:')) {
  const task = result.match(/\[AGENT:(.+)\]/)[1];
  agent.run(task);
} else if (result.startsWith('[NAVIGATE:')) {
  router.push(result.match(/\[NAVIGATE:(.+)\]/)[1]);
} else {
  showResult(result);
}
```

---

## STT (Speech-to-Text)

### API
```ts
import { Voice } from '@perhapxin/dddk';

const voice = new Voice({
  language?: 'en-US' | 'zh-TW',  // default: navigator.language
  cleanupWithLLM?: boolean,      // default true — use LLM to clean punctuation / fillers
  llm?: provider,                // used by cleanup
});

voice.start();
// user talks...
const cleaned = await voice.stop();  // STT result + LLM-cleaned version
```

### Why LLM cleanup
Raw output from the Web Speech API typically has:
- No punctuation
- Fillers ("um", "you know", "so so")
- Mixed-language jumps
- Homophone errors

A single LLM cleanup pass produces text fit to show the user. The cleanup prompt is short — minimal extra cost.

---

## Surface emission

Structured UI is handled by dddk's Pieces system — webagent does not render it itself. When dddk opens a Piece surface, webagent forwards it to the agent context via the `piece_surface` event so the agent knows what's on screen. The host subscribes to dddk's `surface` event to render; see [dddk — Surface renderer](../../surfaces/renderer.md).
