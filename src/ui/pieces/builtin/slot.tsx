import type { ReactNode } from 'react';
import type { PieceDefinition } from '../types';
import { UI } from './_shared';

export const Slot: PieceDefinition = {
  kind: 'Slot',
  meta: { category: 'slot', description: '渲染 host 提供的 React/Web component' },
  render: (node, ctx) => {
    if (typeof node.render === 'function') {
      return (node.render as (data: Record<string, unknown>) => ReactNode)(ctx.data);
    }
    if (typeof node.slotName === 'string') {
      const map = (typeof window !== 'undefined' &&
        (window as unknown as { __dddkSlots?: Record<string, ReactNode> }).__dddkSlots) || {};
      return map[node.slotName] ?? <div {...{ [UI]: 'slot-empty' }}>(slot:{node.slotName})</div>;
    }
    return null;
  },
};
