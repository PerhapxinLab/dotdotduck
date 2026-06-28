# ThemeToggle + LanguageSwitcher — small utility modules

> Two tiny modules grouped together because each is one palette command plus a callback. ThemeToggle owns the `data-theme` attribute on `<html>`; LanguageSwitcher owns nothing — it just calls your i18n layer when the user picks a language.

Both opt-in. Both register palette commands via `.registerOn(palette)`.

## When to use

- ThemeToggle: any app that wants light / dark / system without writing the persistence + system-preference-listener glue
- LanguageSwitcher: any app whose i18n layer already exists and you just need a discoverable way to switch locales from the palette

Don't use when:

- You already ship a theme toggle in your own header — call `document.documentElement.dataset.theme = 'dark'` directly, no module needed
- Your locale list changes per-user (e.g. only the languages the user has bought a subscription for) — wrap the module yourself or just register the palette items manually

---

## ThemeToggle

### Import

```ts
import { ThemeToggleModule } from '@perhapxin/dddk';
import type { ThemeToggleConfig } from '@perhapxin/dddk';
```

### Minimum setup

```ts
import { ThemeToggleModule } from '@perhapxin/dddk';

const theme = new ThemeToggleModule({
  storage: localStorageAdapter,   // optional but recommended
  onChange: (val) => console.log('theme is now', val),
});

theme.apply();                    // apply stored preference (or 'system')
theme.registerOn(dddk.palette);   // adds /theme commands
```

Three palette commands appear: 主題：亮色 / 主題：暗色 / 主題：跟隨系統.

### Configuration

| Option | Default | Description |
| --- | --- | --- |
| `storage` | — | `StorageAdapter`. If unset, preference is forgotten on reload. |
| `attribute` | `'data-theme'` | Attribute to set on `<html>`. |
| `storageKey` | `'dddk.theme'` | Storage key. |
| `onChange` | — | `(theme: 'light' \| 'dark' \| 'system') => void`. |

### Runtime API

```ts
theme.apply('dark');     // set and persist
theme.apply();           // re-apply current preference (useful after hydration)
theme.read();            // current preference: 'light' | 'dark' | 'system'
theme.toggle();          // light → dark → system → light → ...
```

### System mode

When the preference is `'system'`, ThemeToggleModule subscribes to `matchMedia('(prefers-color-scheme: dark)')` and re-applies on changes. Selecting `'light'` or `'dark'` explicitly unsubscribes — the user's override wins.

### Or just set the attribute

If you don't need the palette commands:

```ts
document.documentElement.dataset.theme = 'dark';
```

All dddk surfaces re-render via CSS tokens. See [../theming.md](../theming.md) for the full token reference plus custom modes (sepia, high-contrast).

---

## LanguageSwitcher

### Import

```ts
import { LanguageSwitcherModule } from '@perhapxin/dddk';
import type { LanguageSwitcherConfig } from '@perhapxin/dddk';
```

### Minimum setup

```ts
import { LanguageSwitcherModule } from '@perhapxin/dddk';

const lang = new LanguageSwitcherModule({
  available: [
    { code: 'en', label: 'English' },
    { code: 'zh-TW', label: '繁體中文' },
    { code: 'ja', label: '日本語' },
  ],
  current: 'en',
  storage: localStorageAdapter,
  onChange: (code) => yourI18n.setLocale(code),
});

lang.registerOn(dddk.palette);   // adds /language commands
```

One palette command per language. The current language gets a `✓ 目前` annotation in the palette.

### Configuration

| Option | Default | Description |
| --- | --- | --- |
| `available` | — | `Array<{ code, label }>`. Required. |
| `current` | `navigator.language` | Starting language. |
| `storage` | — | `StorageAdapter`. Persists the picked code. |
| `storageKey` | `'dddk.language'` | Storage key. |
| `onChange` | — | `(code) => void`. Required. |

### Runtime API

```ts
lang.getCurrent();       // current code
lang.switch('ja');       // programmatically switch (fires onChange)
```

### dddk does NOT own your i18n

`LanguageSwitcherModule` is just a palette-command + persistence layer. Your app is responsible for actually applying the locale — `onChange` is the seam. Common wirings:

```ts
// next-intl
onChange: (code) => router.replace({}, { locale: code });

// sveltekit-i18n
onChange: (code) => locale.set(code);

// vue-i18n
onChange: (code) => (i18n.global.locale.value = code);
```

The dddk built-in modules (Voice, InlineAgent, ImmersiveTranslate) have their own `locale` config — `LanguageSwitcher` does not push to them automatically. Mirror the change yourself if you need:

```ts
onChange: (code) => {
  yourI18n.setLocale(code);
  inline.setActions(buildActionsFor(code));  // example
};
```

---

## Tear-down

Neither module holds any DOM. ThemeToggleModule unsubscribes from `matchMedia` automatically when you switch away from `'system'`. To fully detach you can recreate the palette without their commands, or call `palette.removeItem(id)` for each.

See also: [../theming.md](../theming.md) for the CSS-token system ThemeToggle drives, [./overview.md](./overview.md) for the module index.
