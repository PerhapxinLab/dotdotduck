/**
 * PieceDomRenderer — vanilla-DOM, interactive renderer for `PieceSurface`.
 * Same tree shape as the React renderer, no React dependency.
 */

import type { PieceCatalog, PieceNode, PieceSurface } from '../types';
import { readPointer, applyPointer } from '../pointer';
import type { DomHelpers } from './_shared';
import * as L from './layout';
import * as C from './content';
import * as D from './data';
import * as I from './inputs';
import * as A from './actions';
import * as F from './feedback';
import { renderSlot } from './slot';

export interface PieceDomRendererOptions {
  catalog?: PieceCatalog;
  /** Read-only mode — inputs render but ignore changes. Default `false`. */
  readOnly?: boolean;
  /** Fired by Button / IconButton / Link clicks. */
  onAction?: (name: string, payload: unknown, data: Record<string, unknown>) => void;
  /** Fired on every data-model mutation. */
  onDataChange?: (data: Record<string, unknown>) => void;
}

export class PieceDomRenderer {
  private opts: PieceDomRendererOptions;
  private data: Record<string, unknown> = {};
  private surface: PieceSurface | null = null;
  private host: HTMLElement | null = null;

  constructor(opts: PieceDomRendererOptions = {}) {
    this.opts = opts;
  }

  mount(parent: HTMLElement, surface: PieceSurface): void {
    this.host = parent;
    this.surface = surface;
    this.data = { ...(surface.data ?? {}) };
    this.repaint();
  }

  update(surface: PieceSurface): void {
    this.surface = surface;
    // Preserve any user edits — merge incoming data on top of existing.
    this.data = { ...this.data, ...(surface.data ?? {}) };
    this.repaint();
  }

  setData(data: Record<string, unknown>): void {
    this.data = { ...data };
    this.opts.onDataChange?.(this.data);
    this.repaint();
  }

  getData(): Record<string, unknown> {
    return { ...this.data };
  }

  unmount(): void {
    if (this.host) this.host.innerHTML = '';
    this.host = null;
    this.surface = null;
  }

  private repaint(): void {
    if (!this.host || !this.surface) return;
    this.host.innerHTML = '';
    this.host.appendChild(this.renderNode(this.surface.root));
  }

  // QUICK FIX for focus-loss bug: each input rebuild via repaint() destroyed
  // the focused element. Until per-binding patching is implemented, skip the
  // repaint while the user is typing into a host-owned input — the input's
  // own `input` event has already updated its DOM value, so visually nothing
  // is lost. Any non-focused bindings re-resolve on the next repaint that
  // does fire (blur / button click / external setData). Bound siblings that
  // mirror the same value won't visually update mid-typing — accept that
  // for now; a follow-up should add real DOM diffing.
  private setBinding(path: string, value: unknown): void {
    if (this.opts.readOnly || !path) return;
    this.data = applyPointer(this.data, path, value);
    this.opts.onDataChange?.(this.data);
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (active && this.host?.contains(active)) return;
    this.repaint();
  }

  private trigger(name: string, payload?: unknown): void {
    this.opts.onAction?.(name, payload, this.data);
  }

  private read<T>(node: PieceNode, key: string, fallback?: T): T {
    if (node.bind) {
      const v = readPointer(this.data, String(node.bind));
      if (v !== undefined) return v as T;
    }
    const lit = node[key];
    if (lit !== undefined) return lit as T;
    return fallback as T;
  }

  private renderChildren(node: PieceNode): HTMLElement[] {
    const children = (node.children as PieceNode[] | undefined) ?? [];
    return children.map((c) => this.renderNode(c));
  }

  private helpers(): DomHelpers {
    return {
      read: (n, k, f) => this.read(n, k, f),
      renderNode: (n) => this.renderNode(n),
      renderChildren: (n) => this.renderChildren(n),
      setBinding: (p, v) => this.setBinding(p, v),
      trigger: (n, p) => this.trigger(n, p),
    };
  }

  private renderNode(node: PieceNode): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-dddk-piece', node.kind.toLowerCase());
    const h = this.helpers();

    switch (node.kind) {
      // Layout
      case 'Stack':         return L.renderStack(el, node, h);
      case 'Grid':          return L.renderGrid(el, node, h);
      case 'Split':         return L.renderSplit(el, node, h);
      case 'Card':          return L.renderCard(el, node, h);
      case 'Group':         return L.renderGroup(el, node, h);
      case 'Tabs':          return L.renderTabs(el, node, h);

      // Content
      case 'Heading':       return C.renderHeading(el, node, h);
      case 'Text':          return C.renderText(el, node, h);
      case 'Markdown':      return C.renderMarkdown(el, node, h);
      case 'Code':          return C.renderCode(el, node, h);
      case 'Image':         return C.renderImage(el, node);
      case 'Tag':           return C.renderTag(el, node);
      case 'Divider':       return C.renderDivider(el);

      // Data
      case 'Listing':       return D.renderListing(el, node, h);
      case 'Table':         return D.renderTable(el, node, h);
      case 'Metric':        return D.renderMetric(el, node);
      case 'Timeline':      return D.renderTimeline(el, node, h);

      // Input
      case 'TextField':
      case 'PasswordField': return I.renderTextInput(el, node, h);
      case 'TextArea':      return I.renderTextArea(el, node, h);
      case 'NumberField':   return I.renderNumberField(el, node, h);
      case 'Checkbox':      return I.renderCheckbox(el, node, h);
      case 'Switch':        return I.renderSwitch(el, node, h);
      case 'Picker':        return I.renderPicker(el, node, h);
      case 'DatePicker':    return I.renderDatePicker(el, node, h);
      case 'Slider':        return I.renderSlider(el, node, h);
      case 'FilePicker':    return I.renderFilePicker(el, node, h);

      // Action
      case 'Button':        return A.renderButton(el, node, h);
      case 'Link':          return A.renderLink(el, node);
      case 'IconButton':    return A.renderIconButton(el, node, h);

      // Feedback
      case 'Spinner':       return F.renderSpinner(el);
      case 'ProgressBar':   return F.renderProgressBar(el, node, h);
      case 'EmptyState':    return F.renderEmptyState(el, node);
      case 'ErrorState':    return F.renderErrorState(el, node);

      // Slot
      case 'Slot':          return renderSlot(el, node);

      default: {
        const def = this.opts.catalog?.get(node.kind);
        el.style.cssText = 'padding:6px;background:rgba(0,0,0,0.03);border-radius:4px;font-size:12px;color:#6b6b6b;';
        el.textContent = def ? `<${node.kind}>` : `Unknown piece: ${node.kind}`;
        return el;
      }
    }
  }
}
