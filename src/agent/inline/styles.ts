import { injectScopedStyle } from '../../utils/dom';

export const UI_ATTR = 'data-dddk-ui';
export const STYLE_ID = 'dddk-inline-agent-style';

export function ensureInlineAgentStyles(): void {
  injectScopedStyle(STYLE_ID, `
    [${UI_ATTR}="inline-agent"] {
      position: absolute; display: none;
      min-width: 220px; max-width: 280px;
      background: var(--dddk-bg-elevated, #fff);
      border: 1px solid var(--dddk-border, rgba(0,0,0,0.1));
      border-radius: var(--dddk-radius, 10px);
      box-shadow: var(--dddk-shadow-md, 0 8px 24px rgba(0,0,0,0.15));
      padding: 6px;
      z-index: var(--dddk-z-bar, 9700);
      font-family: var(--dddk-font, system-ui, sans-serif);
    }
    /* Two-column layout — for hosts (note-taking apps etc.) that want a
       column of formatting actions next to a column of AI actions. */
    [${UI_ATTR}="inline-agent"][data-layout="two-column"] { max-width: 460px; }
    [${UI_ATTR}="inline-agent"] .ia-two-col {
      display: grid; grid-template-columns: 1fr 1fr; gap: 4px;
    }
    [${UI_ATTR}="inline-agent"] .ia-col {
      display: flex; flex-direction: column; gap: 1px;
    }
    [${UI_ATTR}="inline-agent"] .ia-col-label {
      font-size: 10px; font-weight: 600;
      letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--dddk-text-muted, #6b6b6b);
      padding: 4px 8px 2px;
    }
    [${UI_ATTR}="inline-agent"].ia-submenu { display: block; }
    [${UI_ATTR}="inline-agent"] .ia-header {
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--dddk-accent, #6366f1);
      padding: 6px 8px 4px;
    }
    [${UI_ATTR}="inline-agent"] .ia-list {
      display: flex; flex-direction: column; gap: 1px;
    }
    [${UI_ATTR}="inline-agent"] .ia-row {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 8px 10px;
      background: transparent; border: 0; cursor: pointer;
      color: var(--dddk-text, #18181b);
      font: inherit; font-size: 13px;
      border-radius: 6px;
      text-align: left;
    }
    [${UI_ATTR}="inline-agent"] .ia-row:hover,
    [${UI_ATTR}="inline-agent"] .ia-row[data-active] {
      background: var(--dddk-accent-soft, rgba(99,102,241,0.1));
    }
    [${UI_ATTR}="inline-agent"] .ia-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px;
      color: var(--dddk-accent, #6366f1);
      font-size: 13px;
    }
  `);
}
