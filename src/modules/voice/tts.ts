/**
 * TTS — Text-to-Speech.
 * Default provider: Web Speech (free, browser-native).
 * Optional cloud providers: OpenAI tts-1, Gemini TTS — need API key.
 */

export type TTSProvider = 'web-speech' | 'openai' | 'gemini';

export interface TTSConfig {
  provider?: TTSProvider;
  voice?: string;
  rate?: number;   // 0.5 ~ 2.0
  pitch?: number;  // 0 ~ 2
  volume?: number; // 0 ~ 1
  language?: string;

  // cloud provider auth (only used when provider is 'openai' / 'gemini')
  apiKey?: string;
  model?: string;
}

type Listener = (payload?: unknown) => void;

export class TTS {
  private config: TTSConfig;
  private listeners: Map<string, Set<Listener>> = new Map();
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private currentAbort: AbortController | null = null;

  constructor(config: TTSConfig = {}) {
    this.config = {
      provider: 'web-speech',
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      ...config,
    };
  }

  isSupported(): boolean {
    if (this.config.provider === 'web-speech') {
      return typeof speechSynthesis !== 'undefined';
    }
    return typeof fetch !== 'undefined';
  }

  on(event: 'start' | 'end' | 'error', handler: Listener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }
  off(event: string, handler: Listener): void {
    this.listeners.get(event)?.delete(handler);
  }
  private emit(event: string, payload?: unknown): void {
    this.listeners.get(event)?.forEach((h) => h(payload));
  }

  async speak(text: string): Promise<void> {
    if (!text.trim()) return;
    this.stop();

    if (this.config.provider === 'web-speech') {
      return this.speakWebSpeech(text);
    } else if (this.config.provider === 'openai') {
      return this.speakOpenAI(text);
    } else if (this.config.provider === 'gemini') {
      return this.speakGemini(text);
    }
  }

  stop(): void {
    if (this.currentUtterance) {
      speechSynthesis.cancel();
      this.currentUtterance = null;
    }
    if (this.currentAudio) {
      this.currentAudio.pause();
      URL.revokeObjectURL(this.currentAudio.src);
      this.currentAudio = null;
    }
    this.currentAbort?.abort();
    this.currentAbort = null;
  }

  destroy(): void {
    this.stop();
    this.listeners.clear();
  }

  // ─── providers ──────────────────────────────────────────────────

  private speakWebSpeech(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.config.language ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
      u.rate = this.config.rate!;
      u.pitch = this.config.pitch!;
      u.volume = this.config.volume!;

      if (this.config.voice) {
        const v = speechSynthesis.getVoices().find((vv) => vv.name === this.config.voice);
        if (v) u.voice = v;
      }

      u.onstart = () => this.emit('start');
      u.onend = () => {
        this.emit('end');
        this.currentUtterance = null;
        resolve();
      };
      u.onerror = (e) => {
        this.emit('error', e);
        this.currentUtterance = null;
        reject(e);
      };

      this.currentUtterance = u;
      speechSynthesis.speak(u);
    });
  }

  private async speakOpenAI(text: string): Promise<void> {
    if (!this.config.apiKey) throw new Error('OpenAI TTS requires apiKey');
    this.currentAbort = new AbortController();
    this.emit('start');

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model ?? 'tts-1',
        input: text,
        voice: this.config.voice ?? 'alloy',
        speed: this.config.rate,
      }),
      signal: this.currentAbort.signal,
    });
    if (!response.ok) throw new Error(`OpenAI TTS HTTP ${response.status}`);

    const blob = await response.blob();
    return this.playBlob(blob);
  }

  /**
   * @experimental Google has not yet shipped a stable public TTS endpoint at
   * the time this code was written. The `gemini-2.0-flash-tts` model id below
   * is a placeholder pointing at the streaming-content API in audio-response
   * mode; the actual TTS surface may differ when Google ships it. Expect this
   * to require updates when Gemini TTS becomes GA. Use Web Speech or OpenAI
   * TTS for production.
   */
  private async speakGemini(text: string): Promise<void> {
    if (!this.config.apiKey) throw new Error('Gemini TTS requires apiKey');
    console.warn(
      '[webagent/TTS] Gemini TTS is experimental — the model id and endpoint shape may change. ' +
        'See JSDoc on speakGemini.',
    );
    // Gemini TTS endpoint (subject to API evolution). For now we use the streaming
    // model that supports audio output via PCM base64 payloads.
    this.currentAbort = new AbortController();
    this.emit('start');

    const model = this.config.model ?? 'gemini-2.0-flash-tts';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { responseMimeType: 'audio/wav' },
      }),
      signal: this.currentAbort.signal,
    });
    if (!response.ok) throw new Error(`Gemini TTS HTTP ${response.status}`);

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string; mimeType: string } }> } }>;
    };
    const part = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!part) throw new Error('Gemini TTS returned no audio');

    const bin = atob(part.data);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: part.mimeType || 'audio/wav' });
    return this.playBlob(blob);
  }

  private playBlob(blob: Blob): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.currentAudio = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        this.emit('end');
        resolve();
      };
      audio.onerror = (e) => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        this.emit('error', e);
        reject(e);
      };
      audio.play().catch(reject);
    });
  }
}
