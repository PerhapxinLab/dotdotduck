/**
 * PinnedPanel — a corner-anchored frame whose body is a `PieceSurface`.
 *
 * The frame owns: placement (one of the four screen corners), the close
 * button, the optional title / subtitle / footer chrome, animation, and
 * dismiss lifecycle. Everything inside is rendered by `PieceDomRenderer`
 * — the same renderer that powers the palette detail pane — so layout
 * (`Card` / `Stack` / `Grid` / `Tabs`), inputs (`Checkbox` / `Button` /
 * `TextField` / `Switch` …), data (`Listing` / `Metric` / `ProgressBar`)
 * and `Slot` host-supplied content all work out of the box.
 *
 *   const handle = dddk.panel.create({
 *     id: 'getting-started',
 *     placement: 'bottom-right',
 *     title: 'The Basics',
 *     subtitle: 'Setup the basics to get your team started',
 *     surface: {
 *       root: {
 *         kind: 'Stack', gap: 10, children: [
 *           { kind: 'ProgressBar', bind: '/progress' },
 *           { kind: 'Checkbox', bind: '/tasks/create',  label: 'Create your first project' },
 *           { kind: 'Button',    text: 'Create',  variant: 'primary', action: 'create' },
 *           { kind: 'Checkbox', bind: '/tasks/invite',  label: 'Invite your team' },
 *         ],
 *       },
 *       data: { progress: 0, tasks: {} },
 *     },
 *     onAction: (name, payload, data) => { ... },
 *     onDataChange: (data) => { ... },
 *   });
 *
 *   handle.setData({ progress: 50, tasks: { create: true } });
 *   handle.unmount();
 */

import { injectScopedStyle } from '../utils/dom';
import { PieceDomRenderer } from '../ui/pieces/dom-renderer';
import type { PieceCatalog, PieceSurface } from '../ui/pieces/types';

export type PinnedPanelPlacement =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left';

export interface PinnedPanelSpec {
  /** Stable id — re-creating with the same id replaces the existing panel. */
  id: string;
  /** Title rendered in the panel header. Hide the header by setting both
   *  `title` and `subtitle` to empty / undefined. */
  title?: string;
  subtitle?: string;
  /** Default `bottom-right`. */
  placement?: PinnedPanelPlacement;
  /** Body — any Pieces tree. See `PieceDomRenderer` for the catalog. */
  surface: PieceSurface;
  /** Renders a small × button in the header. Default `true`. */
  dismissible?: boolean;
  /** Footer caption (e.g. "Powered by Acme"). */
  footer?: string;
  /** Host can swap the piece catalog (e.g. to register custom kinds). */
  catalog?: PieceCatalog;
  /** Fired by Button / IconButton / Link clicks inside the surface. */
  onAction?: (name: string, payload: unknown, data: Record<string, unknown>) => void;
  /** Fired on every input change inside the surface. */
  onDataChange?: (data: Record<string, unknown>) => void;
  /** Fired when the user dismisses via the × button. */
  onDismiss?: (handle: PinnedPanelHandle) => void;
}

export interface PinnedPanelHandle {
  readonly id: string;
  /** Mount / show the panel. Idempotent. */
  show(): void;
  /** Hide and detach from the DOM (panel can be re-shown). */
  hide(): void;
  /** Whether the panel is currently in the DOM. */
  isVisible(): boolean;
  /** Replace any subset of the spec — the panel re-renders in place. */
  update(patch: Partial<Omit<PinnedPanelSpec, 'id'>>): void;
  /** Read the current data model from the surface. */
  getData(): Record<string, unknown>;
  /** Replace the data model wholesale. */
  setData(data: Record<string, unknown>): void;
  /** Permanently remove and forget this panel. */
  unmount(): void;
}

import { UI_ATTR } from '../utils/dom';
const STYLE_ID = 'dddk-pinned-panel-style';

