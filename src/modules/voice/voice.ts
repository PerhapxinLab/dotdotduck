/**
 * Voice — Speech-to-Text.
 *
 * Primary path: Web Speech API via `webkitSpeechRecognition` (Chrome, Edge,
 * Android Chrome, iOS / macOS Safari). All of these use the same underlying
 * vendor STT (Google on Chrome/Android, Microsoft on Edge, Apple on Safari).
 *
 * Cross-platform quirks the code handles:
 *   - Android Chrome / iOS Safari sometimes auto-end the recognition before
 *     the user releases the hold gesture. With `autoRestartOnEnd: true`
 *     (default), the recognition is restarted while the user is still
 *     holding, keeping `finalText` accumulating across mini-sessions.
 *   - `continuous: true` is the default (hold-to-talk UX). On some Android
 *     builds the flag is ignored but auto-restart compensates.
 *
 * Fallback path: host-supplied `transcribe(audioBlob)` function.
 *   - `transcribeMode: 'always'` — skip Web Speech entirely; record via
 *     MediaRecorder and hand the audio Blob to the host's STT.
 *   - `transcribeMode: 'fallback'` — use Web Speech if available, fall back
 *     to MediaRecorder + host transcribe when Web Speech is unavailable
 *     (e.g. Firefox / Samsung Internet).
 *
 * The SDK does NOT ship any STT model. Hosts wire their own (OpenAI Whisper,
 * Gemini audio, Azure Speech, on-prem Whisper.cpp, whatever).
 *
 * If neither path is available, `isSupported()` returns false and `start()`
 * emits an explicit error so the host UI can say "browser doesn't support
 * voice input".
 */

import { resolveLLM, type LLMSource } from '../../agent/llm/router';

export type AudioTranscriber = (
  audio: Blob,
  opts: { language: string; mimeType: string }
) => Promise<string>;

export interface VoiceConfig {
  language?: string;
  continuous?: boolean;
  interimResults?: boolean;
  /** Run an LLM pass to remove fillers / fix punctuation. Default true if llm provided. */
  cleanupWithLLM?: boolean;
  /** Pass an LLMProvider or LLMRouter — the `voiceCleanup` role is used. */
  llm?: LLMSource;
  /** Override cleanup system prompt. */
  cleanupPrompt?: string;

  /**
   * Host-supplied STT. Receives the recorded audio Blob and the detected
   * language, returns the transcript. The SDK records audio via
   * MediaRecorder and hands the result to this function — no model bundled.
   *
   * Hook this up if you want a fallback (or replacement) for the browser's
   * built-in Web Speech API. Common implementations:
   *   - OpenAI Whisper API
   *   - Gemini audio input (multimodal)
   *   - Azure Speech, Deepgram, etc.
   *   - Self-hosted Whisper.cpp via your own API
   */
  transcribe?: AudioTranscriber;

  /**
   * How to use the host transcriber relative to Web Speech.
   *   - `fallback` (default if `transcribe` provided) — use Web Speech if
   *     available, fall back to MediaRecorder + transcribe when not
   *   - `always` — never use Web Speech; always go MediaRecorder + transcribe
   */
  transcribeMode?: 'fallback' | 'always';

  /**
   * Auto-restart recognition when it ends prematurely while the user is
   * still holding the gesture. Critical for Android Chrome / iOS Safari
   * which auto-stop on silence pauses even with `continuous: true`.
   * Default true.
   */
  autoRestartOnEnd?: boolean;
}

type Listener<T = unknown> = (payload: T) => void;

