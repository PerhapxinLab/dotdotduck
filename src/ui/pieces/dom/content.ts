import type { PieceNode } from '../types';
import { tone } from '../tokens';
import type { DomHelpers } from './_shared';

export function renderHeading(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const level = Math.min(6, Math.max(1, Number(node.level ?? 3)));
  const tag = document.createElement(`h${level}`);
  tag.style.margin = '0 0 8px 0';
  tag.textContent = h.read<string>(node, 'text', '');
  el.appendChild(tag);
  return el;
}

export function renderText(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  el.style.display = 'inline';
  el.textContent = h.read<string>(node, 'text', '');
  return el;
}

export function renderMarkdown(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  el.style.whiteSpace = 'pre-wrap';
  el.textContent = h.read<string>(node, 'text', '');
  return el;
}

export function renderCode(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const pre = document.createElement('pre');
  pre.style.cssText =
    'background:var(--dddk-bg, #fafafa);padding:8px;border-radius:6px;' +
    'font-family:var(--dddk-font-mono, ui-monospace, monospace);' +
    'font-size:12px;margin:0;overflow-x:auto;';
  pre.textContent = h.read<string>(node, 'code', '');
  el.appendChild(pre);
  return el;
}

export function renderImage(el: HTMLElement, node: PieceNode): HTMLElement {
  const img = document.createElement('img');
  img.src = String(node.src ?? '');
  img.alt = String(node.alt ?? '');
  img.style.cssText = 'max-width:100%;border-radius:6px;';
  el.appendChild(img);
  return el;
}

export function renderTag(el: HTMLElement, node: PieceNode): HTMLElement {
  const c = tone(node.tone);
  const span = document.createElement('span');
  span.style.cssText =
    `background:${c.bg};color:${c.fg};padding:2px 8px;border-radius:12px;` +
    'font-size:11px;font-weight:500;display:inline-block;';
  span.textContent = String(node.text ?? '');
  el.appendChild(span);
  return el;
}

export function renderDivider(el: HTMLElement): HTMLElement {
  const hr = document.createElement('hr');
  hr.style.cssText = 'border:0;border-top:1px solid var(--dddk-border, rgba(0,0,0,0.08));margin:8px 0;';
  el.appendChild(hr);
  return el;
}
