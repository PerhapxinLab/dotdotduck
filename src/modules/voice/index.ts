/**
 * Voice module — STT (Voice) + TTS, wrapped as a single dddk-friendly module.
 */

export { VoiceModule, type VoiceModuleConfig } from './module';
export { Voice, type VoiceConfig, type AudioTranscriber } from './voice';
export { TTS, type TTSConfig, type TTSProvider } from './tts';
