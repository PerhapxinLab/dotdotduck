import type { PieceNode } from '../types';
import { appendAll, px, type DomHelpers } from './_shared';

export function renderStack(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  el.style.display = 'flex';
  el.style.flexDirection = node.direction === 'horizontal' ? 'row' : 'column';
  el.style.gap = px(node.gap, 8);
  el.style.alignItems = String(node.align ?? 'stretch');
  appendAll(el, h.renderChildren(node));
  return el;
}

export function renderGrid(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  el.style.display = 'grid';
  el.style.gridTemplateColumns = `repeat(${Number(node.columns ?? 2)}, minmax(0,1fr))`;
  el.style.gap = px(node.gap, 8);
  appendAll(el, h.renderChildren(node));
  return el;
}

export function renderSplit(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  el.style.display = 'grid';
  el.style.gridTemplateColumns = '1fr 1fr';
  el.style.gap = '12px';
  appendAll(el, h.renderChildren(node));
  return el;
}

export function renderCard(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  el.style.background = 'var(--dddk-bg-elevated, #fff)';
  el.style.borderRadius = 'var(--dddk-radius, 12px)';
  el.style.padding = '16px';
  el.style.boxShadow = 'var(--dddk-shadow-md, 0 1px 3px rgba(0,0,0,0.05))';
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.gap = '12px';
  appendAll(el, h.renderChildren(node));
  return el;
}

export function renderGroup(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  el.style.display = 'flex';
  el.style.flexDirection = node.direction === 'horizontal' ? 'row' : 'column';
  el.style.gap = px(node.gap, 8);
  el.style.alignItems = String(node.align ?? 'stretch');
  appendAll(el, h.renderChildren(node));
  return el;
}

export function renderTabs(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const tabs = (node.tabs as Array<{ id: string; label: string; content: PieceNode }>) ?? [];
  const activeKey = node.bind ?? (node.id ? `__activeTab_${node.id}` : '__activeTab');
  const active = (h.read<string>(
    { kind: 'Tabs', bind: activeKey } as PieceNode,
    'active',
    tabs[0]?.id ?? '',
  )) || tabs[0]?.id;

  const bar = document.createElement('div');
  bar.style.display = 'flex';
  bar.style.gap = '8px';
  bar.style.borderBottom = '1px solid var(--dddk-border, rgba(0,0,0,0.08))';
  for (const t of tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = t.label;
    btn.style.padding = '6px 12px';
    btn.style.background = 'transparent';
    btn.style.border = '0';
    btn.style.borderBottom = t.id === active
      ? '2px solid var(--dddk-accent, #6366f1)'
      : '2px solid transparent';
    btn.style.cursor = 'pointer';
    btn.style.font = 'inherit';
    btn.addEventListener('click', () => h.setBinding(String(activeKey), t.id));
    bar.appendChild(btn);
  }
  el.appendChild(bar);

  const panel = document.createElement('div');
  panel.style.padding = '12px';
  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];
  if (activeTab) panel.appendChild(h.renderNode(activeTab.content));
  el.appendChild(panel);
  return el;
}
