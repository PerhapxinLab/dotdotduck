/**
 * Voice module — wraps the bundled Voice (STT) + TTS into one dddk-friendly module.
 */

import { Voice, type VoiceConfig, type AudioTranscriber } from './voice';
import { TTS, type TTSConfig } from './tts';
import type { LLMSource } from '../../agent/llm/router';
import type { Subtitle } from '../../ui/subtitle';

export type { AudioTranscriber } from './voice';

export interface VoiceModuleConfig {
  /** STT (Speech-to-Text) — defaults to Web Speech API. */
  stt?: VoiceConfig;
  /** TTS (Text-to-Speech) — defaults to Web Speech API. */
  tts?: TTSConfig;
  /** LLMProvider or LLMRouter — `voiceCleanup` role is used for transcript cleanup. */
  llm?: LLMSource;
  /** Auto-speak agent subtitles. Default false. */
  autoSpeakSubtitles?: boolean;
  /**
   * Upper bound for a single voice capture. Default 30s — if STT never fires
   * `final` (e.g. permission silently denied, engine hung), the awaiting
   * caller resolves with empty string after this many ms instead of waiting
   * forever.
   */
  captureTimeoutMs?: number;
  /** UI label shown in the subtitle indicator while listening. */
  listeningLabel?: string;
  /** UI label shown when the browser doesn't support STT. */
  unsupportedLabel?: string;
}

export class VoiceModule {
  readonly stt: Voice;
  readonly tts: TTS;
  private autoSpeakSubtitles: boolean;
  private captureTimeoutMs: number;
  private listeningLabel: string;
  private unsupportedLabel: string;

  constructor(config: VoiceModuleConfig = {}) {
    this.stt = new Voice({
      ...config.stt,
      llm: config.stt?.llm ?? config.llm,
    });
    this.tts = new TTS(config.tts ?? {});
    this.autoSpeakSubtitles = config.autoSpeakSubtitles ?? false;
    this.captureTimeoutMs = config.captureTimeoutMs ?? 30_000;
    this.listeningLabel = config.listeningLabel ?? 'Listening — release to send';
    this.unsupportedLabel = config.unsupportedLabel ?? 'This browser does not support voice input';
  }

  /** Helper: capture one utterance, return cleaned text. */
  async captureOnce(subtitle?: Subtitle): Promise<string> {
    if (!this.stt.isSupported()) {
      subtitle?.show({
        text: this.unsupportedLabel,
        type: 'info',
        autoHide: 2000,
      });
      return '';
    }

    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        this.stt.off('final', handler);
        if (timer != null) clearTimeout(timer);
        subtitle?.hideIndicator();
      };
      const handler = (text: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(String(text ?? ''));
      };
      this.stt.on('final', handler);
      // Failsafe: some STT engines (or denied permissions) never fire 'final'.
      // Caller-configurable upper bound so the indicator doesn't hang forever.
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        try { this.stt.stop(); } catch { /* ignore */ }
        resolve('');
      }, this.captureTimeoutMs);
      subtitle?.showIndicator('listening', this.listeningLabel);
      this.stt.start();
    });
  }

  /**
   * Pre-warm the mic permission. Forwards to the underlying `Voice.warmUp()` —
   * see that doc for why. Resolves with the permission state.
   */
  warmUp(): Promise<'granted' | 'prompt' | 'denied' | 'unavailable'> {
    return this.stt.warmUp();
  }

  async speakSubtitle(text: string): Promise<void> {
    if (!this.autoSpeakSubtitles) return;
    if (!this.tts.isSupported()) return;
    await this.tts.speak(text);
  }

  setAutoSpeak(enabled: boolean): void {
    this.autoSpeakSubtitles = enabled;
    if (!enabled) this.tts.stop();
  }

  destroy(): void {
    this.stt.destroy();
    this.tts.destroy();
  }
}
