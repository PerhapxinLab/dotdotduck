import { injectScopedStyle, UI_ATTR } from '../../utils/dom';

export { UI_ATTR };
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
    /* Toolbar layout — a horizontal, icon-only formatting bar anchored
       above the selection (AFFiNE / Notion style). */
    [${UI_ATTR}="inline-agent"][data-layout="toolbar"] {
      min-width: 0; max-width: none; width: auto;
      padding: 3px;
    }
    [${UI_ATTR}="inline-agent"] .ia-toolbar {
      flex-direction: row; align-items: center; gap: 2px;
    }
    [${UI_ATTR}="inline-agent"] .ia-tool {
      display: inline-flex; align-items: center; justify-content: center;
      gap: 1px;
      min-width: 30px; height: 30px; padding: 0 6px;
      background: transparent; border: 0; cursor: pointer;
      color: var(--dddk-text, #18181b);
      font: inherit; font-size: 14px;
      border-radius: 6px;
    }
    [${UI_ATTR}="inline-agent"] .ia-tool:hover,
    [${UI_ATTR}="inline-agent"] .ia-tool[data-active] {
      background: var(--dddk-accent-soft, rgba(99,102,241,0.1));
    }
    [${UI_ATTR}="inline-agent"] .ia-tool .ia-icon {
      width: auto; height: auto;
      color: inherit;
    }
    [${UI_ATTR}="inline-agent"] .ia-chevron {
      font-size: 9px; line-height: 1;
      color: var(--dddk-text-muted, #6b6b6b);
      margin-left: 1px;
    }
    [${UI_ATTR}="inline-agent"] .ia-toolbar-sep {
      width: 1px; height: 18px; margin: 0 3px;
      background: var(--dddk-border, rgba(0,0,0,0.12));
      flex: 0 0 auto;
    }
    /* Dropdown sub-menu for toolbar dropdown buttons — vertical list,
       anchored under the button. Reuses the .ia-submenu shell. */
    [${UI_ATTR}="inline-agent"].ia-submenu[data-dropdown] {
      min-width: 160px; max-width: 240px; padding: 4px;
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
