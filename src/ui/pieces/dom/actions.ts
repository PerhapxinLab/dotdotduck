import type { PieceNode } from '../types';
import { BUTTON_VARIANTS_CSS } from '../tokens';
import type { DomHelpers } from './_shared';

export function renderButton(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const variant = String(node.variant ?? 'primary');
  const btn = document.createElement('button');
  btn.type = 'button';
  const variantCss = BUTTON_VARIANTS_CSS[variant] ?? BUTTON_VARIANTS_CSS.primary!;
  btn.style.cssText =
    `${variantCss}` +
    'padding:6px 14px;border-radius:6px;font:inherit;cursor:pointer;font-weight:500;';
  btn.textContent = String(node.text ?? '');
  btn.addEventListener('click', () => h.trigger(String(node.action ?? 'submit'), node.payload));
  el.appendChild(btn);
  return el;
}

export function renderLink(el: HTMLElement, node: PieceNode): HTMLElement {
  const a = document.createElement('a');
  a.href = String(node.href ?? '#');
  if (node.target) a.target = String(node.target);
  a.style.cssText = 'color:var(--dddk-accent, #6366f1);text-decoration:underline;cursor:pointer;';
  a.textContent = String(node.text ?? '');
  el.appendChild(a);
  return el;
}

export function renderIconButton(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  if (node.title) btn.title = String(node.title);
  btn.style.cssText = 'background:transparent;border:0;cursor:pointer;padding:4px;font-size:16px;';
  btn.textContent = String(node.icon ?? '');
  btn.addEventListener('click', () => h.trigger(String(node.action ?? 'click'), node.payload));
  el.appendChild(btn);
  return el;
}
