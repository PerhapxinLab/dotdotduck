/**
 * Theme toggle — switch between light / dark / system. Registers a palette command.
 */

import type { CommandPalette, PaletteItem } from '../triggers/command-palette';
import type { StorageAdapter } from '../types';
import { sdkString } from '../utils/sdk-i18n';

export type ThemeValue = 'light' | 'dark' | 'system';

export interface ThemeToggleConfig {
  storage?: StorageAdapter;
  /** Attribute to set on <html>. Default 'data-theme'. */
  attribute?: string;
  /** Storage key. Default 'dddk.theme'. */
  storageKey?: string;
  /** Locale used for the palette command names — `en` / `zh-TW` ship
   *  bundled, anything else falls back to English. Default `en`. */
  locale?: string;
  /** Callback when theme changes. */
  onChange?: (theme: ThemeValue) => void;
}

export class ThemeToggleModule {
  private cfg: Required<Pick<ThemeToggleConfig, 'attribute' | 'storageKey'>> & ThemeToggleConfig;
  private mediaQuery?: MediaQueryList;

  constructor(config: ThemeToggleConfig = {}) {
    this.cfg = {
      attribute: 'data-theme',
      storageKey: 'dddk.theme',
      ...config,
    };
  }

  apply(theme?: ThemeValue): ThemeValue {
    const target = theme ?? this.read();
    const effective = target === 'system' ? this.systemPreference() : target;

    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute(this.cfg.attribute, effective);
    }
    this.cfg.storage?.set(this.cfg.storageKey, target);
    this.cfg.onChange?.(target);

    if (target === 'system') this.bindSystemListener();
    else this.unbindSystemListener();

    return target;
  }

  read(): ThemeValue {
    const stored = this.cfg.storage?.get(this.cfg.storageKey);
    return (stored as ThemeValue | null | undefined) ?? 'system';
  }

  toggle(): ThemeValue {
    const cur = this.read();
    const next: ThemeValue = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
    return this.apply(next);
  }

  private systemPreference(): 'light' | 'dark' {
    if (typeof window === 'undefined' || !window.matchMedia) return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private bindSystemListener(): void {
    if (typeof window === 'undefined' || !window.matchMedia || this.mediaQuery) return;
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.mediaQuery.addEventListener('change', this.onSystemChange);
  }

  private unbindSystemListener(): void {
    if (this.mediaQuery) {
      this.mediaQuery.removeEventListener('change', this.onSystemChange);
      this.mediaQuery = undefined;
    }
  }

  private onSystemChange = () => {
    if (this.read() === 'system') this.apply('system');
  };

  paletteCommands(): PaletteItem[] {
    const loc = this.cfg.locale;
    return [
      {
        id: 'theme-light',
        name: sdkString(loc, 'palette.theme.light'),
        section: 'Appearance',
        icon: '○',
        handler: (p) => {
          this.apply('light');
          p.close();
        },
      },
      {
        id: 'theme-dark',
        name: sdkString(loc, 'palette.theme.dark'),
        section: 'Appearance',
        icon: '●',
        handler: (p) => {
          this.apply('dark');
          p.close();
        },
      },
      {
        id: 'theme-system',
        name: sdkString(loc, 'palette.theme.system'),
        section: 'Appearance',
        icon: '◐',
        handler: (p) => {
          this.apply('system');
          p.close();
        },
      },
    ];
  }

  registerOn(palette: CommandPalette): void {
    for (const cmd of this.paletteCommands()) palette.addItem(cmd);
  }
}
