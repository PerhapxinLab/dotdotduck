import type { PieceDefinition, PieceNode } from '../types';
import { UI, renderChildren } from './_shared';

export const Stack: PieceDefinition = {
  kind: 'Stack',
  meta: { category: 'layout', description: '垂直 / 水平堆疊' },
  render: (node, ctx) => (
    <div
      {...{ [UI]: 'stack' }}
      data-direction={(node.direction as string) ?? 'vertical'}
      style={{
        display: 'flex',
        flexDirection: node.direction === 'horizontal' ? 'row' : 'column',
        gap: (node.gap as string | number) ?? 8,
        alignItems: (node.align as string) ?? 'stretch',
      }}
    >
      {renderChildren(node, ctx)}
    </div>
  ),
};

export const Grid: PieceDefinition = {
  kind: 'Grid',
  meta: { category: 'layout', description: '網格佈局' },
  render: (node, ctx) => (
    <div
      {...{ [UI]: 'grid' }}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${(node.columns as number) ?? 2}, minmax(0, 1fr))`,
        gap: (node.gap as string | number) ?? 8,
      }}
    >
      {renderChildren(node, ctx)}
    </div>
  ),
};

export const Split: PieceDefinition = {
  kind: 'Split',
  meta: { category: 'layout', description: '雙欄佈局' },
  render: (node, ctx) => (
    <div {...{ [UI]: 'split' }} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {renderChildren(node, ctx)}
    </div>
  ),
};

export const Card: PieceDefinition = {
  kind: 'Card',
  meta: { category: 'layout', description: '卡片容器' },
  render: (node, ctx) => (
    <div
      {...{ [UI]: 'card' }}
      style={{
        background: 'var(--dddk-bg-elevated, #fff)',
        borderRadius: 'var(--dddk-radius, 12px)',
        padding: 16,
        boxShadow: 'var(--dddk-shadow-md, 0 1px 3px rgba(0,0,0,0.05))',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      {renderChildren(node, ctx)}
    </div>
  ),
};

export const Tabs: PieceDefinition = {
  kind: 'Tabs',
  meta: { category: 'layout', description: '頁籤' },
  render: (node, ctx) => {
    const tabs = (node.tabs as Array<{ id: string; label: string; content: PieceNode }>) ?? [];
    const activeBind =
      node.bind ?? (node.id ? `__activeTab_${node.id}` : '__activeTab');
    const active = (ctx.data[activeBind] as string) ?? tabs[0]?.id;
    const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];
    return (
      <div {...{ [UI]: 'tabs' }}>
        <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--dddk-border)' }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => ctx.setBinding(activeBind, t.id)}
              style={{
                padding: '6px 12px', background: 'transparent', border: 0,
                borderBottom: t.id === active ? '2px solid var(--dddk-accent)' : '2px solid transparent',
                cursor: 'pointer', font: 'inherit',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ padding: 12 }}>{activeTab && ctx.render(activeTab.content)}</div>
      </div>
    );
  },
};

export const Group: PieceDefinition = {
  kind: 'Group',
  meta: { category: 'layout', description: 'Transparent flex container — no border / shadow / background. Use inside a Card to cluster children without stacking visual envelopes.' },
  render: (node, ctx) => (
    <div
      {...{ [UI]: 'group' }}
      style={{
        display: 'flex',
        flexDirection: (node.direction as string) === 'horizontal' ? 'row' : 'column',
        gap: (node.gap as string | number) ?? 8,
        alignItems: (node.align as string) ?? 'stretch',
      }}
    >
      {renderChildren(node, ctx)}
    </div>
  ),
};
