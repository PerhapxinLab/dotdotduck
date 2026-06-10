import type { PieceDefinition } from '../types';
import { BUTTON_VARIANTS_REACT } from '../tokens';
import { UI } from './_shared';

export const Button: PieceDefinition = {
  kind: 'Button',
  meta: { category: 'action' },
  render: (node, ctx) => {
    const variant = (node.variant as string) ?? 'primary';
    const style = BUTTON_VARIANTS_REACT[variant] ?? BUTTON_VARIANTS_REACT.primary!;
    return (
      <button type="button" {...{ [UI]: 'button' }}
        onClick={() => ctx.trigger((node.action as string) ?? 'submit', node.payload)}
        style={{
          ...style, padding: '6px 14px', borderRadius: 6, border: 0,
          font: 'inherit', cursor: 'pointer', fontWeight: 500,
        }}>
        {node.text as string}
      </button>
    );
  },
};

export const Link: PieceDefinition = {
  kind: 'Link',
  meta: { category: 'action' },
  render: (node) => (
    <a {...{ [UI]: 'link' }} href={node.href as string} target={node.target as string}
      style={{ color: 'var(--dddk-accent)', textDecoration: 'underline', cursor: 'pointer' }}>
      {node.text as string}
    </a>
  ),
};

export const IconButton: PieceDefinition = {
  kind: 'IconButton',
  meta: { category: 'action' },
  render: (node, ctx) => (
    <button type="button" {...{ [UI]: 'icon-button' }}
      title={node.title as string}
      onClick={() => ctx.trigger((node.action as string) ?? 'click', node.payload)}
      style={{ background: 'transparent', border: 0, cursor: 'pointer', padding: 4, fontSize: 16 }}>
      {node.icon as string}
    </button>
  ),
};