type Platform = 'desktop-chrome' | 'desktop-edge' | 'desktop-safari' | 'android-chrome' | 'ios-safari' | 'unknown';

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android-chrome';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios-safari';
  if (/Edg\//.test(ua)) return 'desktop-edge';
  if (/Chrome\//.test(ua)) return 'desktop-chrome';
  if (/Safari\//.test(ua)) return 'desktop-safari';
  return 'unknown';
}

function getMediaRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const m of candidates) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

export class Voice {
  private config: Required<Pick<VoiceConfig, 'language' | 'continuous' | 'interimResults' | 'autoRestartOnEnd'>> &
    VoiceConfig;
  private recognition: SpeechRecognition | null = null;
  /** Warm-up recognition spawned by warmUp(). Held so a real voice
   *  gesture can abort it before spawning its own — Web Speech rejects
   *  a second concurrent start() with InvalidStateError, and the
   *  symptom is identical to "voice didn't start" (silent failure). */
  private warmupRecognition: SpeechRecognition | null = null;
  private listeners: Map<string, Set<Listener>> = new Map();
  private finalText = '';
  private interimText = '';
  private webSpeechSupported: boolean;
  private mediaRecorderSupported: boolean;
  private platform: Platform;

  // State for managing the active session
  private userStopped = false;
  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaChunks: Blob[] = [];
  private usingTranscribe = false;

  constructor(config: VoiceConfig = {}) {
    const merged: VoiceConfig = { ...config };
    if (merged.language === undefined) {
      merged.language = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    }
    if (merged.continuous === undefined) merged.continuous = true;
    if (merged.interimResults === undefined) merged.interimResults = true;
    if (merged.autoRestartOnEnd === undefined) merged.autoRestartOnEnd = true;
    this.config = merged as typeof this.config;

    this.platform = detectPlatform();
    this.webSpeechSupported =
      typeof window !== 'undefined' &&
      ((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition !== undefined ||
        (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition !==
          undefined);
    this.mediaRecorderSupported =
      typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && getMediaRecorderMime() !== '';
  }

  /**
   * True if ANY STT path is usable (Web Speech OR host transcribe + MediaRecorder).
   * Host should check this before showing the voice button at all.
   */
  isSupported(): boolean {
    if (this.config.transcribeMode === 'always') {
      return this.mediaRecorderSupported && !!this.config.transcribe;
    }
    if (this.webSpeechSupported) return true;
    if (this.config.transcribe && this.mediaRecorderSupported) return true;
    return false;
  }

  /** Detected platform string. Useful for diagnostics. */
  getPlatform(): Platform {
    return this.platform;
  }

  on(event: 'start' | 'interim' | 'final' | 'end' | 'error', handler: Listener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: Listener): void {
    this.listeners.get(event)?.delete(handler);
  }

  private emit(event: string, payload?: unknown): void {
    this.listeners.get(event)?.forEach((h) => {
      try {
        h(payload);
      } catch (err) {
        console.error('[voice] listener error:', err);
      }
    });
  }

  start(): void {
    this.userStopped = false;
    this.finalText = '';
    this.interimText = '';
    this.mediaChunks = [];
    // Tear down any in-flight warmup recognition. Web Speech rejects a
    // second concurrent start() with InvalidStateError — symptom in the
    // wild is "voice gesture seems to do nothing". This happens when
    // the user's FIRST page interaction (the gesture that fired
    // warmUp) is immediately followed by a real voice gesture before
    // the warmup recognition's onstart→abort cycle completes.
    this.abortWarmup();

    // Decide which path:
    //   1. transcribeMode==='always' AND transcribe provided → MediaRecorder
    //   2. Web Speech available → use it (with auto-restart on Android/iOS)
    //   3. transcribe provided as fallback → MediaRecorder
    //   4. nothing → emit error
    if (this.config.transcribeMode === 'always' && this.config.transcribe) {
      this.usingTranscribe = true;
      this.startMediaRecorder();
      return;
    }
    if (this.webSpeechSupported) {
      this.usingTranscribe = false;
      this.startWebSpeech();
      return;
    }
    if (this.config.transcribe && this.mediaRecorderSupported) {
      this.usingTranscribe = true;
      this.startMediaRecorder();
      return;
    }
    this.emit('error', {
      code: 'not-supported',
      message: 'browser does not support speech recognition',
    });
    this.emit('final', '');
  }

  async stop(): Promise<string> {
    this.userStopped = true;

    if (this.usingTranscribe) {
      return await this.stopMediaRecorder();
    }

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        /* ignore */
      }
      // Wait for the engine to settle — Chrome can take 800-1500ms to promote
      // the tail audio into a final result after stop().
      await new Promise<void>((resolve) => {
        const handler = () => {
          this.off('end', handler);
          resolve();
        };
        this.on('end', handler);
        setTimeout(() => resolve(), 3000);
      });
    }

    return await this.finalize(this.finalText + ' ' + this.interimText);
  }

  abort(): void {
    this.userStopped = true;
    this.recognition?.abort();
    this.recognition = null;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch { /* ignore */ }
    }
    this.releaseMicStream();
  }

  destroy(): void {
    this.abort();
    this.listeners.clear();
  }

  /** True once a full warmUp() (device + engine) has completed. Prevents
   *  redundant warmups on every incidental gesture. */
  private warmedUp = false;

  /**
   * Pre-warm the entire STT pipeline so the FIRST real voice gesture
   * isn't eaten by browser cold-start latency. Three things get warm:
   *
   *   1. **Microphone permission**. If state is `prompt` we trigger
   *      the browser's permission UI here, NOT on the user's first
   *      Space-hold — so the gesture's critical path stays clean.
   *   2. **Audio device handle**. We open + immediately close a
   *      `getUserMedia` stream. The OS-level open is the slowest part
   *      of `getUserMedia` once permission is granted (300-800ms cold,
   *      <50ms warm) — touching it here pre-pays the cost.
   *   3. **SpeechRecognition / Google STT TLS handshake**. We spawn a
   *      `SpeechRecognition`, call `start()`, and abort it. Even a
   *      no-speech run establishes the persistent connection to Google's
   *      STT endpoint that the next real run reuses.
   *
   * Two call points work well:
   *   - On `onMount` if permission is already `granted` (returning
   *     visitor) — no gesture required, totally silent.
   *   - On the first user gesture (`pointerdown` / `keydown`) for the
   *     `prompt` case — triggers the permission UI off the critical
   *     path.
   *
   * Idempotent. Subsequent calls after a successful warmup are no-ops.
   * Pass `{ force: true }` to re-warm e.g. after a long idle period.
   */
  async warmUp(
    opts: { force?: boolean; warmEngine?: boolean } = {},
  ): Promise<'granted' | 'prompt' | 'denied' | 'unavailable'> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return 'unavailable';
    }
    if (this.warmedUp && !opts.force) return 'granted';

    // 1) Permission state. Skip the prompt path on denied — calling
    //    getUserMedia again on a denied origin just re-fails.
    if (navigator.permissions?.query) {
      try {
        const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (status.state === 'denied') return 'denied';
      } catch {
        /* Some engines (Firefox, embedded webviews) don't expose
           `microphone` in the Permissions API. Fall through to the
           getUserMedia probe — slightly more invasive but works
           everywhere. */
      }
    }

    // 2) Open the audio device. Triggers the permission UI on first
    //    visit; cheap once granted (OS just hands back a handle).
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      return (err as { name?: string })?.name === 'NotAllowedError' ? 'denied' : 'prompt';
    }
    // Release immediately — Web Speech will open its own stream when a
    // real gesture fires. Keeping ours open here would leave the mic
    // icon lit in the tab bar and look creepy.
    stream.getTracks().forEach((t) => t.stop());

    // We deliberately do NOT pre-spawn a SpeechRecognition here. The
    // first real `start()` will do its own TLS handshake to Google's
    // STT endpoint — that 200-500ms ramp-up lands well inside the
    // user's first long-press hold (typically 1-2s). Spawning a
    // recognition for warmup risks colliding with the real one (Web
    // Speech rejects concurrent `start()` with InvalidStateError)
    // and the symptom is identical to "voice did nothing" — exactly
    // the bug we were trying to prevent.
    void opts.warmEngine; // accepted-but-ignored for API stability

    this.warmedUp = true;
    return 'granted';
  }

  /** Abort any in-flight warmup recognition. Defensive no-op now that
   *  warmUp() doesn't spawn one, but kept on the class so call-sites
   *  (e.g. start()) don't need to know whether engine warmup happened. */
  private abortWarmup(): void {
    if (!this.warmupRecognition) return;
    try { this.warmupRecognition.abort(); } catch { /* ignore */ }
    this.warmupRecognition = null;
  }

  // ─── Web Speech path ─────────────────────────────────────────────

  private startWebSpeech(): void {
    const Recognition =
      (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition })
        .webkitSpeechRecognition;
    if (!Recognition) {
      this.emit('error', { code: 'not-supported', message: 'webkitSpeechRecognition missing' });
      this.emit('final', '');
      return;
    }
    // Pre-prompt for mic via getUserMedia, then immediately close the
    // stream. Web Speech's implicit permission ask is flakier than
    // getUserMedia — Edge/Chrome sometimes fire a fast `network` error
    // when the mic permission was never asked. Explicit ask makes the
    // permission state clear before recognition starts.
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          // Release immediately — Web Speech will open its own stream.
          stream.getTracks().forEach((t) => t.stop());
          this.spawnRecognition(Recognition);
        })
        .catch((err) => {
          const code = (err as { name?: string })?.name === 'NotAllowedError'
            ? 'not-allowed' : 'audio-capture';
          this.emit('error', { code, message: 'microphone permission needed' });
          this.emit('final', '');
        });
      return;
    }
    this.spawnRecognition(Recognition);
  }

  private spawnRecognition(Ctor: typeof SpeechRecognition): void {
    const rec = new Ctor();
    rec.lang = this.config.language;
    rec.continuous = this.config.continuous;
    rec.interimResults = this.config.interimResults;

    rec.onstart = () => this.emit('start');

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const alt = result[0];
        if (!alt) continue;
        if (result.isFinal) final += alt.transcript;
        else interim += alt.transcript;
      }
      if (final) {
        this.finalText += final;
        this.interimText = '';
        this.emit('interim', this.finalText + interim);
      } else if (interim) {
        this.interimText = interim;
        this.emit('interim', this.finalText + interim);
      }
    };

    rec.onerror = (e: Event) => {
      const errCode = (e as unknown as { error?: string }).error;
      const errMessage = (e as unknown as { message?: string }).message;
      const friendly =
        errCode === 'not-allowed'    ? 'microphone permission denied' :
        errCode === 'no-speech'      ? 'no speech detected' :
        errCode === 'audio-capture'  ? 'audio capture failed (mic hardware?)' :
        errCode === 'network'        ? 'speech recognition network error' :
        errCode === 'aborted'        ? 'recognition aborted' :
        errCode === 'not-supported'  ? 'language not supported' :
        errCode ?? 'unknown speech recognition error';
      // Raw diagnostics surface — the friendly string above is what reaches
      // the user-facing subtitle, but for debugging "voice fails on first
      // try" we need the actual SpeechRecognitionErrorEvent fields so the
      // developer can see whether it's permission state, network, or the
      // engine itself bailing. Inspect `window.__dddkDebug.lastVoiceError`
      // for the captured snapshot.
      console.warn('[dddk voice] STT error', {
        code: errCode,
        message: errMessage,
        friendly,
        raw: e,
        recognitionLang: rec.lang,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        timestamp: new Date().toISOString(),
      });
      if (typeof window !== 'undefined') {
        const w = window as unknown as { __dddkDebug?: { lastVoiceError?: unknown; lastVoiceErrorAt?: string } };
        w.__dddkDebug = w.__dddkDebug ?? {};
        w.__dddkDebug.lastVoiceError = {
          code: errCode,
          message: errMessage,
          friendly,
          raw: { type: e.type, timeStamp: e.timeStamp },
        };
        w.__dddkDebug.lastVoiceErrorAt = new Date().toISOString();
      }
      this.emit('error', { code: errCode, message: friendly, raw: e });
      // Stop the auto-restart loop on fatal errors. `network` is included
      // because Web Speech sends audio to Google's STT servers — if that
      // network path is blocked (firewall / VPN / no internet), restarting
      // just hits the same wall in a loop and spams the user with the
      // same error subtitle. Treat the first network failure as fatal
      // for THIS gesture; the user can try again later.
      if (
        errCode === 'not-allowed' ||
        errCode === 'audio-capture' ||
        errCode === 'not-supported' ||
        errCode === 'network'
      ) {
        this.userStopped = true;
      }
    };

    rec.onend = () => {
      this.recognition = null;
      // Auto-restart: if the user is still holding the gesture (no manual
      // stop() yet), the engine likely auto-ended due to a silence pause
      // (Android Chrome / iOS Safari are the main culprits). Spawn a fresh
      // recognition and keep accumulating into the same finalText.
      if (!this.userStopped && this.config.autoRestartOnEnd) {
        try {
          this.spawnRecognition(Ctor);
          return;
        } catch (err) {
          this.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
      }
      this.emit('end');
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch (err) {
      this.recognition = null;
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      this.emit('final', '');
    }
  }

  // ─── MediaRecorder + host transcribe path ────────────────────────

  private async startMediaRecorder(): Promise<void> {
    if (!this.config.transcribe) {
      this.emit('error', { code: 'not-supported', message: 'no host transcribe provided' });
      this.emit('final', '');
      return;
    }
    if (!this.mediaRecorderSupported) {
      this.emit('error', { code: 'not-supported', message: 'MediaRecorder unavailable' });
      this.emit('final', '');
      return;
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const errCode = (err as { name?: string })?.name;
      this.emit('error', {
        code: errCode === 'NotAllowedError' ? 'not-allowed' : 'audio-capture',
        message: errCode === 'NotAllowedError'
          ? 'microphone permission denied'
          : 'failed to access microphone',
        raw: err,
      });
      this.emit('final', '');
      return;
    }

    const mime = getMediaRecorderMime();
    try {
      this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType: mime });
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      this.releaseMicStream();
      this.emit('final', '');
      return;
    }

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.mediaChunks.push(e.data);
    };

    this.mediaRecorder.onstart = () => this.emit('start');
    this.mediaRecorder.onerror = (e) => {
      this.emit('error', e);
    };

    try {
      this.mediaRecorder.start();
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      this.releaseMicStream();
      this.emit('final', '');
    }
  }

  private async stopMediaRecorder(): Promise<string> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      this.emit('end');
      return await this.finalize('');
    }
    const mime = this.mediaRecorder.mimeType || getMediaRecorderMime();
    await new Promise<void>((resolve) => {
      this.mediaRecorder!.onstop = () => resolve();
      try {
        this.mediaRecorder!.stop();
      } catch {
        resolve();
      }
    });
    this.emit('end');
    this.releaseMicStream();

    if (this.mediaChunks.length === 0) return await this.finalize('');
    const blob = new Blob(this.mediaChunks, { type: mime });

    try {
      const text = await this.config.transcribe!(blob, {
        language: this.config.language,
        mimeType: mime,
      });
      return await this.finalize(text);
    } catch (err) {
      this.emit('error', {
        code: 'transcribe-failed',
        message: 'host transcribe function threw',
        raw: err,
      });
      return await this.finalize('');
    }
  }

  private releaseMicStream(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    this.mediaRecorder = null;
  }

  // ─── Shared finalization ─────────────────────────────────────────

  private async finalize(rawText: string): Promise<string> {
    const raw = rawText.trim();
    if (!raw) {
      this.emit('final', '');
      return '';
    }
    if (this.config.cleanupWithLLM !== false && this.config.llm) {
      try {
        const cleaned = await this.cleanup(raw);
        this.emit('final', cleaned);
        return cleaned;
      } catch (err) {
        console.warn('[voice] LLM cleanup failed, returning raw:', err);
      }
    }
    this.emit('final', raw);
    return raw;
  }

  private async cleanup(raw: string): Promise<string> {
    // Pick the cleanup prompt by configured language. We branch on the
    // language prefix so `zh-TW`, `zh-CN`, `zh` etc. all match the
    // Chinese cleanup; everything else (en, ja, etc.) falls back to the
    // English-language cleanup. Host override via `cleanupPrompt`
    // bypasses this branch entirely (advanced use case — translating to
    // a specific tone, domain glossary, etc.).
    // Single universal English prompt. Reply language is determined by
    // the INPUT transcript, not by a per-language branch — so this works
    // for any number of languages (en, zh, ja, ko, es, ar, …) without
    // the SDK shipping 20+ prompt variants.
    //
    // Language hint: if `config.language` is set (a BCP-47 tag from STT
    // config like 'zh-TW' / 'en-US'), we pass it to the LLM as a soft
    // hint. The LLM is told to trust the actual transcript over the hint
    // when they disagree, so a Japanese user on a zh-TW-configured site
    // still gets a Japanese cleanup. Override the entire prompt by
    // setting `config.cleanupPrompt` — your prompt must handle language
    // detection itself.
    const langHint = this.config.language
      ? `\n\nLanguage hint from STT config: ${this.config.language}. Trust the actual transcript content over this hint if they disagree.`
      : '';
    const system =
      this.config.cleanupPrompt ??
      (`You are a speech-to-text post-processor.

Rules:
- Detect the language(s) of the transcript and ALWAYS reply in the SAME language(s). If the speaker mixes multiple languages, preserve all of them — do not translate.
- Add correct punctuation and capitalisation appropriate to the detected language.
- Remove filler words (the equivalents of "um", "uh", "you know", "like", "I mean" in the speaker's language).
- Fix obvious homophone errors.
- Handle self-corrections: when the speaker corrects themselves mid-utterance (any phrasing equivalent to "X — no wait, Y" / "X, I mean Y" / "make it X, actually Y"), keep ONLY the final intended meaning and drop the misspoken part.
- Preserve the speaker's original tone and register — do not rewrite into formal style.
- Output the cleaned transcript ONLY. No preface, no explanation, no surrounding quotes, no markdown.${langHint}`);
    const llm = resolveLLM(this.config.llm!, 'voiceCleanup');
    const response = await llm.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: raw },
      ],
      // Literal text fix — no chain-of-thought needed. Critical on Gemma 4
      // which otherwise burns ~700 thought tokens before any answer and
      // truncates with MAX_TOKENS.
      thinking: 'off',
      temperature: 0.2,
      maxTokens: 500,
    });
    return response.content.trim() || raw;
  }
}
