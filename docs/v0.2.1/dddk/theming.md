# dotdotduck — Theming (CSS variable customisation)

> Different sites want different UI. Every visual value in dotdotduck reads from a CSS variable; hosts retheme by overriding those variables in their own stylesheet.

## Design principles

1. **Every visual value is a variable** — no hardcoded colours / radii / fonts in the SDK.
2. **Sensible defaults** — looks good before the host configures anything.
3. **Light + dark out of the box** — switch via `[data-theme="dark"]` on a parent.
4. **Doesn't pollute host CSS** — every dddk selector is scoped under `[data-dddk-ui]`.
5. **Global CSS variables, not Shadow DOM** — see [Shadow DOM section](#shadow-dom-and-why-we-dont-use-it) at the bottom for the rationale.

## Full variable list

### Colors (base)
```css
:root {
  --dddk-accent: #ec4899;              /* primary: highlight / button / link */
  --dddk-accent-hover: #db2777;        /* primary hover */
  --dddk-accent-soft: rgba(236, 72, 153, 0.12); /* tinted bg */

  --dddk-bg: #ffffff;                  /* subtitle bar, palette, Surface bg */
  --dddk-bg-elevated: #ffffff;         /* card bg */
  --dddk-bg-overlay: rgba(0, 0, 0, 0.45); /* modal backdrop */

  --dddk-text: #18181b;
  --dddk-text-muted: #71717a;
  --dddk-text-on-accent: #ffffff;

  --dddk-border: rgba(0, 0, 0, 0.08);
  --dddk-border-focus: var(--dddk-accent);

  --dddk-success: #00aa66;
  --dddk-warning: #ff9900;
  --dddk-error:   #cc3333;
  --dddk-info:    #3388dd;
}
```

### Spacing & sizing
```css
:root {
  --dddk-radius: 10px;
  --dddk-radius-sm: 6px;
  --dddk-radius-lg: 16px;

  --dddk-spacing-xs: 4px;
  --dddk-spacing-sm: 8px;
  --dddk-spacing-md: 12px;
  --dddk-spacing-lg: 16px;
  --dddk-spacing-xl: 24px;

  --dddk-bar-max-width: 720px;
  --dddk-palette-width: 600px;
  --dddk-palette-max-height: 480px;
  --dddk-modal-max-width: 560px;
  --dddk-dock-width: 360px;
}
```

### Typography
```css
:root {
  --dddk-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --dddk-font-mono: ui-monospace, 'SF Mono', Menlo, monospace;

  --dddk-font-size-sm: 12px;
  --dddk-font-size-md: 14px;
  --dddk-font-size-lg: 16px;

  --dddk-line-height: 1.55;
  --dddk-font-weight-medium: 500;
}
```

### Shadow & effects
```css
:root {
  --dddk-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.06);
  --dddk-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.08);
  --dddk-shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.12);

  --dddk-blur: 16px;
}
```

### z-index
```css
:root {
  --dddk-z-bar: 9700;
  --dddk-z-palette: 9600;
  --dddk-z-pointer: 9500;
  --dddk-z-cursor: 9800;
}
```

### Animation
```css
:root {
  --dddk-transition-fast: 80ms ease-out;
  --dddk-transition-md: 200ms ease-out;
  --dddk-transition-slow: 400ms ease-out;
}
```

## Dark mode

```css
[data-theme="dark"] {
  --dddk-bg: #09090b;
  --dddk-bg-elevated: #18181b;
  --dddk-text: #fafafa;
  --dddk-text-muted: #a1a1aa;
  --dddk-border: rgba(255, 255, 255, 0.1);
  --dddk-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.5);
}
```

Or use `prefers-color-scheme`:

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { /* same body */ }
}
```

## Inheriting from host design tokens

If the host already has its own design tokens:

```css
:root {
  --dddk-accent: var(--brand-primary, #ec4899);
  --dddk-bg:     var(--surface-1, #ffffff);
  --dddk-text:   var(--text-primary, #18181b);
  --dddk-radius: var(--card-radius, 10px);
  --dddk-font:   var(--font-sans, system-ui);
}
```

## Full custom example — brutalist

A customer wants a brutalist look (square corners, black borders, neon yellow):

```css
:root {
  --dddk-accent: #ffeb3b;
  --dddk-bg: #ffffff;
  --dddk-text: #000000;
  --dddk-border: #000000;
  --dddk-radius: 0;
  --dddk-radius-sm: 0;
  --dddk-radius-lg: 0;
  --dddk-shadow-md: 4px 4px 0 #000;
  --dddk-font: 'Space Grotesk', sans-serif;
}

[data-dddk-ui="bar"],
[data-dddk-ui="palette"] {
  border: 2px solid var(--dddk-border);
}
```

## DOM scoping

Everything dotdotduck renders carries a `[data-dddk-ui]` attribute:

```html
<div data-dddk-ui="bar">           <!-- subtitle bar -->
<div data-dddk-ui="palette">       <!-- palette container -->
<div data-dddk-ui="surface">       <!-- Surface (modal / inline / dock) -->
<div data-dddk-ui="spotter-ring">  <!-- Spotter ring -->
```

To target one specifically:

```css
[data-dddk-ui="bar"] {
  /* only restyle the subtitle bar */
}
```

---

## Build your own theme — cookbook

Three worked examples. In each one we override the same set of variables in roughly the same order: accent → surfaces → text → border → radius → shadow → typography. That order is deliberate — accent is the most visible, surfaces second, and so on. If you tune top-down, the result reads as a coherent theme; if you skip around, you end up with a frankenstein.

### Where the CSS rule lives

dddk doesn't load a "theme system" — there's no theme registry, no `setTheme()`. You write a CSS rule, and any element under it picks up the variables. Two common patterns:

```css
/* Pattern A: site-wide. Put this in your global stylesheet, loaded
 * after @perhapxin/dddk/styles.css so it wins on specificity tie. */
:root {
  --dddk-accent: #8B7355;
  /* ... */
}

/* Pattern B: scoped to one section. Put a class on a wrapper element. */
.docs-section {
  --dddk-accent: #8B7355;
  /* ... */
}
```

Pattern A is the right default. Pattern B is for cases like "the marketing site uses our brand colour, but the embedded admin tool uses a calmer one."

### Example 1: sepia (warm, paper-like)

Sepia palettes read as warm and low-contrast. The win is in the surface tint, not the accent.

```css
:root {
  /* accent: a muted brown, not a bright orange */
  --dddk-accent: #8B7355;
  --dddk-accent-hover: #7A6347;
  --dddk-accent-soft: rgba(139, 115, 85, 0.12);

  /* surfaces: subtle warm tint — pure #fff would break the warm feel */
  --dddk-bg: #f5ecd9;
  --dddk-bg-elevated: #faf2e0;
  --dddk-bg-overlay: rgba(60, 40, 20, 0.4);

  /* text: dark brown, not pure black; warmth carries through */
  --dddk-text: #3b2c1a;
  --dddk-text-muted: #7a6750;
  --dddk-text-on-accent: #faf2e0;

  /* border: same hue, low alpha */
  --dddk-border: rgba(80, 60, 30, 0.15);

  /* radius: soft, organic */
  --dddk-radius: 14px;
  --dddk-radius-sm: 8px;

  /* shadow: warm-tinted instead of neutral black */
  --dddk-shadow-md: 0 4px 16px rgba(80, 50, 20, 0.12);

  /* typography: a serif feels right for paper themes */
  --dddk-font: 'Iowan Old Style', Georgia, serif;
}
```

The trick is **avoiding pure white anywhere**. The moment one surface stays `#ffffff` the whole theme breaks. Hit `--dddk-bg`, `--dddk-bg-elevated`, AND `--dddk-bar-bg` (the subtitle bar has its own — see below).

### Example 2: high-contrast accessibility

For users who need maximum contrast (low vision, harsh ambient light, accessibility compliance). The win is in the borders and the shadow — *not* the accent.

```css
:root {
  /* accent: deeply saturated, contrasts hard against bg */
  --dddk-accent: #0033cc;
  --dddk-accent-hover: #002299;
  --dddk-accent-soft: rgba(0, 51, 204, 0.18);

  /* surfaces: pure white + pure black overlay */
  --dddk-bg: #ffffff;
  --dddk-bg-elevated: #ffffff;
  --dddk-bg-overlay: rgba(0, 0, 0, 0.75);

  /* text: pure black, no muted gray */
  --dddk-text: #000000;
  --dddk-text-muted: #333333;  /* not lighter than #333 */
  --dddk-text-on-accent: #ffffff;

  /* border: 1.5–2px solid black on every chrome element */
  --dddk-border: #000000;

  /* radius: small or zero — busier outlines, less rounded */
  --dddk-radius: 4px;
  --dddk-radius-sm: 2px;

  /* shadow: replaced with hard offset to mimic embossed UI */
  --dddk-shadow-sm: 2px 2px 0 #000;
  --dddk-shadow-md: 3px 3px 0 #000;
  --dddk-shadow-lg: 4px 4px 0 #000;
}

[data-dddk-ui="bar"],
[data-dddk-ui="palette"],
[data-dddk-ui="surface"] {
  border: 2px solid var(--dddk-border);
}
```

The explicit `border: 2px solid` rule is required — the default token uses `rgba(0,0,0,0.08)` which is intentionally subtle. Setting `--dddk-border: #000` alone doesn't widen the border; you also have to bump the `border-width` on the chrome elements you care about.

### Example 3: brand-coloured (e.g. a Notion-ish theme)

Match a host's existing design system. Most hosts already have a `--brand-*` token set; just bind dddk's tokens to those.

```css
:root {
  /* bind dddk to your existing tokens — fallback for safety */
  --dddk-accent:       var(--brand-primary,    #2e2e2e);
  --dddk-accent-hover: var(--brand-primary-hover, #1a1a1a);

  --dddk-bg:           var(--surface-1,        #ffffff);
  --dddk-bg-elevated:  var(--surface-2,        #f7f6f3);

  --dddk-text:         var(--text-primary,     #37352f);
  --dddk-text-muted:   var(--text-secondary,   #787774);

  --dddk-border:       var(--divider-default,  rgba(55, 53, 47, 0.09));

  --dddk-radius:       var(--radius-card,      6px);
  --dddk-font:         var(--font-sans,        'Inter', system-ui);
}
```

The `var(brand-x, fallback)` pattern is load-bearing: if a route loads before the host CSS does (rare, but happens with code-split apps), dddk still renders with the fallback rather than `unset`.

### Things to override that aren't in the base list

The subtitle bar has its own variables (because of past contrast bugs — see `dddk/src/styles/tokens.css` for the inline rationale):

```css
:root {
  --dddk-bar-bg: rgba(255, 255, 255, 0.98);
  --dddk-bar-text: var(--dddk-text);
  --dddk-bar-border: rgba(0, 0, 0, 0.12);
  --dddk-bar-shadow: 0 12px 36px rgba(0, 0, 0, 0.18),
                    0 2px 8px rgba(0, 0, 0, 0.08);
}
```

Don't assume `--dddk-bg` controls the bar. It doesn't. The bar reads `--dddk-bar-bg` so it can stay lifted against any host bg.

Palette rows also expose their own tokens (`--dddk-palette-row-bg-hover`, `--dddk-palette-row-bg-active`, `--dddk-palette-match-bg`, …). See the full list in `dddk/src/styles/tokens.css`.

### Testing checklist

After theming, verify:

- [ ] Light + dark switch correctly.
- [ ] Subtitle bar contrasts against various page backgrounds (try a light page, a hero image, a dark dashboard).
- [ ] Palette is usable at mobile / tablet / desktop widths.
- [ ] Surface modal backdrop doesn't block host sticky elements unexpectedly.
- [ ] z-index doesn't fight host modals (bump `--dddk-z-*` if so).
- [ ] Spotter ring is visible on every background colour your app uses.
- [ ] Font swap doesn't cause layout shift (preload the font).

---

## Placement-specific overrides

A Surface in `dock` placement may want different styling:

```css
[data-dddk-ui="surface"][data-dddk-placement="dock"] {
  --dddk-radius: var(--dddk-radius-sm);
  width: var(--dddk-dock-width);
  height: 100vh;
  right: 0;
}
```

## Responsive / mobile

### Default behaviour (no extra CSS needed)

| Element | Default scaling |
| --- | --- |
| Command palette | `width: var(--dddk-palette-width, 600px); max-width: 90vw` — shrinks on narrow screens |
| Subtitle bar | `max-width: 720px; width: calc(100vw - 32px)` |
| Surface modal | Whatever your placement renderer specifies; host owns this |
| Dwell frame | Pure outline, takes the element's own size — no media query needed |
| Inline AI menu | `min-width: 220px; max-width: 280px` |

All these sizes are tokens (`--dddk-palette-width`, `--dddk-bar-max-width`, `--dddk-dock-width`) — host overrides per breakpoint via `@media`.

### Recommended breakpoint

dddk doesn't enforce a breakpoint, but this is a good baseline:

```css
@media (max-width: 640px) {
  :root {
    --dddk-palette-width: 100vw;
    --dddk-palette-max-height: 70vh;
    --dddk-bar-bottom: 12px;
    --dddk-bar-padding: 10px 12px;
  }
  /* Palette slides up from bottom, not centered */
  [data-dddk-ui="palette-backdrop"] {
    padding-top: 0;
    align-items: flex-end;
  }
  [data-dddk-ui="palette"] {
    border-radius: 16px 16px 0 0;
  }
}
```

## i18n strings

Not strictly theming, but the same idea — injected via config:

```ts
new DotDotDuck({
  locale: 'zh-TW',
  i18n: {
    'zh-TW': {
      'voice.listening': '聽取中 — 鬆開結束',
      'voice.processing': '處理中...',
      'palette.placeholder': '搜尋指令或頁面內容',
    },
  },
});
```

Built-in: `en` and `zh-TW`. Other locales: host supplies.

## Font loading

dotdotduck doesn't bundle fonts. Host loads them:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --dddk-font: 'Inter', system-ui, sans-serif; }
</style>
```

---

## Shadow DOM and why we don't use it

You may have seen other widget SDKs default to Shadow DOM for style isolation. dddk **does not** — every DOM node it renders lives in the same tree as your app's DOM, and every style is regular global CSS reading variables. There's intentionally no `isolation: 'shadow'` config option.

### Why not Shadow DOM

1. **Hosts already want to theme dddk.** Shadow DOM exists to *prevent* host CSS from reaching the widget. But every dddk integration we've seen wants the opposite — match the host's brand colour, font, radius. Shadow DOM would force every theme override to be passed through a JS API or `::part()` selectors, neither of which is as flexible as global CSS variables.
2. **CSS variables already cross the boundary.** Even if dddk *were* in a shadow root, CSS custom properties inherit through it. So you'd still need the variable token surface. Shadow DOM would add a layer of indirection without solving the actual problem (host CSS leaking *into* dddk).
3. **Inspector / devtools friction.** Inspecting a shadow root requires opening it explicitly. For a piece of UI users see all the time, that's a daily annoyance for the developers shipping it.
4. **Keyboard event subtleties.** Some keyboard events behave differently inside a shadow root (focus boundaries, retargeting). dddk relies heavily on keyboard input — palette, gestures, voice trigger — and we'd rather not court those edge cases.
5. **Tree-shake + bundle size.** Shadow DOM mode would need its own style injection path. Easier and smaller to ship one CSS file and let the host's bundler dedupe.

### What dddk does instead

- **Scoped selectors.** Every dddk root has `[data-dddk-ui="..."]`. Style rules in `dddk/src/styles/*.css` always start with `[data-dddk-ui="bar"]`, `[data-dddk-ui="palette"]`, etc. — so host CSS that targets `div`, `button`, or class names doesn't accidentally hit dddk.
- **Variable-driven values.** Every colour / radius / font reads from a `--dddk-*` token. The token is the public theming API; the implementation CSS is not.
- **High z-index defaults.** dddk chrome (`--dddk-z-bar`, `--dddk-z-palette`, …) is in the 9000–9800 band so it sits above almost any host UI. If the host has a modal that needs to be on top of dddk, override the tokens.

### What to watch for (since we don't have Shadow DOM)

- **Specificity wars.** If a host CSS rule like `.app button { background: red }` is loaded after `@perhapxin/dddk/styles.css`, it can override a dddk button's background. Fix: load `@perhapxin/dddk/styles.css` *after* your global host styles (or use `[data-dddk-ui]` scoping in your host CSS).
- **Accent inheritance.** `--dddk-accent` flows through every dddk surface — palette focus row, button bg, Dwell ring, Spotter ring. Overriding it once at `:root` is usually what you want. If a host overrides at a deeper level (`.dashboard { --dddk-accent: blue }`) only dddk UI rendered *inside* `.dashboard` will see it; UI portalled to `<body>` (palette, modal Surface) will not. For a single accent across the whole app, set it on `:root` or `html`.
- **Reset stylesheets.** If a host applies an aggressive CSS reset (`* { all: unset }` or similar), dddk's UI breaks because it relies on default rendering for elements like `<button>`. Reset rules should be scoped to host content, not global.

If your environment genuinely requires hard isolation (e.g. you're embedding dddk into an untrusted host page like a third-party extension), file an issue — Shadow DOM mode is something we'd revisit if the use case appears, but it is not on the roadmap.
