import type { PieceDefinition } from '../types';
import { resolveValue } from '../renderer';
import { UI } from './_shared';

export const Spinner: PieceDefinition = {
  kind: 'Spinner',
  meta: { category: 'feedback' },
  render: () => <span {...{ [UI]: 'spinner' }}>⋯</span>,
};

export const ProgressBar: PieceDefinition = {
  kind: 'ProgressBar',
  meta: { category: 'feedback' },
  render: (node, ctx) => {
    const v = Number(resolveValue<number>(node, ctx, 'value', 0)) || 0;
    return (
      <div style={{ background: 'rgba(0,0,0,0.08)', height: 6, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          width: `${Math.min(100, Math.max(0, v))}%`, height: '100%',
          background: 'var(--dddk-accent, #3b82f6)', transition: 'width 200ms',
        }} />
      </div>
    );
  },
};

export const EmptyState: PieceDefinition = {
  kind: 'EmptyState',
  meta: { category: 'feedback' },
  render: (node) => (
    <div {...{ [UI]: 'empty-state' }} style={{
      padding: 24, textAlign: 'center', color: 'var(--dddk-text-muted, #6b6b6b)',
    }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{(node.icon as string) ?? '∅'}</div>
      <div>{node.title as string ?? 'No data'}</div>
      {Boolean(node.description) && <small>{node.description as string}</small>}
    </div>
  ),
};

export const ErrorState: PieceDefinition = {
  kind: 'ErrorState',
  meta: { category: 'feedback' },
  render: (node) => (
    <div {...{ [UI]: 'error-state' }} style={{
      padding: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444',
      borderRadius: 6, color: '#991b1b',
    }}>
      <strong>{node.title as string ?? 'Error'}</strong>
      {Boolean(node.message) && <div style={{ marginTop: 4, fontSize: 13 }}>{node.message as string}</div>}
    </div>
  ),
};
