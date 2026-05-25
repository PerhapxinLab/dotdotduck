/**
 * Built-in feature modules — opt-in capabilities that COMPOSE the lower layers
 * (agent / triggers / ui) into a single `dddk.modules.X.enable()` API.
 *
 * Not in this folder anymore:
 *   - InlineAgent / AgentCursor  → `dddk/agent`  (they ARE agent engines)
 *   - Dwell / MobileTrigger      → `dddk/triggers`  (they ARE input surfaces)
 */

export { ImmersiveTranslate, type ImmersiveTranslateConfig } from './immersive-translate';
export { VoiceModule, type VoiceModuleConfig, type AudioTranscriber } from './voice';
export { ThemeToggleModule, type ThemeToggleConfig } from './theme-toggle';
export { LanguageSwitcherModule, type LanguageSwitcherConfig } from './language-switcher';
export {
  FormAssistModule,
  inspectForm,
  type FormAssistConfig,
  type FormAssistInfo,
} from './form-assist';
export { OnboardingModule, type OnboardingConfig } from './onboarding';
export { PinnedPanelRegistry } from './pinned-panel';
export type {
  PinnedPanelHandle,
  PinnedPanelSpec,
  PinnedPanelPlacement,
} from './pinned-panel';
export * as proactive from './proactive';
export * as analytics from './analytics';
