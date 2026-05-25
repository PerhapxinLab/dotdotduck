import { injectScopedStyle } from '../../utils/dom';

export const POPOVER_ATTR = 'data-dddk-ui';
export const POPOVER_STYLE_ID = 'dddk-dwell-style';

export function ensureDwellStyles(): void {
  injectScopedStyle(POPOVER_STYLE_ID, `
    [${POPOVER_ATTR}="dwell"] {
      position: absolute; display: none;
      max-width: 300px;
      background: var(--dddk-bg-elevated, #fff);
      border: 1px solid var(--dddk-border, rgba(0,0,0,0.1));
      border-radius: 10px;
      padding: 10px 12px;
      box-shadow: var(--dddk-shadow-md, 0 4px 16px rgba(0,0,0,0.12));
      font-size: 13px;
      color: var(--dddk-text, #111);
      z-index: var(--dddk-z-bar, 9500);
      animation: dddkMpIn 140ms ease-out;
    }
    [${POPOVER_ATTR}="dwell"] .dwell-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 8px; margin-bottom: 8px;
    }
    [${POPOVER_ATTR}="dwell"] .dwell-label { font-weight: 600; flex: 1; }
    [${POPOVER_ATTR}="dwell"] .dwell-close {
      background: transparent; border: 0; cursor: pointer;
      color: var(--dddk-text-muted, #71717a);
      font-size: 14px; line-height: 1; padding: 0 2px;
    }
    [${POPOVER_ATTR}="dwell"] .dwell-close:hover { color: var(--dddk-text, #111); }
    [${POPOVER_ATTR}="dwell"] .dwell-actions {
      display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px;
    }
    [${POPOVER_ATTR}="dwell"] .dwell-actions button {
      background: var(--dddk-accent-soft, rgba(236,72,153,0.12));
      color: inherit; border: 0; cursor: pointer;
      padding: 4px 8px; border-radius: 5px; font: inherit; font-size: 12px;
    }
    [${POPOVER_ATTR}="dwell"] .dwell-actions button:hover {
      background: var(--dddk-accent, #ec4899); color: #fff;
    }
    [${POPOVER_ATTR}="dwell"] .dwell-hint {
      font-size: 10px; color: var(--dddk-text-muted, #71717a);
      text-align: right;
    }
    @keyframes dddkMpIn {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* The target frame — applied to the long-pressed element. Fully themeable
       via these tokens; hosts can override in their own stylesheet. */
    [data-dddk-dwell-target] {
      outline:
        var(--dddk-dwell-frame-width, 2px)
        var(--dddk-dwell-frame-style, solid)
        var(--dddk-dwell-frame-color, var(--dddk-accent, #ec4899));
      outline-offset: var(--dddk-dwell-frame-offset, 3px);
      border-radius: var(--dddk-dwell-frame-radius, var(--dddk-radius-sm, 6px));
      transition: outline-color 120ms ease-out;
    }
  `);
}
