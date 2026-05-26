/**
 * Onboarding — auto-run a ScriptSkill the first time a user visits.
 *
 * Wraps the registry pattern with:
 *   - persistent "seen" flag (so it doesn't run again unless reset)
 *   - manual "restart tour" command
 *   - optional URL-based gating (only run on specific pages)
 */

import type { ScriptSkill } from '../../skills/types';
import type { CommandPalette, PaletteItem } from '../../triggers/command-palette';
import type { StorageAdapter } from '../../types';
import { sdkString } from '../../utils/sdk-i18n';

export interface OnboardingConfig {
  /** The tour to run. */
  skill: ScriptSkill;
  /** Storage for the "seen" flag. */
  storage: StorageAdapter;
  /** Storage key. Default 'dddk.onboarding.seen.<skill.id>'. */
  storageKey?: string;
  /**
   * Only auto-run if the current pathname matches.
   * String → exact match; RegExp → tested; Array → any of.
   * Default: any page.
   */
  runOnPath?: string | RegExp | Array<string | RegExp>;
  /** Run after this delay (let host render first). Default 500ms. */
  startDelayMs?: number;
  /** Locale for the "Replay tour" palette command name. `en` / `zh-TW`
   *  ship bundled. Default `en`. */
  locale?: string;
}

export class OnboardingModule {
  private cfg: OnboardingConfig;
  private storageKey: string;

  constructor(config: OnboardingConfig) {
    this.cfg = config;
    this.storageKey = config.storageKey ?? `dddk.onboarding.seen.${config.skill.id}`;
  }

  /**
   * Call once after `dddk.mount()`. Auto-runs the skill if (a) not seen
   * before, and (b) current path matches `runOnPath`.
   */
  maybeRun(runSkill: (id: string) => Promise<void> | void): void {
    if (typeof window === 'undefined') return;
    if (this.hasSeen()) return;
    if (!this.matchesPath()) return;

    const delay = this.cfg.startDelayMs ?? 500;
    setTimeout(() => {
      Promise.resolve(runSkill(this.cfg.skill.id))
        .then(() => this.markSeen())
        .catch((err) => console.error('[Onboarding] skill error:', err));
    }, delay);
  }

  /** Mark the tour as seen — won't auto-run again. */
  markSeen(): void {
    this.cfg.storage.set(this.storageKey, '1');
  }

  /** Reset so the tour will run again next visit. */
  reset(): void {
    this.cfg.storage.remove(this.storageKey);
  }

  hasSeen(): boolean {
    const v = this.cfg.storage.get(this.storageKey);
    return v != null && v.length > 0;
  }

  /** Palette commands: re-run + reset. */
  paletteCommands(runSkill: (id: string) => Promise<void> | void): PaletteItem[] {
    return [
      {
        id: `${this.cfg.skill.id}-restart`,
        name: sdkString(this.cfg.locale, 'palette.onboarding.replay'),
        description: this.cfg.skill.name,
        icon: '▶',
        section: 'Help',
        handler: (p) => {
          p.close();
          this.reset();
          runSkill(this.cfg.skill.id);
        },
      },
    ];
  }

  registerOn(palette: CommandPalette, runSkill: (id: string) => Promise<void> | void): void {
    for (const cmd of this.paletteCommands(runSkill)) palette.addItem(cmd);
  }

  // ─── private ──────────────────────────────────────────────────────

  private matchesPath(): boolean {
    const spec = this.cfg.runOnPath;
    if (!spec) return true;
    const path = location.pathname;
    const tests = Array.isArray(spec) ? spec : [spec];
    return tests.some((t) =>
      typeof t === 'string' ? t === path : (t as RegExp).test(path)
    );
  }
}