const PANEL_CSS = `
  [${UI_ATTR}="pinned-panel"] {
    position: fixed;
    width: min(360px, calc(100vw - 24px));
    max-height: calc(100vh - 48px);
    overflow: hidden;
    background: var(--dddk-bg-elevated, #fff);
    color: var(--dddk-text, #18181b);
    border: 1px solid var(--dddk-border, rgba(0,0,0,0.08));
    border-radius: var(--dddk-pinned-panel-radius, 12px);
    box-shadow: var(--dddk-shadow-lg, 0 12px 32px rgba(0,0,0,0.16));
    font-family: var(--dddk-font, system-ui, sans-serif);
    z-index: var(--dddk-z-pinned, 9450);
    display: flex; flex-direction: column;
    animation: dddk-pinned-fade 180ms cubic-bezier(0.2,0,0,1);
  }
  [${UI_ATTR}="pinned-panel"][data-placement="bottom-right"] { right: 18px; bottom: 18px; }
  [${UI_ATTR}="pinned-panel"][data-placement="bottom-left"]  { left:  18px; bottom: 18px; }
  [${UI_ATTR}="pinned-panel"][data-placement="top-right"]    { right: 18px; top:    18px; }
  [${UI_ATTR}="pinned-panel"][data-placement="top-left"]     { left:  18px; top:    18px; }

  [${UI_ATTR}="pinned-panel-head"] {
    padding: 14px 16px 10px;
    display: flex; align-items: flex-start; gap: 10px;
  }
  [${UI_ATTR}="pinned-panel-head-text"] { flex: 1; min-width: 0; }
  [${UI_ATTR}="pinned-panel-title"] {
    font-size: 14px; font-weight: 600;
    color: var(--dddk-text, #18181b);
    line-height: 1.35;
  }
  [${UI_ATTR}="pinned-panel-subtitle"] {
    margin-top: 2px;
    font-size: 12px; color: var(--dddk-text-muted, #71717a);
    line-height: 1.45;
  }
  [${UI_ATTR}="pinned-panel-close"] {
    appearance: none; border: 0; background: transparent;
    color: var(--dddk-text-muted, #71717a);
    cursor: pointer; padding: 2px 6px; font-size: 16px;
    border-radius: 4px;
  }
  [${UI_ATTR}="pinned-panel-close"]:hover {
    background: var(--dddk-row-hover, rgba(0,0,0,0.05));
    color: var(--dddk-text, #18181b);
  }

  [${UI_ATTR}="pinned-panel-body"] {
    flex: 1; overflow-y: auto;
    padding: 4px 16px 14px;
  }

  [${UI_ATTR}="pinned-panel-footer"] {
    padding: 8px 14px;
    border-top: 1px solid var(--dddk-border, rgba(0,0,0,0.05));
    font-size: 11px;
    text-align: right;
    color: var(--dddk-text-muted, #71717a);
  }

  @keyframes dddk-pinned-fade {
    from { transform: translateY(8px); opacity: 0; }
    to   { transform: translateY(0);   opacity: 1; }
  }

  @media (max-width: 480px) {
    [${UI_ATTR}="pinned-panel"] {
      left: 12px; right: 12px;
      width: auto;
    }
    [${UI_ATTR}="pinned-panel"][data-placement="bottom-right"],
    [${UI_ATTR}="pinned-panel"][data-placement="bottom-left"] {
      bottom: 12px; top: auto;
    }
    [${UI_ATTR}="pinned-panel"][data-placement="top-right"],
    [${UI_ATTR}="pinned-panel"][data-placement="top-left"] {
      top: 12px; bottom: auto;
    }
  }
`;

let stylesEnsured = false;
function ensureStyles(): void {
  if (stylesEnsured) return;
  stylesEnsured = true;
  injectScopedStyle(STYLE_ID, PANEL_CSS);
}

/**
 * Owns the active set of pinned panels keyed by id. Re-creating with the
 * same id replaces the existing panel so the registry stays clean.
 */
export class PinnedPanelRegistry {
  private panels = new Map<string, InternalPanel>();

  create(spec: PinnedPanelSpec, opts: { showImmediately?: boolean } = {}): PinnedPanelHandle {
    const existing = this.panels.get(spec.id);
    if (existing) existing.handle.unmount();
    const panel = new InternalPanel(spec, () => this.panels.delete(spec.id));
    this.panels.set(spec.id, panel);
    if (opts.showImmediately !== false) panel.handle.show();
    return panel.handle;
  }

  get(id: string): PinnedPanelHandle | undefined {
    return this.panels.get(id)?.handle;
  }

  clear(): void {
    for (const p of Array.from(this.panels.values())) p.handle.unmount();
    this.panels.clear();
  }
}

