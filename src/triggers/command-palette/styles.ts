import { injectScopedStyle } from '../../utils/dom';

export const STYLE_ID = 'dddk-palette-style';
export const UI_ATTR = 'data-dddk-ui';

export function ensurePaletteStyles(): void {
  injectScopedStyle(STYLE_ID, `
    [${UI_ATTR}="palette-backdrop"] {
      position: fixed; inset: 0;
      background: var(--dddk-bg-overlay, rgba(0,0,0,0.5));
      backdrop-filter: blur(var(--dddk-blur, 12px));
      z-index: var(--dddk-z-palette, 9900);
      display: flex; align-items: flex-start; justify-content: center;
      padding-top: 12vh;
      animation: dddk-fade 120ms ease-out;
    }
    [${UI_ATTR}="palette"] {
      width: var(--dddk-palette-width, 720px); max-width: 90vw;
      max-height: var(--dddk-palette-max-height, 80vh);
      background: var(--dddk-bg-elevated, #fff);
      color: var(--dddk-text, #1a1a1a);
      border-radius: var(--dddk-radius, 12px);
      box-shadow: var(--dddk-shadow-lg, 0 8px 32px rgba(0,0,0,0.15));
      font-family: var(--dddk-font, system-ui, sans-serif);
      display: flex; flex-direction: column; overflow: hidden;
    }
    [${UI_ATTR}="palette-input-row"] {
      display: flex; align-items: center;
      padding-right: 14px;
    }
    [${UI_ATTR}="palette-input"] {
      border: 0; outline: 0; padding: 16px 20px;
      font-size: var(--dddk-font-size-lg, 16px);
      background: transparent; color: inherit; width: 100%;
      flex: 1; min-width: 0;
    }
    [${UI_ATTR}="palette-camera"] {
      flex-shrink: 0;
      width: 32px; height: 32px;
      background: transparent; border: 0;
      border-radius: var(--dddk-radius-sm, 6px);
      color: var(--dddk-text-muted, #71717a);
      cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      transition: background 0.15s, color 0.15s;
    }
    [${UI_ATTR}="palette-camera"]:hover {
      background: var(--dddk-accent-soft, rgba(139,115,85,0.1));
      color: var(--dddk-text, #18181b);
    }
    [${UI_ATTR}="palette-context"] {
      display: flex; flex-wrap: wrap; gap: 6px;
      padding: 8px 14px;
      background: var(--dddk-accent-soft, rgba(139,115,85,0.06));
      font-size: 12px;
    }
    [${UI_ATTR}="palette-context"] .pal-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 8px; border-radius: 12px;
      background: var(--dddk-bg-elevated, #fff);
      border: 1px solid var(--dddk-border, rgba(0,0,0,0.1));
      max-width: 360px;
    }
    [${UI_ATTR}="palette-context"] .pal-chip-label {
      font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--dddk-accent, #ec4899);
    }
    [${UI_ATTR}="palette-context"] .pal-chip-text {
      font-size: 12px;
      color: var(--dddk-text, #18181b);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 280px;
    }
    /* DOM chip — uses a slightly different label color so users can tell at
       a glance "I pinned an element" vs "I selected some text". */
    [${UI_ATTR}="palette-context"] .pal-chip-dom .pal-chip-label {
      color: var(--dddk-accent-strong, var(--dddk-accent, #ec4899));
    }
    [${UI_ATTR}="palette-context"] .pal-chip-dom .pal-chip-text {
      font-family: var(--dddk-font-mono, ui-monospace, monospace);
      font-size: 11px;
    }
    /* Image-attachment chip — shows the preview big enough to recognise. */
    [${UI_ATTR}="palette-context"] .pal-chip-att {
      padding: 4px;
      position: relative;
    }
    [${UI_ATTR}="palette-context"] .pal-chip-img {
      display: block;
      width: 64px; height: 64px; border-radius: 6px;
      object-fit: cover;
    }
    [${UI_ATTR}="palette-context"] .pal-chip-att .pal-chip-x {
      position: absolute;
      top: 2px; right: 2px;
      width: 18px; height: 18px;
      border-radius: 50%;
      background: var(--dddk-bg-elevated, #fff);
      border: 1px solid var(--dddk-border);
      box-shadow: var(--dddk-shadow-sm, 0 1px 3px rgba(0,0,0,0.1));
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      color: var(--dddk-text-muted, #71717a);
      font-size: 11px;
      padding: 0;
    }
    [${UI_ATTR}="palette-context"] .pal-chip-x {
      background: transparent; border: 0; cursor: pointer;
      color: var(--dddk-text-muted, #71717a);
      font-size: 11px; padding: 0 2px;
    }
    [${UI_ATTR}="palette-context"] .pal-chip-x:hover {
      color: var(--dddk-text, #18181b);
    }
    [${UI_ATTR}="palette-screenshot-overlay"] {
      position: fixed; inset: 0;
      z-index: calc(var(--dddk-z-palette, 9600) + 1);
      cursor: crosshair;
      background: rgba(0, 0, 0, 0.18);
    }
    [${UI_ATTR}="palette-screenshot-rect"] {
      position: fixed;
      display: none;
      border: 2px solid var(--dddk-accent, #6366f1);
      background: var(--dddk-accent-soft, rgba(99,102,241,0.18));
      pointer-events: none;
    }
    [${UI_ATTR}="palette-screenshot-hint"] {
      position: fixed; left: 50%; bottom: 32px;
      transform: translateX(-50%);
      padding: 8px 16px;
      background: var(--dddk-bg-elevated, rgba(255,255,255,0.96));
      color: var(--dddk-text, #18181b);
      border-radius: 8px;
      font-family: var(--dddk-font);
      font-size: 12px;
      box-shadow: var(--dddk-shadow-md);
      pointer-events: none;
    }
    [${UI_ATTR}="palette-footer"] {
      display: flex; align-items: center; gap: 18px;
      padding: 10px 16px;
      border-top: 1px solid var(--dddk-border, rgba(0,0,0,0.06));
      font-size: 11px;
      color: var(--dddk-text-muted, #71717a);
      background: var(--dddk-bg-elevated, transparent);
    }
    [${UI_ATTR}="palette-categories"] {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--dddk-border, rgba(0,0,0,0.06));
      overflow-x: auto;
      scrollbar-width: none;
    }
    [${UI_ATTR}="palette-categories"]::-webkit-scrollbar { display: none; }
    [${UI_ATTR}="palette-category"] {
      flex: 0 0 auto;
      appearance: none;
      border: 0;
      padding: 4px 11px;
      border-radius: 999px;
      font-family: inherit;
      font-size: 12px;
      line-height: 1.4;
      color: var(--dddk-palette-category-color, var(--dddk-text-muted, #71717a));
      background: var(--dddk-palette-category-bg, transparent);
      cursor: pointer;
      transition: background 80ms ease, color 80ms ease;
    }
    [${UI_ATTR}="palette-category"]:hover {
      background: var(--dddk-palette-category-bg-hover, rgba(0,0,0,0.04));
      color: var(--dddk-text, #18181b);
    }
    [${UI_ATTR}="palette-category"][data-active="true"] {
      background: var(--dddk-palette-category-bg-active, var(--dddk-accent, #6366f1));
      color: var(--dddk-palette-category-color-active, var(--dddk-text-on-accent, #fff));
    }
    [${UI_ATTR}="palette-footer-group"] {
      display: inline-flex; align-items: center; gap: 6px;
    }
    /* Borderless, lower-contrast kbd chips — a subtle filled tile
       rather than a button-with-border so the row of hints reads as
       ambient help, not a toolbar. */
    [${UI_ATTR}="palette-footer"] kbd {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 16px; height: 16px;
      padding: 0 4px;
      background: var(--dddk-palette-kbd-bg, rgba(0,0,0,0.05));
      border: 0;
      border-radius: 3px;
      font-family: inherit;
      font-size: 10px;
      line-height: 1;
      color: var(--dddk-palette-kbd-color, var(--dddk-text-muted, #71717a));
    }
    [${UI_ATTR}="palette-result"] {
      padding: 18px 22px;
      overflow-y: auto;
      overscroll-behavior: contain;       /* don't propagate scroll to the page */
      max-height: 60vh;
      flex: 1;
      font-size: var(--dddk-font-size-md, 14px);
      line-height: 1.65;
      color: var(--dddk-text, #18181b);
    }
    [${UI_ATTR}="palette-split"] {
      display: flex; flex: 1; min-height: 0;
    }
    [${UI_ATTR}="palette-list"] {
      list-style: none; margin: 0; padding: 6px 8px 8px;
      overflow-y: auto;
      overscroll-behavior: contain;       /* same — captures wheel on overflow */
      flex: 1; min-width: 0;
    }
    [${UI_ATTR}="palette-detail"] {
      width: 40%;
      padding: 16px;
      overflow-y: auto;
      overscroll-behavior: contain;
      font-size: var(--dddk-font-size-sm, 13px);
      background: var(--dddk-bg, transparent);
    }
    /* Palette-scoped text-selection — high-contrast on both themes. */
    [${UI_ATTR}="palette"] ::selection,
    [${UI_ATTR}="palette-result"] ::selection {
      background: var(--dddk-accent, #6366f1);
      color: var(--dddk-text-on-accent, #fff);
    }
    [${UI_ATTR}="palette-section"] {
      padding: var(--dddk-palette-section-padding, 14px 16px 6px);
      font-size: var(--dddk-palette-section-font-size, 12px);
      color: var(--dddk-palette-section-color, var(--dddk-text-muted, #6b6b6b));
      text-transform: var(--dddk-palette-section-text-transform, none);
      letter-spacing: var(--dddk-palette-section-letter-spacing, 0);
      font-weight: var(--dddk-palette-section-font-weight, 500);
      /* Sticky so the header stays pinned to the top as rows scroll under it.
         Solid bg (same as palette body) is required, otherwise scrolling rows
         show through. z-index keeps the header above the content layer.
         top: -1px hides any sub-pixel gap that would let row content peek
         above the header during inertial scroll. */
      position: sticky;
      top: -1px;
      z-index: 1;
      background: var(--dddk-palette-section-bg, var(--dddk-bg-elevated, #fff));
    }
    [${UI_ATTR}="palette-item"] {
      position: relative;
      padding: var(--dddk-palette-row-padding, 9px 16px);
      /* Reserve right-edge space for the focus arrow on EVERY row so the
         text columns don't shift when focus moves. Without this the arrow
         would overlap any shortcut text on the active row. */
      padding-right: calc(28px + var(--dddk-palette-row-padding-right, 8px));
      cursor: pointer;
      display: flex; align-items: center;
      gap: var(--dddk-palette-row-gap, 12px);
      border-radius: var(--dddk-palette-row-radius, 6px);
    }
    [${UI_ATTR}="palette-item"]:hover {
      background: var(--dddk-palette-row-bg-hover, rgba(0,0,0,0.04));
    }
    [${UI_ATTR}="palette-item"][data-active="true"] {
      background: var(--dddk-palette-row-bg-active, rgba(0,0,0,0.06));
    }
    /* Right-edge arrow on the focused row — affordance telling the
       user "Enter activates this row". Quiet on hover, fully visible
       on the active row only. */
    [${UI_ATTR}="palette-item"][data-active="true"]::after {
      content: '→';
      position: absolute;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--dddk-palette-row-arrow-color, var(--dddk-text-muted, #71717a));
      font-size: 14px;
      pointer-events: none;
    }
    [${UI_ATTR}="palette-item-icon"] {
      width: var(--dddk-palette-icon-size, 18px);
      text-align: center; flex-shrink: 0;
      color: var(--dddk-palette-icon-color, var(--dddk-text-muted, #6b6b6b));
    }
    [${UI_ATTR}="palette-item"][data-active="true"] [${UI_ATTR}="palette-item-icon"] {
      color: var(--dddk-palette-icon-color-active, var(--dddk-text-on-accent, #fff));
    }
    [${UI_ATTR}="palette-item-name"] {
      flex-shrink: 0;
      color: var(--dddk-palette-name-color, var(--dddk-text, #18181b));
      font-size: var(--dddk-palette-name-font-size, var(--dddk-font-size-md, 14px));
      font-weight: var(--dddk-palette-name-font-weight, 500);
    }
    [${UI_ATTR}="palette-item"][data-active="true"] [${UI_ATTR}="palette-item-name"] {
      color: var(--dddk-palette-name-color-active, var(--dddk-text-on-accent, #fff));
    }
    [${UI_ATTR}="palette-item-dash"] {
      color: var(--dddk-palette-dash-color, var(--dddk-text-muted, #6b6b6b));
      opacity: var(--dddk-palette-dash-opacity, 0.55);
    }
    [${UI_ATTR}="palette-item-desc"] {
      flex: 1; min-width: 0;
      color: var(--dddk-palette-desc-color, var(--dddk-text-muted, #6b6b6b));
      font-size: var(--dddk-palette-desc-font-size, var(--dddk-font-size-sm, 13px));
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    [${UI_ATTR}="palette-item"][data-active="true"] [${UI_ATTR}="palette-item-desc"] {
      color: var(--dddk-palette-desc-color-active, var(--dddk-text-on-accent, #fff));
      opacity: var(--dddk-palette-desc-opacity-active, 0.85);
    }
    [${UI_ATTR}="palette-item"][data-active="true"] [${UI_ATTR}="palette-item-dash"] {
      color: var(--dddk-palette-desc-color-active, var(--dddk-text-on-accent, #fff));
      opacity: 0.5;
    }
    [${UI_ATTR}="palette-item-shortcut"] {
      font-family: var(--dddk-palette-shortcut-font, var(--dddk-font-mono, ui-monospace, monospace));
      font-size: var(--dddk-palette-shortcut-font-size, var(--dddk-font-size-sm, 12px));
      color: var(--dddk-palette-shortcut-color, var(--dddk-text-muted, #6b6b6b));
      opacity: var(--dddk-palette-shortcut-opacity, 0.6);
    }
    [${UI_ATTR}="palette-item-prefix"] {
      font-family: var(--dddk-palette-prefix-font, inherit);
      font-size: var(--dddk-palette-prefix-font-size, var(--dddk-font-size-md, 14px));
      padding: var(--dddk-palette-prefix-padding, 0);
      border-radius: var(--dddk-palette-prefix-radius, 0);
      background: var(--dddk-palette-prefix-bg, transparent);
      color: var(--dddk-palette-prefix-color, var(--dddk-text-muted, #71717a));
      font-weight: var(--dddk-palette-name-font-weight, 500);
    }
    /* Query-match highlight inside row name / description. Warm yellow
       marker on light bg, soft amber on dark — meant to read as a
       search-hit signal distinct from the brand accent. */
    [${UI_ATTR}="palette-match"] {
      background: var(--dddk-palette-match-bg, rgba(250, 204, 21, 0.35));
      color: var(--dddk-palette-match-color, inherit);
      border-radius: var(--dddk-palette-match-radius, 2px);
      padding: 0 1px;
      font-weight: var(--dddk-palette-match-weight, 600);
    }
    @keyframes dddk-fade { from { opacity: 0; } to { opacity: 1; } }

    /* ── Mobile / coarse-pointer overrides ─────────────────────────
       The default chrome (centered modal, keyboard-shortcut footer, 14px
       fonts) is desktop-shaped. On touch devices we (1) hide the keyboard
       footer (↑ ↓ ⏎ esc are not reachable), (2) bottom-anchor the panel
       sheet-style with a safe-area inset, and (3) bump tap targets so
       fingers can hit list rows cleanly. */
    @media (max-width: 640px), (pointer: coarse) {
      /* Mobile palette is a FLOATING dialog, NOT a fullscreen sheet.
         The previous fullscreen layout felt like a takeover app, not
         like a command palette. We keep ~88% viewport width, max-height
         70vh, rounded on all sides, and centered with backdrop visible
         around it — the user can still see hints of the page behind so
         the palette feels like an overlay control, not a destination. */
      [${UI_ATTR}="palette-backdrop"] {
        padding: 16px;
        padding-top: 12vh;
        align-items: flex-start;
      }
      [${UI_ATTR}="palette"] {
        width: 100%;
        max-width: 100%;
        max-height: 70vh;
        border-radius: var(--dddk-radius, 14px);
        animation: dddk-sheet-up 180ms cubic-bezier(0.2, 0, 0, 1);
      }
      [${UI_ATTR}="palette-input"] {
        font-size: 16px;       /* prevents iOS auto-zoom on focus */
        padding: 12px 14px;
      }
      [${UI_ATTR}="palette-list"] li {
        padding: 12px 16px;    /* tap target ~44dp */
      }
      [${UI_ATTR}="palette-result"] { max-height: 55vh; }
      /* Hide the desktop keyboard-shortcut footer (↑ ↓ ⏎ esc) on touch —
         users can't press those, and the strip just wastes screen height. */
      [${UI_ATTR}="palette-footer"] { display: none; }
    }
    @keyframes dddk-sheet-up {
      from { transform: translateY(24px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
  `);
}
