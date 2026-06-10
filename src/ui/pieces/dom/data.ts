import type { PieceNode } from '../types';
import { escapeHtml, type DomHelpers } from './_shared';

export function renderListing(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  type Item = { id: string; title: string; subtitle?: string; accessory?: string; icon?: string };
  const items = h.read<Item[]>(node, 'items', []);
  const ul = document.createElement('ul');
  ul.style.cssText = 'list-style:none;margin:0;padding:0;';
  for (const it of items) {
    const li = document.createElement('li');
    li.style.cssText =
      'display:flex;gap:8px;padding:6px 8px;' +
      'border-bottom:1px solid var(--dddk-border, rgba(0,0,0,0.05));';
    if (it.icon) {
      const ic = document.createElement('span');
      ic.textContent = it.icon;
      li.appendChild(ic);
    }
    const text = document.createElement('div');
    text.style.cssText = 'flex:1;min-width:0;';
    const t = document.createElement('div');
    t.textContent = it.title;
    text.appendChild(t);
    if (it.subtitle) {
      const s = document.createElement('small');
      s.style.color = 'var(--dddk-text-muted, #6b6b6b)';
      s.textContent = it.subtitle;
      text.appendChild(s);
    }
    li.appendChild(text);
    if (it.accessory) {
      const a = document.createElement('span');
      a.style.color = 'var(--dddk-text-muted, #6b6b6b)';
      a.textContent = it.accessory;
      li.appendChild(a);
    }
    ul.appendChild(li);
  }
  el.appendChild(ul);
  return el;
}

export function renderTable(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const columns = (node.columns as Array<{ key: string; label: string }>) ?? [];
  const rows = h.read<Array<Record<string, unknown>>>(node, 'rows', []);
  const table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const c of columns) {
    const th = document.createElement('th');
    th.style.cssText =
      'text-align:left;padding:6px;border-bottom:1px solid var(--dddk-border, rgba(0,0,0,0.08));';
    th.textContent = c.label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const c of columns) {
      const td = document.createElement('td');
      td.style.cssText =
        'padding:6px;border-bottom:1px solid var(--dddk-border, rgba(0,0,0,0.05));';
      td.textContent = String(r[c.key] ?? '');
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  el.appendChild(table);
  return el;
}

export function renderMetric(el: HTMLElement, node: PieceNode): HTMLElement {
  const trend = String(node.trend ?? 'flat');
  const color = trend === 'up' ? '#10b981' : trend === 'down' ? '#ef4444' : '#6b6b6b';
  const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '–';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
  if (node.label) {
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:11px;color:var(--dddk-text-muted, #6b6b6b);';
    lbl.textContent = String(node.label);
    wrap.appendChild(lbl);
  }
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:baseline;gap:8px;';
  const strong = document.createElement('strong');
  strong.style.fontSize = '22px';
  strong.textContent = String(node.value ?? '');
  row.appendChild(strong);
  if (node.delta != null) {
    const d = document.createElement('span');
    d.style.cssText = `color:${color};font-size:12px;`;
    d.textContent = `${arrow} ${node.delta}`;
    row.appendChild(d);
  }
  wrap.appendChild(row);
  el.appendChild(wrap);
  return el;
}

export function renderTimeline(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  type Evt = { id: string; time: string; title: string; note?: string };
  const events = h.read<Evt[]>(node, 'events', []);
  const ol = document.createElement('ol');
  ol.style.cssText =
    'list-style:none;margin:0;padding:0;border-left:2px solid var(--dddk-border, rgba(0,0,0,0.08));';
  for (const e of events) {
    const li = document.createElement('li');
    li.style.cssText = 'margin-left:12px;padding-left:12px;padding-bottom:12px;position:relative;';
    li.innerHTML = `
      <span style="position:absolute;left:-19px;top:6px;width:8px;height:8px;border-radius:50%;
        background:var(--dddk-accent, #6366f1);"></span>
      <small style="color:var(--dddk-text-muted, #6b6b6b)">${escapeHtml(e.time)}</small>
      <div>${escapeHtml(e.title)}</div>
      ${e.note ? `<small style="color:var(--dddk-text-muted, #6b6b6b)">${escapeHtml(e.note)}</small>` : ''}
    `;
    ol.appendChild(li);
  }
  el.appendChild(ol);
  return el;
}