class InternalPanel {
  readonly handle: PinnedPanelHandle;
  private spec: PinnedPanelSpec;
  private rootEl: HTMLDivElement | null = null;
  private bodyEl: HTMLDivElement | null = null;
  private renderer: PieceDomRenderer | null = null;

  constructor(spec: PinnedPanelSpec, onUnmount: () => void) {
    this.spec = spec;

    const self = this;
    this.handle = {
      get id() { return self.spec.id; },
      show: () => self.mount(),
      hide: () => self.detach(),
      isVisible: () => self.rootEl !== null,
      update: (patch) => self.applyPatch(patch),
      getData: () => self.renderer?.getData() ?? {},
      setData: (data) => self.renderer?.setData(data),
      unmount: () => {
        self.detach();
        onUnmount();
      },
    };
  }

  private mount(): void {
    if (this.rootEl) return;
    ensureStyles();
    const root = document.createElement('div');
    root.setAttribute(UI_ATTR, 'pinned-panel');
    root.setAttribute('data-id', this.spec.id);
    root.setAttribute('data-placement', this.spec.placement ?? 'bottom-right');
    this.rootEl = root;
    document.body.appendChild(root);
    this.renderChrome();
  }

  private detach(): void {
    if (this.renderer) {
      this.renderer.unmount();
      this.renderer = null;
    }
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }
    this.bodyEl = null;
  }

  private applyPatch(patch: Partial<Omit<PinnedPanelSpec, 'id'>>): void {
    const surfaceChanged = patch.surface !== undefined && patch.surface !== this.spec.surface;
    this.spec = { ...this.spec, ...patch };
    if (!this.rootEl) return;
    if (patch.placement) this.rootEl.setAttribute('data-placement', patch.placement);
    if (
      patch.title !== undefined ||
      patch.subtitle !== undefined ||
      patch.footer !== undefined ||
      patch.dismissible !== undefined
    ) {
      this.renderChrome();
      return;
    }
    if (surfaceChanged && this.renderer && this.spec.surface) {
      this.renderer.update(this.spec.surface);
    }
  }

  private renderChrome(): void {
    const root = this.rootEl;
    if (!root) return;
    root.innerHTML = '';

    const showHeader = this.spec.title || this.spec.subtitle || this.spec.dismissible !== false;
    if (showHeader) {
      const head = document.createElement('div');
      head.setAttribute(UI_ATTR, 'pinned-panel-head');
      const headText = document.createElement('div');
      headText.setAttribute(UI_ATTR, 'pinned-panel-head-text');
      if (this.spec.title) {
        const title = document.createElement('div');
        title.setAttribute(UI_ATTR, 'pinned-panel-title');
        title.textContent = this.spec.title;
        headText.appendChild(title);
      }
      if (this.spec.subtitle) {
        const sub = document.createElement('div');
        sub.setAttribute(UI_ATTR, 'pinned-panel-subtitle');
        sub.textContent = this.spec.subtitle;
        headText.appendChild(sub);
      }
      head.appendChild(headText);
      if (this.spec.dismissible !== false) {
        const close = document.createElement('button');
        close.type = 'button';
        close.setAttribute(UI_ATTR, 'pinned-panel-close');
        close.textContent = '×';
        close.title = 'Dismiss';
        close.addEventListener('click', () => {
          this.spec.onDismiss?.(this.handle);
          this.handle.unmount();
        });
        head.appendChild(close);
      }
      root.appendChild(head);
    }

    const body = document.createElement('div');
    body.setAttribute(UI_ATTR, 'pinned-panel-body');
    root.appendChild(body);
    this.bodyEl = body;

    // Mount the renderer onto the body. Reuse the existing renderer's
    // data when present so chrome-only updates don't reset user inputs.
    const previousData = this.renderer?.getData();
    if (this.renderer) this.renderer.unmount();
    this.renderer = new PieceDomRenderer({
      catalog: this.spec.catalog,
      onAction: (name, payload, data) => this.spec.onAction?.(name, payload, data),
      onDataChange: (data) => this.spec.onDataChange?.(data),
    });
    this.renderer.mount(body, this.spec.surface);
    if (previousData) this.renderer.setData({ ...previousData });

    if (this.spec.footer) {
      const footer = document.createElement('div');
      footer.setAttribute(UI_ATTR, 'pinned-panel-footer');
      footer.textContent = this.spec.footer;
      root.appendChild(footer);
    }
  }
}
