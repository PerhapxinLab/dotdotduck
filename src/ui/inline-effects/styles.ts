// Shared CSS for the inline-effects primitives — processing line + diff panel.
// Injected once via injectScopedStyle (idempotent). UI_ATTR scopes everything so
// host page styles don't bleed in or out.

import { injectScopedStyle, UI_ATTR } from '../../utils/dom';

export { UI_ATTR };
export const STYLE_ID = 'dddk-inline-effects-style';

export function ensureInlineEffectsStyles(): void {
  injectScopedStyle(STYLE_ID, `
    /* Processing line — a slim "AI is working" indicator anchored under the
       line being edited. Pure presentational; the host positions it. */
    [${UI_ATTR}="processing-line"] {
      position: absolute;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 10px;
      background: var(--dddk-bg-elevated, #fff);
      border: 1px dashed var(--dddk-accent-soft-border, rgba(99,102,241,0.35));
      border-radius: var(--dddk-radius, 10px);
      box-shadow: var(--dddk-shadow-sm, 0 2px 8px rgba(0,0,0,0.06));
      font-family: var(--dddk-font, system-ui, sans-serif);
      font-size: 12px; color: var(--dddk-text-muted, #6b6b6b);
      z-index: var(--dddk-z-bar, 9700);
      pointer-events: none;
      animation: dddk-pl-fadein 120ms ease;
    }
    [${UI_ATTR}="processing-line"] .pl-spinner {
      width: 12px; height: 12px;
      border: 1.5px solid var(--dddk-border, rgba(0,0,0,0.15));
      border-top-color: var(--dddk-accent, #6366f1);
      border-radius: 50%;
      animation: dddk-pl-spin 0.8s linear infinite;
    }
    [${UI_ATTR}="processing-line"] .pl-label { white-space: nowrap; }
    @keyframes dddk-pl-spin { to { transform: rotate(360deg); } }
    @keyframes dddk-pl-fadein { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }

    /* Inline diff panel — strikethrough old + new + action toolbar + optional
       chat composer for follow-up edits. Anchored to a host-supplied rect. */
    [${UI_ATTR}="inline-diff"] {
      position: absolute;
      display: flex; flex-direction: column; gap: 8px;
      min-width: 280px; max-width: min(92vw, 480px);
      padding: 10px 12px;
      background: var(--dddk-bg-elevated, #fff);
      border: 1px solid var(--dddk-border, rgba(0,0,0,0.1));
      border-radius: var(--dddk-radius, 10px);
      box-shadow: var(--dddk-shadow-md, 0 12px 36px rgba(0,0,0,0.18));
      font-family: var(--dddk-font, system-ui, sans-serif);
      font-size: 13px; color: var(--dddk-text, #18181b);
      z-index: var(--dddk-z-bar, 9700);
      animation: dddk-pl-fadein 120ms ease;
    }
    [${UI_ATTR}="inline-diff"] .id-diff {
      display: block; max-height: 280px; overflow-y: auto;
      padding: 8px 10px;
      background: var(--dddk-bg-soft, rgba(0,0,0,0.02));
      border-radius: 6px; line-height: 1.5;
    }
    [${UI_ATTR}="inline-diff"] .id-old {
      color: var(--dddk-text-faint, #9b9b9b);
      text-decoration: line-through; text-decoration-thickness: 1px;
    }
    [${UI_ATTR}="inline-diff"] .id-new {
      color: var(--dddk-accent, #6366f1);
      font-weight: 500;
    }
    [${UI_ATTR}="inline-diff"] .id-arrow {
      display: inline-block; margin: 0 6px;
      color: var(--dddk-text-faint, #9b9b9b);
    }
    [${UI_ATTR}="inline-diff"] .id-actions {
      display: flex; align-items: center; gap: 4px;
      flex-wrap: wrap;
    }
    [${UI_ATTR}="inline-diff"] .id-btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 5px 10px;
      background: transparent; border: 1px solid var(--dddk-border, rgba(0,0,0,0.12));
      border-radius: 6px;
      color: var(--dddk-text, #18181b);
      font: inherit; font-size: 12px;
      cursor: pointer;
    }
    [${UI_ATTR}="inline-diff"] .id-btn:hover {
      background: var(--dddk-bg-soft, rgba(0,0,0,0.04));
    }
    [${UI_ATTR}="inline-diff"] .id-btn[data-primary] {
      background: var(--dddk-accent, #6366f1);
      border-color: var(--dddk-accent, #6366f1);
      color: var(--dddk-accent-on, #fff);
    }
    [${UI_ATTR}="inline-diff"] .id-btn[data-primary]:hover {
      filter: brightness(0.95);
    }
    [${UI_ATTR}="inline-diff"] .id-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
    [${UI_ATTR}="inline-diff"] .id-spacer { flex: 1; }
    [${UI_ATTR}="inline-diff"] .id-composer {
      display: flex; gap: 6px; align-items: center;
      padding-top: 8px;
      border-top: 1px solid var(--dddk-border, rgba(0,0,0,0.08));
    }
    [${UI_ATTR}="inline-diff"] .id-input {
      flex: 1; min-width: 0;
      padding: 6px 9px;
      background: var(--dddk-bg-soft, rgba(0,0,0,0.03));
      border: 1px solid var(--dddk-border, rgba(0,0,0,0.1));
      border-radius: 6px;
      color: var(--dddk-text, #18181b);
      font: inherit; font-size: 12px;
      outline: none;
    }
    [${UI_ATTR}="inline-diff"] .id-input:focus {
      border-color: var(--dddk-accent, #6366f1);
    }
    [${UI_ATTR}="inline-diff"] .id-spinner {
      width: 11px; height: 11px;
      border: 1.5px solid var(--dddk-border, rgba(0,0,0,0.15));
      border-top-color: var(--dddk-accent, #6366f1);
      border-radius: 50%;
      animation: dddk-pl-spin 0.8s linear infinite;
      flex: 0 0 auto;
    }
  `);
}
