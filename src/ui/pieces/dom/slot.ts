import type { PieceNode } from '../types';

export function renderSlot(el: HTMLElement, node: PieceNode): HTMLElement {
  const slotName = node.slotName;
  if (typeof slotName === 'string') {
    const map =
      (typeof window !== 'undefined' &&
        (window as unknown as { __dddkSlotElements?: Record<string, HTMLElement> }).__dddkSlotElements) ||
      {};
    const supplied = map[slotName];
    if (supplied) {
      el.appendChild(supplied);
      return el;
    }
  }
  el.style.cssText = 'padding:8px;background:rgba(0,0,0,0.04);border-radius:4px;font-size:11px;color:#6b6b6b;';
  el.textContent = `Slot: ${slotName ?? '(inline)'}`;
  return el;
}
