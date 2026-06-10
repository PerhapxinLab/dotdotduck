import type { PieceDefinition } from '../types';
import { resolveValue } from '../renderer';
import { UI } from './_shared';

export const Listing: PieceDefinition = {
  kind: 'Listing',
  meta: { category: 'data', description: '搜尋式清單' },
  render: (node, ctx) => {
    type Item = { id: string; title: string; subtitle?: string; accessory?: string; icon?: string };
    const items = resolveValue<Item[]>(node, ctx, 'items', []);
    return (
      <ul {...{ [UI]: 'listing' }} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((it) => (
          <li key={it.id} style={{
            display: 'flex', gap: 8, padding: '6px 8px',
            borderBottom: '1px solid var(--dddk-border, rgba(0,0,0,0.05))',
          }}>
            {it.icon && <span>{it.icon}</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>{it.title}</div>
              {it.subtitle && <small style={{ color: 'var(--dddk-text-muted, #6b6b6b)' }}>{it.subtitle}</small>}
            </div>
            {it.accessory && <span style={{ color: 'var(--dddk-text-muted, #6b6b6b)' }}>{it.accessory}</span>}
          </li>
        ))}
      </ul>
    );
  },
};

export const Table: PieceDefinition = {
  kind: 'Table',
  meta: { category: 'data' },
  render: (node, ctx) => {
    const columns = (node.columns as Array<{ key: string; label: string }>) ?? [];
    const rows = resolveValue<Array<Record<string, unknown>>>(node, ctx, 'rows', []);
    return (
      <table {...{ [UI]: 'table' }} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>{columns.map((c) => (
            <th key={c.key} style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid var(--dddk-border)' }}>
              {c.label}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} style={{ padding: 6, borderBottom: '1px solid var(--dddk-border, rgba(0,0,0,0.05))' }}>
                  {String(r[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
};

export const Metric: PieceDefinition = {
  kind: 'Metric',
  meta: { category: 'data', description: '單一數字 + 變動' },
  render: (node) => {
    const trend = (node.trend as string) ?? 'flat';
    const trendColor = trend === 'up' ? '#10b981' : trend === 'down' ? '#ef4444' : '#6b6b6b';
    const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '–';
    return (
      <div {...{ [UI]: 'metric' }} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {Boolean(node.label) && <span style={{ fontSize: 11, color: 'var(--dddk-text-muted, #6b6b6b)' }}>{node.label as string}</span>}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <strong style={{ fontSize: 22 }}>{node.value as string}</strong>
          {node.delta != null && (
            <span style={{ color: trendColor, fontSize: 12 }}>{arrow} {node.delta as string}</span>
          )}
        </div>
      </div>
    );
  },
};

export const Timeline: PieceDefinition = {
  kind: 'Timeline',
  meta: { category: 'data' },
  render: (node, ctx) => {
    type Event = { id: string; time: string; title: string; note?: string };
    const events = resolveValue<Event[]>(node, ctx, 'events', []);
    return (
      <ol {...{ [UI]: 'timeline' }} style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: '2px solid var(--dddk-border)' }}>
        {events.map((e) => (
          <li key={e.id} style={{ marginLeft: 12, paddingLeft: 12, paddingBottom: 12, position: 'relative' }}>
            <span style={{
              position: 'absolute', left: -19, top: 6, width: 8, height: 8, borderRadius: '50%',
              background: 'var(--dddk-accent, #3b82f6)',
            }} />
            <small style={{ color: 'var(--dddk-text-muted)' }}>{e.time}</small>
            <div>{e.title}</div>
            {e.note && <small style={{ color: 'var(--dddk-text-muted)' }}>{e.note}</small>}
          </li>
        ))}
      </ol>
    );
  },
};
