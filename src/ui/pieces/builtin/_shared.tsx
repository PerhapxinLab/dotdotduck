/**
 * Shared helpers for React built-in pieces.
 */

import type { ReactNode } from 'react';
import type { PieceContext, PieceNode } from '../types';

export const UI = 'data-dddk-piece';

export function Frag({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function renderChildren(node: PieceNode, ctx: PieceContext): ReactNode {
  const children = node.children as PieceNode[] | undefined;
  if (!children) return null;
  return children.map((c, i) => <Frag key={c.id ?? i}>{ctx.render(c)}</Frag>);
}

export function field(node: PieceNode, child: ReactNode) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
      {node.label != null && <span>{node.label as string}</span>}
      {child}
    </label>
  );
}

/**
 * Roving-tabindex keyboard handler shared by OptionGroup / ChoiceList.
 * Arrow keys move focus among siblings under the same parent; Enter/Space
 * confirms via the supplied `onConfirm`. Layout `row` swaps left/right with
 * up/down (the focused control is grid-shaped, both axes are valid).
 */
export function rovingTabindexKeyHandler<E extends HTMLElement>(
  e: React.KeyboardEvent<E>,
  idx: number,
  total: number,
  isRow: boolean,
  onConfirm: () => void,
): void {
  const key = e.key;
  if (key === 'Enter' || key === ' ') {
    e.preventDefault();
    onConfirm();
    return;
  }
  let next = idx;
  if (isRow) {
    if (key === 'ArrowLeft' || key === 'ArrowUp') next = (idx - 1 + total) % total;
    else if (key === 'ArrowRight' || key === 'ArrowDown') next = (idx + 1) % total;
  } else {
    if (key === 'ArrowUp' || key === 'ArrowLeft') next = (idx - 1 + total) % total;
    else if (key === 'ArrowDown' || key === 'ArrowRight') next = (idx + 1) % total;
  }
  if (next !== idx) {
    e.preventDefault();
    const parent = e.currentTarget.parentElement;
    const nextEl = parent?.children[next] as HTMLElement | undefined;
    nextEl?.focus();
  }
}
