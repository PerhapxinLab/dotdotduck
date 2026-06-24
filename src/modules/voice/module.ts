/**
 * Voice module — wraps the bundled Voice (STT) + TTS into one dddk-friendly module.
 */

import { Voice, type VoiceConfig, type AudioTranscriber } from './voice';
import { TTS, type TTSConfig } from './tts';
import type { LLMSource } from '../../agent/llm/router';
import type { Subtitle } from '../../ui/subtitle';
import { sdkString } from '../../utils/sdk-i18n';

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
  /**
   * UI label shown in the subtitle indicator while listening. When
   * omitted, falls back to the SDK i18n stub keyed by `locale`
   * (`'Listening'` / `'聽取中'`).
   */
  listeningLabel?: string;
  /**
   * UI label shown when the browser doesn't support STT. When omitted,
   * falls back to the SDK i18n stub keyed by `locale`.
   */
  unsupportedLabel?: string;
  /**
   * Locale tag used to pick SDK i18n fallbacks for `listeningLabel` /
   * `unsupportedLabel` when the host doesn't supply explicit overrides.
   * Defaults to `'en'`. Hosts can call `setLocale(...)` at runtime to
   * switch (e.g. when the user toggles UI language).
   *
   * @since v0.2.0
   */
  locale?: string;
  /**
   * Default `true`. When enabled, `captureOnce` returns `null` for any
   * capture that resolves to whitespace-only text — empty utterance,
   * timeout, browser-unsupported, denied permission. Hosts can then write
   * a single `if (!text) return;` guard instead of repeating `.trim()`
   * checks everywhere. Set `false` if you want the raw transcript
   * (including empty / whitespace-only) at the host boundary.
   */
  skipEmptyTranscript?: boolean;
}

export class VoiceModule {
  readonly stt: Voice;
  readonly tts: TTS;
  private autoSpeakSubtitles: boolean;
  private captureTimeoutMs: number;
  private listeningLabelOverride: string | undefined;
  private unsupportedLabelOverride: string | undefined;
  private locale: string;
  private skipEmptyTranscript: boolean;

  constructor(config: VoiceModuleConfig = {}) {
    this.stt = new Voice({
      ...config.stt,
      llm: config.stt?.llm ?? config.llm,
    });
    this.tts = new TTS(config.tts ?? {});
    this.autoSpeakSubtitles = config.autoSpeakSubtitles ?? false;
    this.captureTimeoutMs = config.captureTimeoutMs ?? 30_000;
    this.locale = config.locale ?? 'en';
    this.listeningLabelOverride = config.listeningLabel;
    this.unsupportedLabelOverride = config.unsupportedLabel;
    this.skipEmptyTranscript = config.skipEmptyTranscript ?? true;
  }

  /** Resolved listening label — host override if set, else SDK i18n fallback. */
  private get listeningLabel(): string {
    return this.listeningLabelOverride ?? sdkString(this.locale, 'voice.listening');
  }

  /** Resolved unsupported label — host override if set, else SDK i18n fallback. */
  private get unsupportedLabel(): string {
    return this.unsupportedLabelOverride ?? sdkString(this.locale, 'voice.unsupported');
  }

  /**
   * Switch the locale used for the SDK i18n fallback labels at runtime.
   * Hosts call this when the user toggles UI language. Has no effect on
   * labels the host has explicitly overridden via constructor config.
   *
   * @since v0.2.0
   */
  setLocale(locale: string): void {
    this.locale = locale;
  }

  /**
   * Capture one utterance, return the trimmed transcript.
   *
   * Default behaviour (`skipEmptyTranscript: true`): empty / whitespace
   * / timeout / unsupported all resolve to `null`. Hosts write a single
   * `if (!text) return;` guard instead of repeating `.trim()` checks
   * and accidentally feeding empty queries to the webagent.
   *
   * Disable with `skipEmptyTranscript: false` to receive the raw
   * transcript at the host boundary (empty string for nothing captured).
   */
  async captureOnce(subtitle?: Subtitle): Promise<string | null> {
    if (!this.stt.isSupported()) {
      subtitle?.show({
        text: this.unsupportedLabel,
        type: 'info',
        autoHide: 2000,
      });
      return this.skipEmptyTranscript ? null : '';
    }

    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        this.stt.off('final', handler);
        this.stt.off('start', onStart);
        if (timer != null) clearTimeout(timer);
        subtitle?.hideIndicator();
      };
      // Normalise the resolved value against the skipEmptyTranscript flag.
      // raw → null when empty (and skipping), trimmed string otherwise.
      const finish = (raw: string): void => {
        const trimmed = raw.trim();
        if (this.skipEmptyTranscript) {
          resolve(trimmed.length === 0 ? null : trimmed);
        } else {
          resolve(raw);
        }
      };
      const handler = (text: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        finish(String(text ?? ''));
      };
      // The STT engine fires `start` when the mic is actually captured —
      // that's AFTER the permission grant + browser-side warmup. We
      // delay the "Listening" indicator until that moment so the first-
      // use case (user holds the button, browser is prompting for mic
      // permission) doesn't show a label promising audio capture before
      // any audio is actually being captured. Until then we show the
      // generic processing indicator so the bar isn't empty during the
      // ~hundreds-of-ms preparing window.
      const onStart = (): void => {
        if (settled) return;
        subtitle?.showIndicator('listening', this.listeningLabel);
      };
      this.stt.on('start', onStart);
      this.stt.on('final', handler);
      // Failsafe: some STT engines (or denied permissions) never fire 'final'.
      // Caller-configurable upper bound so the indicator doesn't hang forever.
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        try { this.stt.stop(); } catch { /* ignore */ }
        finish('');
      }, this.captureTimeoutMs);
      subtitle?.showIndicator('processing');
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
