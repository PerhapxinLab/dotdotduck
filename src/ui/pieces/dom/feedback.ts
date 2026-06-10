import type { PieceNode } from '../types';
import type { DomHelpers } from './_shared';

export function renderSpinner(el: HTMLElement): HTMLElement {
  el.textContent = '⋯';
  return el;
}

export function renderProgressBar(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const v = Math.min(100, Math.max(0, Number(h.read<number>(node, 'value', 0) ?? 0)));
  const track = document.createElement('div');
  track.style.cssText = 'background:rgba(0,0,0,0.08);height:6px;border-radius:3px;overflow:hidden;';
  const fill = document.createElement('div');
  fill.style.cssText =
    `width:${v}%;height:100%;background:var(--dddk-accent, #6366f1);transition:width 200ms;`;
  track.appendChild(fill);
  el.appendChild(track);
  return el;
}

export function renderEmptyState(el: HTMLElement, node: PieceNode): HTMLElement {
  el.style.cssText = 'padding:24px;text-align:center;color:var(--dddk-text-muted, #6b6b6b);';
  const icon = document.createElement('div');
  icon.style.cssText = 'font-size:28px;margin-bottom:8px;';
  icon.textContent = String(node.icon ?? '∅');
  el.appendChild(icon);
  const title = document.createElement('div');
  title.textContent = String(node.title ?? '');
  el.appendChild(title);
  if (node.description) {
    const small = document.createElement('small');
    small.textContent = String(node.description);
    el.appendChild(small);
  }
  return el;
}

export function renderErrorState(el: HTMLElement, node: PieceNode): HTMLElement {
  el.style.cssText =
    'padding:16px;background:rgba(239,68,68,0.08);border:1px solid #ef4444;' +
    'border-radius:6px;color:#991b1b;';
  const strong = document.createElement('strong');
  strong.textContent = String(node.title ?? 'Error');
  el.appendChild(strong);
  if (node.message) {
    const msg = document.createElement('div');
    msg.style.cssText = 'margin-top:4px;font-size:13px;';
    msg.textContent = String(node.message);
    el.appendChild(msg);
  }
  return el;
}
