/**
 * Language switcher — exposes palette commands to switch site / dddk locale.
 */

import type { CommandPalette, PaletteItem } from '../triggers/command-palette';
import type { StorageAdapter } from '../types';

export interface LanguageSwitcherConfig {
  available: Array<{ code: string; label: string }>;
  current?: string;
  storage?: StorageAdapter;
  storageKey?: string;
  /** Called when user picks a language. Host applies to its i18n layer. */
  onChange: (code: string) => void;
}

export class LanguageSwitcherModule {
  private cfg: LanguageSwitcherConfig & { storageKey: string };
  private current: string;

  constructor(config: LanguageSwitcherConfig) {
    this.cfg = { storageKey: 'dddk.language', ...config };
    const stored = this.cfg.storage?.get(this.cfg.storageKey);
    this.current =
      stored ??
      config.current ??
      (typeof navigator !== 'undefined' ? navigator.language : 'en');
  }

  getCurrent(): string {
    return this.current;
  }

  switch(code: string): void {
    if (this.current === code) return;
    this.current = code;
    this.cfg.storage?.set(this.cfg.storageKey, code);
    this.cfg.onChange(code);
  }

  paletteCommands(): PaletteItem[] {
    return this.cfg.available.map((lang) => ({
      id: `lang-${lang.code}`,
      name: lang.label,
      description: lang.code === this.current ? '✓ 目前' : undefined,
      section: 'Language',
      icon: '文',
      handler: (p) => {
        this.switch(lang.code);
        p.close();
      },
    }));
  }

  registerOn(palette: CommandPalette): void {
    for (const cmd of this.paletteCommands()) palette.addItem(cmd);
  }
}
