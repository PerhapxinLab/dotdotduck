/**
 * Platform detection — read the user's OS to surface the right modifier-key
 * label (⌘ on Mac, Ctrl elsewhere). Behaviour is platform-agnostic everywhere
 * else in dddk: key handling already accepts both Ctrl and Meta. This module
 * exists solely so UI labels can match the user's actual keyboard.
 *
 * SSR-safe — returns `false` / Ctrl-flavoured labels when `navigator` is
 * undefined, so static-render frameworks (SvelteKit / Next.js) don't blow up
 * during server pre-render. Hosts that need to swap on hydration should call
 * the helper inside `onMount` / `useEffect`.
 */

/** Best-effort Mac detection. */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  // Modern UA-Client-Hints API (Chromium 90+) — preferred because
  // `navigator.platform` has been deprecated for years and may be frozen to
  // a generic value by privacy modes.
  const uaPlatform = (navigator as unknown as {
    userAgentData?: { platform?: string };
  }).userAgentData?.platform;
  if (typeof uaPlatform === 'string') return uaPlatform === 'macOS';
  // Legacy fallback. Includes iOS — touch devices with a hardware keyboard
  // (iPad Magic Keyboard etc.) also use ⌘, so treating them as Mac is
  // correct for the modifier-key label.
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');
}

/**
 * Display label for the palette-open shortcut. `⌘K` on Mac/iOS, `Ctrl+K`
 * everywhere else. The underlying keybinding accepts both (Ctrl OR Meta) on
 * every platform — this is purely a hint string.
 */
export function paletteShortcutLabel(): string {
  return isMac() ? '⌘K' : 'Ctrl+K';
}

/** Same shape but with a leading `+`-style join (`⌘+K` / `Ctrl+K`). */
export function paletteShortcutLabelPlus(): string {
  return isMac() ? '⌘+K' : 'Ctrl+K';
}
