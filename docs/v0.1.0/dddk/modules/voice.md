# dotdotduck — Voice I/O

> Speech-to-text (listen to the user) + Text-to-speech (read aloud to the user). Two opt-in classes — `Voice` (STT) and `TTS`, wrapped together by `VoiceModule` for convenience. Host wires them to the Space gesture and the subtitle bar; the SDK doesn't auto-mount either.

## Integration flow

1. Long-press Space → host calls `voiceModule.captureOnce(dddk.subtitle)` (or `voice.start()` directly).
2. Web Speech API (or a host-supplied `transcribe` callback) produces raw text.
3. Optional LLM cleanup pass (remove fillers, fix punctuation) via the `voiceCleanup` LLM role.
4. Host decides what to do with the transcript:
   - **Focused editable** → insert at the caret.
   - **Pinned Dwell element** → `dddk.startAgent(text, { selection: { ... } })`.
   - **Live window selection** → `dddk.startAgent(text, { selection: { text } })`.
   - **Otherwise** → `dddk.startAgent(text)` as a plain task.

`DotDotDuckConfig.voice` is only `{ enabled?: boolean }` — the global on/off switch for the subtitle-bar voice indicator. The actual STT / TTS configuration lives on the `VoiceModule` / `Voice` / `TTS` classes you instantiate yourself.

## STT config (`VoiceConfig`)

Pass on `new Voice(config)` directly, OR via `new VoiceModule({ stt: config, ... })`.

```ts
import { Voice, VoiceModule } from '@perhapxin/dddk';

const voice = new VoiceModule({
  llm: router,                  // LLMProvider / LLMRouter — uses `voiceCleanup` role
  stt: {
    language: 'zh-TW',          // default: navigator.language
    continuous: true,           // default: true (long-press release ends the capture)
    interimResults: true,       // default: true (partial transcripts streamed)
    cleanupWithLLM: true,       // default: true when `llm` is set
    cleanupPrompt: '…',         // override the bundled language-agnostic cleanup prompt
    transcribe: async (audio, opts) => '…',   // host-supplied STT — see "Custom STT" below
    transcribeMode: 'fallback', // 'fallback' (use Web Speech, fall back to MediaRecorder) | 'always'
    autoRestartOnEnd: true,     // default: true — re-spawn recognition when Android/iOS auto-stops
  },
  // VoiceModule extras:
  listeningLabel: 'Listening — release to send',
  unsupportedLabel: 'This browser does not support voice input',
  captureTimeoutMs: 30000,      // upper bound for a single capture
  autoSpeakSubtitles: false,    // when true, every subtitle.show() is also TTS-spoken
});
```

## TTS config (`TTSConfig`)

```ts
import { TTS } from '@perhapxin/dddk';

new TTS({
  voice: 'Google 國語',  // browser voice name (must match a SpeechSynthesisVoice on the device)
  rate: 1.0,             // 0.1 – 10
  pitch: 1.0,            // 0 – 2
  volume: 1.0,           // 0 – 1
  lang: 'zh-TW',         // BCP-47, drives voice selection
});
```

The `VoiceModule` constructs a TTS internally; pass `tts: TTSConfig` to override. Hosts that want to drive subtitle-readback should wire `dddk.subtitle.setTTSProvider(fn)` separately — see the Subtitle docs.

## Voice trigger scenarios

### Scenario 1 — Long-press Space, no selection
```
keydown space (long press) → mic on
voice ends → text becomes a task: dddk.startAgent(text)
```

### Scenario 2 — Long-press Space + focused editable
```
voice_start: snapshot document.activeElement (still an editable)
voice ends → splice transcript at the caret of that editable
```

### Scenario 3 — Long-press Space + Dwell-pinned element
```
voice ends → captureElementContext(pinnedEl) → screenshot + innerText
dddk.startAgent(text, { selection: { text, elements, images } })
```

## Voice → action decision tree (recommended host wiring)

When the transcript arrives, check in priority order:

1. **Focused editable (snapshot at voice_start)** → insert the transcript at the caret. Mirrors native dictation behaviour.
2. **Dwell has pinned an element** → `dddk.startAgent(text, { selection: { text, elements, images } })` with the pinned element's text + auto-screenshot.
3. **Live window selection** → `dddk.startAgent(text, { selection: { text } })` so the agent answers about THAT, not the whole page.
4. Otherwise → `dddk.startAgent(text)` as a plain task.

## Pre-warming the mic (`Voice.warmUp` / `VoiceModule.warmUp`)

The very first `voice.start()` chains: permission prompt (if not granted) → `getUserMedia` (~300–800ms cold) → Web Speech TLS handshake to Google's STT (~200–500ms). In practice the user releases Space before audio capture begins. Call `warmUp()` from an incidental user gesture (any pointerdown / keydown) to move that cold-start off the voice gesture's critical path:

