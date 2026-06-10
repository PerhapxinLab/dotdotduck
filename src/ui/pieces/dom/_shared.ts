/**
 * DOM-renderer shared helpers + the `DomHelpers` surface that each
 * per-category renderer module receives. Decouples sub-renderers from the
 * main class so they're testable and don't import it transitively.
 */

import type { PieceNode } from '../types';
import { BASE_INPUT_CSS } from '../tokens';

export interface DomHelpers {
  /** Resolve `node.bind` first, then literal `node[key]`, then `fallback`. */
  read<T>(node: PieceNode, key: string, fallback?: T): T;
  /** Recursively render a child piece. */
  renderNode(node: PieceNode): HTMLElement;
  /** Render every `node.children` entry to an array of elements. */
  renderChildren(node: PieceNode): HTMLElement[];
  /** Mutate bound state path. */
  setBinding(path: string, value: unknown): void;
  /** Fire a named action. */
  trigger(name: string, payload?: unknown): void;
}

export function applyInputStyle(el: HTMLElement): void {
  el.style.cssText = BASE_INPUT_CSS;
}

export function px(value: unknown, fallback: number): string {
  if (typeof value === 'number') return `${value}px`;
  if (typeof value === 'string') return value;
  return `${fallback}px`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

export function appendAll(parent: HTMLElement, children: HTMLElement[]): void {
  for (const c of children) parent.appendChild(c);
}

export function fieldWrap(node: PieceNode): HTMLElement {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;font-size:13px;';
  if (node.label != null) {
    const span = document.createElement('span');
    span.textContent = String(node.label);
    wrap.appendChild(span);
  }
  return wrap;
}
