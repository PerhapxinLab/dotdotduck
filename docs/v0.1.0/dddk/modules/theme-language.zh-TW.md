# ThemeToggle + LanguageSwitcher — 兩個小工具 module

> 兩個很小的 module 合在一篇講，因為每個都只有一條 palette 指令加一個 callback。ThemeToggle 負責 `<html>` 上的 `data-theme` 屬性；LanguageSwitcher 什麼都不負責 — 只在使用者選語言時 call 你的 i18n 層。

兩個都 opt-in。兩個都用 `.registerOn(palette)` 註冊 palette 指令。

## 什麼時候用

- ThemeToggle：任何想要 light / dark / system 但不想自己寫持久化 + 系統偏好監聽的 app
- LanguageSwitcher：i18n 層已經有了，只需要一個從 palette 切換語言的入口

不要用：

- 你的 header 已經有 theme toggle — 直接 `document.documentElement.dataset.theme = 'dark'`，不需要 module
- 語言清單會 per-user 變動（例如只給訂閱了某語言的使用者看）— 自己包一個 wrapper，或乾脆手動 register palette items

---

## ThemeToggle

### Import

```ts
import { ThemeToggleModule } from '@perhapxin/dddk';
import type { ThemeToggleConfig } from '@perhapxin/dddk';
```

### 最小設定

```ts
import { ThemeToggleModule } from '@perhapxin/dddk';

const theme = new ThemeToggleModule({
  storage: localStorageAdapter,   // optional 但建議帶
  onChange: (val) => console.log('theme is now', val),
});

theme.apply();                    // 套用已存的偏好（沒有就 'system'）
theme.registerOn(dddk.palette);   // 加 /theme 指令
```

Palette 會出現三條指令：主題：亮色 / 主題：暗色 / 主題：跟隨系統。

### 設定

| Option | Default | 說明 |
| --- | --- | --- |
| `storage` | — | `StorageAdapter`。沒有的話 reload 後偏好就忘了。 |
| `attribute` | `'data-theme'` | 要設在 `<html>` 上的屬性。 |
| `storageKey` | `'dddk.theme'` | Storage key。 |
| `onChange` | — | `(theme: 'light' \| 'dark' \| 'system') => void`。 |

### Runtime API

```ts
theme.apply('dark');     // 設定並持久化
theme.apply();           // 重新套用目前偏好（hydration 後好用）
theme.read();            // 目前偏好：'light' | 'dark' | 'system'
theme.toggle();          // light → dark → system → light → ...
```

### System 模式

偏好是 `'system'` 時 ThemeToggleModule 會訂閱 `matchMedia('(prefers-color-scheme: dark)')`，系統設定變了就重新套用。明確選 `'light'` 或 `'dark'` 會 unsubscribe — 使用者的覆寫贏。

### 或者直接設屬性

不需要 palette 指令就：

```ts
document.documentElement.dataset.theme = 'dark';
```

所有 dddk surface 都靠 CSS token 重繪。完整 token 清單 + 自訂模式（sepia、高對比）看 [../theming.md](../theming.md)。

---

## LanguageSwitcher

### Import

```ts
import { LanguageSwitcherModule } from '@perhapxin/dddk';
import type { LanguageSwitcherConfig } from '@perhapxin/dddk';
```

### 最小設定

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

lang.registerOn(dddk.palette);   // 加 /language 指令
```

每個語言一條 palette 指令。目前語言會在 palette 標 `✓ 目前`。

### 設定

| Option | Default | 說明 |
| --- | --- | --- |
| `available` | — | `Array<{ code, label }>`。必填。 |
| `current` | `navigator.language` | 起始語言。 |
| `storage` | — | `StorageAdapter`。持久化選的 code。 |
| `storageKey` | `'dddk.language'` | Storage key。 |
| `onChange` | — | `(code) => void`。必填。 |

### Runtime API

```ts
lang.getCurrent();       // 目前 code
lang.switch('ja');       // 程式化切換（會 fire onChange）
```

### dddk **不**接管你的 i18n

`LanguageSwitcherModule` 只是 palette 指令 + 持久化層。實際套用 locale 由你的 app 負責 — `onChange` 是接縫。常見接法：

```ts
// next-intl
onChange: (code) => router.replace({}, { locale: code });

// sveltekit-i18n
onChange: (code) => locale.set(code);

// vue-i18n
onChange: (code) => (i18n.global.locale.value = code);
```

dddk 內建的 module（Voice、InlineAgent、ImmersiveTranslate）自己有 `locale` 設定 — `LanguageSwitcher` **不會**自動 push 給它們。需要的話自己 mirror：

```ts
onChange: (code) => {
  yourI18n.setLocale(code);
  inline.setActions(buildActionsFor(code));  // 範例
};
```

---

## Tear-down

兩個 module 都沒有 DOM。ThemeToggleModule 在切離 `'system'` 時會自動 unsubscribe `matchMedia`。要完全 detach 可以重建 palette 但不掛它們的指令，或對每條呼叫 `palette.removeItem(id)`。

也看：[../theming.md](../theming.md) ThemeToggle 驅動的 CSS token 系統；[./overview.md](./overview.md) module 索引。