```ts
const tryWarmUp = () => voice.warmUp().catch(() => { /* denied — silent */ });

if (navigator.permissions?.query) {
  navigator.permissions.query({ name: 'microphone' as PermissionName }).then((s) => {
    if (s.state === 'granted') tryWarmUp();    // returning visitor — warm immediately
  });
}
window.addEventListener('pointerdown', tryWarmUp, { capture: true, once: true });
window.addEventListener('keydown',     tryWarmUp, { capture: true, once: true });
```

`warmUp()` is idempotent — subsequent calls after `granted` are no-ops. Pass `{ force: true }` to re-warm after long idle. Returns `'granted' | 'prompt' | 'denied' | 'unavailable'`.

## Subtitle integration

While voice is active the subtitle bar shows a listening indicator:

```ts
voice.on('start', () => subtitle.showIndicator('listening', 'Listening — release to stop'));
voice.on('interim', (partial) => subtitle.showIndicator('listening', partial));
voice.on('end', () => subtitle.showIndicator('processing', 'Processing…'));
voice.on('cleanup_done', (text) => subtitle.hideIndicator());
```

## Auto-read agent subtitles with TTS

Two ways to wire this up — pick one:

```ts
// (a) VoiceModule's autoSpeakSubtitles: speakSubtitle(text) reads if true.
const voice = new VoiceModule({ tts: {...}, autoSpeakSubtitles: true });
agent.on('subtitle', (text) => {
  dddk.subtitle.show({ text, type: 'agent' });
  void voice.speakSubtitle(text);
});

// (b) subtitle.setTTSProvider — fires for EVERY subtitle.show() automatically.
import { createWebSpeechTTSProvider } from '$lib/tts-provider';
dddk.subtitle.setTTSProvider(createWebSpeechTTSProvider());
```

User presses Escape mid-speech → TTS stops via the host's own handler (the bundled provider exposes `tts.stop()`).

## Voice cleanup prompt

A single language-agnostic prompt — the LLM detects the input language from the transcript itself and replies in the same language(s):

```
You are a speech-to-text post-processor. The input is a raw transcript.

- Detect the language(s) and reply in the same language(s). Preserve code-switching.
- Add correct punctuation and capitalisation.
- Remove fillers ("um", "uh", "you know", "like", "I mean", and equivalents in other languages).
- Fix obvious homophone / mishear errors when context makes them obvious.
- Do NOT rewrite or interpret — preserve the user's meaning verbatim.
- Reply with the cleaned text only. No prefix, no explanation.
```

Override with `VoiceConfig.cleanupPrompt` if you need domain-specific terminology preserved (product names, code identifiers).

## Custom STT (`transcribe` callback)

Web Speech doesn't work everywhere (Firefox, some embedded webviews) and isn't always the best quality. Pass `transcribe(audioBlob, opts)` to plug in any STT vendor — the SDK records audio via MediaRecorder and hands the result to your callback:

```ts
new VoiceModule({
  stt: {
    transcribe: async (audio, { language, mimeType }) => {
      // Send audio to your endpoint, return the transcript.
      const fd = new FormData();
      fd.append('audio', audio, `clip.${mimeType.split('/')[1]}`);
      fd.append('lang', language);
      const res = await fetch('/api/stt', { method: 'POST', body: fd });
      const { text } = await res.json();
      return text;
    },
    transcribeMode: 'fallback', // or 'always' to never use Web Speech
  },
});
```

Common targets: OpenAI Whisper, Gemini audio input, Azure Speech, Deepgram, AssemblyAI, self-hosted whisper.cpp.

## Not supported (explicit v0.1 boundaries)

- Continuous-conversation mode (interrupt-the-agent style)
- Multi-speaker diarisation
- Real-time speech translation — use ImmersiveTranslate for page-wide translation instead
- Custom wake words (Space is the canonical gesture)

## Privacy

- Default STT is Web Speech — audio is processed by the browser's STT vendor (Chrome/Edge sends to Google's STT endpoint; Safari processes locally on newer macOS / iOS).
- The mic only opens when the user actively long-presses Space — no continuous listening.
- Mic permission is governed by the browser; dotdotduck never bypasses it.
- Cloud STT via `transcribe` is opt-in and runs through the host's own endpoint — dotdotduck doesn't ship a vendor SDK.

## Verify it works

After mounting `new DotDotDuck({ voice: { ... } })`:

1. Press and hold Space on a non-input element → the subtitle bar should show "Listening — release to stop" within ~150 ms.
2. Speak a short sentence, release Space → indicator changes to "Processing…".
3. If `cleanupWithLLM` is on, the cleaned text appears as either an agent task or a subtitle suggestion.
4. If nothing fires, open DevTools and check for a `voice.error` event — Web Speech requires HTTPS and the right `language` code (e.g. `zh-TW`, not `zh-Hant-TW`).
