import type { PieceNode } from '../types';
import { applyInputStyle, fieldWrap, type DomHelpers } from './_shared';

export function renderTextInput(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const f = fieldWrap(node);
  const input = document.createElement('input');
  input.type = node.kind === 'PasswordField' ? 'password' : 'text';
  applyInputStyle(input);
  input.value = String(h.read<string>(node, 'value', '') ?? '');
  if (node.placeholder) input.placeholder = String(node.placeholder);
  input.addEventListener('input', () => {
    if (node.bind) h.setBinding(String(node.bind), input.value);
  });
  f.appendChild(input);
  el.appendChild(f);
  return el;
}

export function renderTextArea(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const f = fieldWrap(node);
  const ta = document.createElement('textarea');
  applyInputStyle(ta);
  ta.rows = Number(node.rows ?? 3);
  ta.value = String(h.read<string>(node, 'value', '') ?? '');
  if (node.placeholder) ta.placeholder = String(node.placeholder);
  ta.addEventListener('input', () => {
    if (node.bind) h.setBinding(String(node.bind), ta.value);
  });
  f.appendChild(ta);
  el.appendChild(f);
  return el;
}

export function renderNumberField(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const f = fieldWrap(node);
  const input = document.createElement('input');
  input.type = 'number';
  applyInputStyle(input);
  input.value = String(h.read<number>(node, 'value', 0) ?? 0);
  if (node.min != null) input.min = String(node.min);
  if (node.max != null) input.max = String(node.max);
  if (node.step != null) input.step = String(node.step);
  input.addEventListener('input', () => {
    if (node.bind) h.setBinding(String(node.bind), Number(input.value));
  });
  f.appendChild(input);
  el.appendChild(f);
  return el;
}

export function renderCheckbox(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const lbl = document.createElement('label');
  lbl.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer;';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(h.read<boolean>(node, 'value', false));
  input.addEventListener('change', () => {
    if (node.bind) h.setBinding(String(node.bind), input.checked);
  });
  lbl.appendChild(input);
  const span = document.createElement('span');
  span.textContent = String(node.label ?? '');
  lbl.appendChild(span);
  el.appendChild(lbl);
  return el;
}

export function renderSwitch(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const checked = Boolean(h.read<boolean>(node, 'value', false));
  const lbl = document.createElement('label');
  lbl.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer;';
  const track = document.createElement('span');
  track.style.cssText =
    'width:32px;height:18px;border-radius:9px;position:relative;display:inline-block;' +
    `background:${checked ? 'var(--dddk-accent, #6366f1)' : 'rgba(0,0,0,0.2)'};` +
    'transition:background 120ms;';
  const knob = document.createElement('span');
  knob.style.cssText =
    `position:absolute;top:2px;left:${checked ? 16 : 2}px;` +
    'width:14px;height:14px;border-radius:50%;background:#fff;transition:left 120ms;';
  track.appendChild(knob);
  track.addEventListener('click', () => {
    if (node.bind) h.setBinding(String(node.bind), !checked);
  });
  lbl.appendChild(track);
  if (node.label) {
    const span = document.createElement('span');
    span.textContent = String(node.label);
    lbl.appendChild(span);
  }
  el.appendChild(lbl);
  return el;
}

export function renderPicker(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const f = fieldWrap(node);
  const sel = document.createElement('select');
  applyInputStyle(sel);
  const opts = (node.options as Array<string | { value: string; label: string }>) ?? [];
  const current = String(h.read<string>(node, 'value', '') ?? '');
  for (const o of opts) {
    const v = typeof o === 'string' ? o : o.value;
    const l = typeof o === 'string' ? o : o.label;
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = l;
    if (v === current) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => {
    if (node.bind) h.setBinding(String(node.bind), sel.value);
  });
  f.appendChild(sel);
  el.appendChild(f);
  return el;
}

export function renderDatePicker(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const f = fieldWrap(node);
  const input = document.createElement('input');
  input.type = 'datetime-local';
  applyInputStyle(input);
  input.value = String(h.read<string>(node, 'value', '') ?? '');
  input.addEventListener('input', () => {
    if (node.bind) h.setBinding(String(node.bind), input.value);
  });
  f.appendChild(input);
  el.appendChild(f);
  return el;
}

export function renderSlider(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const f = fieldWrap(node);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(node.min ?? 0);
  input.max = String(node.max ?? 100);
  input.step = String(node.step ?? 1);
  input.value = String(h.read<number>(node, 'value', 0) ?? 0);
  input.addEventListener('input', () => {
    if (node.bind) h.setBinding(String(node.bind), Number(input.value));
  });
  f.appendChild(input);
  el.appendChild(f);
  return el;
}

export function renderFilePicker(el: HTMLElement, node: PieceNode, h: DomHelpers): HTMLElement {
  const f = fieldWrap(node);
  const input = document.createElement('input');
  input.type = 'file';
  if (node.accept) input.accept = String(node.accept);
  if (node.multiple) input.multiple = true;
  input.addEventListener('change', () => {
    if (!node.bind) return;
    h.setBinding(String(node.bind), Array.from(input.files ?? []));
  });
  f.appendChild(input);
  el.appendChild(f);
  return el;
}
