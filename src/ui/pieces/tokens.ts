/**
 * Shared visual tokens for both React and DOM renderers.
 * Single source of truth — change once, propagates everywhere.
 */

export interface ToneColor {
  bg: string;
  fg: string;
}

export const TONES: Record<string, ToneColor> = {
  neutral: { bg: 'rgba(0,0,0,0.06)', fg: 'inherit' },
  success: { bg: 'rgba(16,185,129,0.12)', fg: '#10b981' },
  warning: { bg: 'rgba(245,158,11,0.12)', fg: '#f59e0b' },
  error:   { bg: 'rgba(239,68,68,0.12)',  fg: '#ef4444' },
  info:    { bg: 'rgba(59,130,246,0.12)', fg: '#3b82f6' },
};

export function tone(name: unknown): ToneColor {
  return TONES[String(name ?? 'neutral')] ?? TONES.neutral!;
}

/** CSS-property objects (React `style={}`-shaped) for button variants. */
export const BUTTON_VARIANTS_REACT: Record<string, React.CSSProperties> = {
  primary:     { background: 'var(--dddk-accent, #3b82f6)', color: '#fff' },
  secondary:   { background: 'transparent', color: 'inherit', border: '1px solid var(--dddk-border)' },
  destructive: { background: '#ef4444', color: '#fff' },
};

/** CSS text strings for DOM renderer (style.cssText fragment). */
export const BUTTON_VARIANTS_CSS: Record<string, string> = {
  primary:
    'background:var(--dddk-accent, #6366f1);color:var(--dddk-text-on-accent, #fff);border:0;',
  secondary:
    'background:transparent;color:inherit;border:1px solid var(--dddk-border, rgba(0,0,0,0.15));',
  destructive: 'background:#ef4444;color:#fff;border:0;',
};

/** Base input style (React form). */
export const BASE_INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid var(--dddk-border, rgba(0,0,0,0.15))',
  borderRadius: 6,
  font: 'inherit',
  background: 'var(--dddk-bg, #fff)',
  color: 'inherit',
};

/** Base input style (DOM `cssText` form). */
export const BASE_INPUT_CSS =
  'width:100%;padding:6px 8px;border:1px solid var(--dddk-border, rgba(0,0,0,0.15));' +
  'border-radius:6px;font:inherit;background:var(--dddk-bg, #fff);color:inherit;box-sizing:border-box;';
