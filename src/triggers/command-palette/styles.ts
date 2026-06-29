import { injectScopedStyle, UI_ATTR } from '../../utils/dom';

export { UI_ATTR };
export const STYLE_ID = 'dddk-palette-style';

export function ensurePaletteStyles(): void {
  injectScopedStyle(STYLE_ID, `
    [${UI_ATTR}="palette-backdrop"] {
      position: fixed; inset: 0;
      background: var(--dddk-bg-overlay, rgba(15, 23, 42, 0.42));
      backdrop-filter: blur(var(--dddk-blur, 20px));
      -webkit-backdrop-filter: blur(var(--dddk-blur, 20px));
      z-index: var(--dddk-z-palette, 9900);
      display: flex; align-items: flex-start; justify-content: center;
      padding-top: 10vh;
      animation: dddk-fade 140ms ease-out;
    }
    /* Inline mount: palette embedded in a host (no overlay/backdrop). The box
       fills the host width and drops the elevation/animation of the modal. */
    [${UI_ATTR}="palette-inline"] { position: static; display: block; width: 100%; }
    [${UI_ATTR}="palette-inline"] [${UI_ATTR}="palette"] {
      width: 100%; max-width: none;
      max-height: var(--dddk-palette-inline-max-height, 460px);
      box-shadow: var(--dddk-palette-inline-shadow, none);
      animation: none;
    }
    [${UI_ATTR}="palette"] {
      width: var(--dddk-palette-width, 760px); max-width: 92vw;
      max-height: var(--dddk-palette-max-height, 78vh);
      background: var(--dddk-bg-elevated, #ffffff);
      color: var(--dddk-text, #1a1a1a);
      border-radius: var(--dddk-radius, 18px);
      border: 1px solid var(--dddk-border, rgba(0, 0, 0, 0.06));
      box-shadow: var(--dddk-shadow-lg, 0 28px 72px -16px rgba(0, 0, 0, 0.38), 0 4px 18px rgba(0, 0, 0, 0.08));
      font-family: var(--dddk-font, system-ui, -apple-system, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif);
      /* Self-containment: these properties INHERIT from the host page. The modal
         renders against a neutral backdrop so it never noticed, but inline mounts
         live inside arbitrary host CSS (e.g. a centered hero). Reset them on the
         root so the palette looks identical wherever it is embedded. */
      text-align: left; letter-spacing: normal; line-height: normal;
      text-transform: none; font-style: normal; white-space: normal;
      word-spacing: normal; text-indent: 0; direction: ltr;
      display: flex; flex-direction: column; overflow: hidden;
      animation: dddk-palette-rise 200ms cubic-bezier(0.2, 0, 0, 1);
    }
    @keyframes dddk-palette-rise {
      from { transform: translateY(8px) scale(0.985); opacity: 0; }
      to   { transform: translateY(0)    scale(1);     opacity: 1; }
    }
    [${UI_ATTR}="palette-input-row"] {
      display: flex; align-items: center;
      padding-right: 14px;
      border-bottom: 1px solid var(--dddk-border, rgba(0, 0, 0, 0.06));
    }
    /* Back / close chrome shared with PanelRuntime — the panel skill
       UI reuses the same input row so the user sees one continuous
       palette experience, with a back arrow appearing only when
       there's somewhere to go. */
    [${UI_ATTR}="panel-back"],
    [${UI_ATTR}="panel-close"] {
      flex-shrink: 0;
      width: 32px; height: 32px;
      margin: 0 4px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent;
      color: var(--dddk-text-muted, #64748b);
      border: 0;
      border-radius: 8px;
      font-size: 18px; line-height: 1;
      cursor: pointer;
      padding: 0;
      transition: background 0.12s, color 0.12s;
      -webkit-tap-highlight-color: transparent;
    }
    [${UI_ATTR}="panel-back"] { margin-left: 8px; }
    [${UI_ATTR}="panel-close"] { margin-right: 0; }
    [${UI_ATTR}="panel-back"]:hover,
    [${UI_ATTR}="panel-close"]:hover {
      background: var(--dddk-row-hover, rgba(0, 0, 0, 0.06));
      color: var(--dddk-text, #1a1a1a);
    }
    [${UI_ATTR}="panel-back"]:focus-visible,
    [${UI_ATTR}="panel-close"]:focus-visible {
      outline: 2px solid var(--dddk-accent, #6366f1);
      outline-offset: 2px;
    }
    [${UI_ATTR}="panel-back"]:active,
    [${UI_ATTR}="panel-close"]:active { transform: scale(0.94); }
    [${UI_ATTR}="palette-input"] {
      border: 0; outline: 0; padding: 18px 22px;
      font-size: var(--dddk-font-size-lg, 16.5px);
      font-weight: 400;
      background: transparent; color: inherit; width: 100%;
      flex: 1; min-width: 0;
      letter-spacing: 0.002em;
      /* Long placeholders truncate with an ellipsis instead of being clipped flush. */
      text-overflow: ellipsis;
    }
    [${UI_ATTR}="palette-input"]::placeholder {
      color: var(--dddk-text-muted, #94a3b8);
      font-weight: 400;
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
    /* Submit / send button — circular accent button at the right edge of input. */
    [${UI_ATTR}="palette-submit"] {
      flex-shrink: 0; margin-right: 10px;
      width: var(--dddk-palette-submit-size, 36px); height: var(--dddk-palette-submit-size, 36px);
      border: 0; border-radius: 999px; cursor: pointer;
      background: var(--dddk-palette-submit-bg, var(--dddk-accent, #a94064));
      color: var(--dddk-palette-submit-color, #fff);
      display: inline-flex; align-items: center; justify-content: center;
      transition: opacity 0.15s, transform 0.1s;
    }
    [${UI_ATTR}="palette-submit"]:hover { opacity: 0.9; }
    [${UI_ATTR}="palette-submit"]:active { transform: scale(0.93); }
    /* Multi-line row: vertical text column (name on top, then one el per line). */
    [${UI_ATTR}="palette-item-textcol"] {
      display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto;
    }
    [${UI_ATTR}="palette-item-line"] {
      font-size: var(--dddk-palette-line-font-size, 13px);
      line-height: 1.35; min-width: 0;
      color: var(--dddk-palette-line-color, var(--dddk-text-muted, #6b6b6b));
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    [${UI_ATTR}="palette-item"][data-active="true"] [${UI_ATTR}="palette-item-line"] {
      color: var(--dddk-palette-line-color-active, var(--dddk-palette-desc-color-active, inherit));
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
    /* Push the last footer group (esc to close) to the far right.
       The first two (↑↓ navigate, ↵ select) stay grouped on the left. */
    [${UI_ATTR}="palette-footer-group"]:last-child {
      margin-left: auto;
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
      /* Zero internal padding — host content owns its own layout. The
         outer palette shell provides the visual frame; custom panels
         live edge-to-edge inside, so there's no "box inside a box"
         feel when a host's split-view / image preview / chip grid
         mounts here. Hosts that want padded content add their own
         padding to the surface they emit (.dddk-panel-section etc). */
      padding: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
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
    /* Inline accordion: appended INSIDE the active row so the whole option grows
       taller. flex-basis:100% drops it onto a new full-width line under the
       icon + text; it inherits the row's active background (one expanded card). */
    [${UI_ATTR}="palette-detail"] {
      flex-basis: 100%;
      width: 100%;
      padding: 6px 8px 4px 50px;
      overflow-y: auto;
      overscroll-behavior: contain;
      font-size: var(--dddk-font-size-sm, 13px);
      color: var(--dddk-text, #18181b);
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
      /* Section headers default to sticky (pinned while rows scroll under them),
         but hosts can set --dddk-palette-section-position: static to make the
         header scroll away WITH its rows. When sticky, a solid bg is required so
         scrolling rows don't show through; top:-1px hides sub-pixel gaps. */
      position: var(--dddk-palette-section-position, sticky);
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
      /* wrap so an inline detail host (appended into the active row) drops onto
         a new full-width line under the icon + text — the whole option grows. */
      flex-wrap: wrap;
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
    /* Image thumbnail row (item.image): cover-fit, slightly larger than glyph slot. */
    [${UI_ATTR}="palette-item-icon-img"] {
      width: var(--dddk-palette-image-w, 26px);
      height: var(--dddk-palette-image-h, 34px);
      flex-shrink: 0;
    }
    [${UI_ATTR}="palette-item-icon-img"] img {
      width: 100%; height: 100%; object-fit: cover; display: block;
      border-radius: var(--dddk-palette-image-radius, 3px);
      box-shadow: 0 1px 3px rgba(0,0,0,0.18);
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

    /* ─────────────────────────────────────────────────────────────
       Panel-surface utilities — opt-in classes hosts can compose
       inside any palette result / panel runtime content area.
       The point is to give custom UIs a consistent visual language
       without each host writing its own CSS (or pulling Tailwind).
       All classes use the dddk-panel- prefix so they never collide
       with the host's own styles.
       ───────────────────────────────────────────────────────────── */

    /* Section — generous-padding container for prose / hero content. */
    .dddk-panel-section {
      padding: 18px 22px;
    }
    .dddk-panel-section + .dddk-panel-section {
      border-top: 1px solid var(--dddk-border, rgba(0, 0, 0, 0.06));
    }

    /* Split — left rail (list) + right detail panel. */
    .dddk-panel-split {
      display: grid;
      grid-template-columns: minmax(220px, 38%) 1fr;
      min-height: 320px;
    }
    .dddk-panel-split > :first-child {
      border-right: 1px solid var(--dddk-border, rgba(0, 0, 0, 0.06));
      overflow-y: auto; min-height: 0;
    }
    .dddk-panel-split > :last-child {
      overflow-y: auto; min-height: 0;
    }
    @media (max-width: 640px) {
      .dddk-panel-split { grid-template-columns: 1fr; min-height: 240px; }
      .dddk-panel-split > :first-child {
        border-right: 0;
        border-bottom: 1px solid var(--dddk-border, rgba(0, 0, 0, 0.06));
      }
    }

    /* Section heading — small, muted, generous letter-spacing. */
    .dddk-panel-section-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--dddk-text-muted, #64748b);
      padding: 12px 16px 4px;
    }

    /* List rows — Raycast-style hoverable list. */
    .dddk-panel-list {
      list-style: none;
      margin: 0;
      padding: 4px 8px 8px;
    }
    .dddk-panel-row {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 12px;
      border-radius: 8px;
      cursor: pointer;
      color: var(--dddk-text, #1a1a1a);
      transition: background 80ms ease;
    }
    .dddk-panel-row:hover {
      background: var(--dddk-row-hover, rgba(0, 0, 0, 0.04));
    }
    .dddk-panel-row[data-active="true"] {
      background: var(--dddk-row-active, rgba(0, 0, 0, 0.06));
    }
    .dddk-panel-row-icon {
      flex: 0 0 28px;
      width: 28px; height: 28px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 8px;
      background: var(--dddk-bg-elevated, rgba(0, 0, 0, 0.04));
      color: var(--dddk-text-muted, #64748b);
      font-size: 13px;
    }
    .dddk-panel-row-icon img,
    .dddk-panel-row-icon svg { width: 100%; height: 100%; border-radius: 8px; object-fit: cover; }
    .dddk-panel-row-main {
      flex: 1; min-width: 0;
      display: flex; flex-direction: column;
    }
    .dddk-panel-row-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--dddk-text, #1a1a1a);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dddk-panel-row-sub {
      font-size: 12px;
      color: var(--dddk-text-muted, #64748b);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      margin-top: 2px;
    }
    .dddk-panel-row-meta {
      font-size: 11.5px;
      color: var(--dddk-text-muted, #64748b);
      flex: 0 0 auto;
      margin-left: 8px;
    }

    /* Detail panel — hero block + info table. */
    .dddk-panel-detail {
      padding: 22px 24px;
      display: flex; flex-direction: column; gap: 18px;
    }
    .dddk-panel-detail-hero {
      display: flex; align-items: center; justify-content: center;
      min-height: 160px;
      border-radius: 12px;
      background: var(--dddk-bg-elevated, rgba(0, 0, 0, 0.03));
      overflow: hidden;
    }
    .dddk-panel-detail-hero img {
      max-width: 100%; max-height: 240px; object-fit: contain;
      border-radius: 12px;
    }
    .dddk-panel-detail-title {
      font-size: 16px; font-weight: 600;
      color: var(--dddk-text, #1a1a1a);
      text-align: center;
    }

    /* Info table — key/value rows. */
    .dddk-panel-info {
      display: flex; flex-direction: column;
      border-top: 1px solid var(--dddk-border, rgba(0, 0, 0, 0.06));
      padding-top: 12px;
    }
    .dddk-panel-info-row {
      display: flex; align-items: baseline; justify-content: space-between;
      padding: 9px 0;
      border-bottom: 1px solid var(--dddk-border-subtle, rgba(0, 0, 0, 0.04));
      font-size: 13px;
    }
    .dddk-panel-info-row:last-child { border-bottom: 0; }
    .dddk-panel-info-key {
      color: var(--dddk-text-muted, #64748b);
      font-weight: 500;
    }
    .dddk-panel-info-value {
      color: var(--dddk-text, #1a1a1a);
      text-align: right;
      max-width: 70%;
      word-break: break-word;
    }
    .dddk-panel-info-value code {
      font-family: var(--dddk-mono, ui-monospace, "SF Mono", Menlo, monospace);
      font-size: 12.5px;
      background: var(--dddk-row-hover, rgba(0, 0, 0, 0.05));
      padding: 1px 5px;
      border-radius: 4px;
    }

    /* Pill / tag chip. */
    .dddk-panel-pill {
      display: inline-flex; align-items: center;
      padding: 3px 10px;
      border-radius: 999px;
      background: var(--dddk-row-hover, rgba(0, 0, 0, 0.06));
      color: var(--dddk-text, #1a1a1a);
      font-size: 12px;
      font-weight: 500;
      line-height: 1.4;
    }
    .dddk-panel-pill[data-tone="accent"] {
      background: var(--dddk-accent-soft, rgba(99, 102, 241, 0.12));
      color: var(--dddk-accent, #4f46e5);
    }
    .dddk-panel-pill[data-tone="success"] {
      background: rgba(34, 197, 94, 0.12);
      color: rgb(21, 128, 61);
    }
    .dddk-panel-pill[data-tone="warning"] {
      background: rgba(245, 158, 11, 0.14);
      color: rgb(180, 83, 9);
    }

    /* Card grid — responsive product / item gallery. */
    .dddk-panel-card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
      padding: 14px 16px 18px;
    }
    .dddk-panel-card {
      display: flex; flex-direction: column; gap: 8px;
      padding: 14px;
      border-radius: 12px;
      background: var(--dddk-bg-elevated, rgba(0, 0, 0, 0.02));
      border: 1px solid var(--dddk-border, rgba(0, 0, 0, 0.06));
      cursor: pointer;
      transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
    }
    .dddk-panel-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 24px -10px rgba(0, 0, 0, 0.2);
      background: var(--dddk-row-hover, rgba(0, 0, 0, 0.04));
    }
    .dddk-panel-card-hero {
      height: 96px;
      border-radius: 8px;
      background: var(--dddk-accent-soft, rgba(99, 102, 241, 0.1));
      display: flex; align-items: center; justify-content: center;
      font-size: 28px;
      color: var(--dddk-accent, #4f46e5);
    }
    .dddk-panel-card-title {
      font-size: 14px; font-weight: 600;
      color: var(--dddk-text, #1a1a1a);
    }
    .dddk-panel-card-sub {
      font-size: 12.5px;
      color: var(--dddk-text-muted, #64748b);
      line-height: 1.5;
    }

    /* Empty state — for "no results" / first-time content. */
    .dddk-panel-empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 8px;
      padding: 48px 24px;
      text-align: center;
      color: var(--dddk-text-muted, #64748b);
      font-size: 13.5px;
    }
    .dddk-panel-empty-icon {
      font-size: 28px;
      opacity: 0.5;
    }


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
