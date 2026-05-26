/**
 * 33 built-in Pieces. Organized by category — see DECISIONS #27 / docs/13-pieces.md
 *
 * Each piece is intentionally small and CSS-variable driven so themes apply
 * cleanly. Slot is the escape hatch — host plugs in any React/Web component.
 */

import type { ReactNode } from 'react';
import type { PieceCatalog, PieceDefinition, PieceNode, PieceContext } from './types';
import { PieceCatalog as Catalog } from './types';
import { resolveValue } from './renderer';

const UI = 'data-dddk-piece';

// ─── helpers ────────────────────────────────────────────────────────

function renderChildren(node: PieceNode, ctx: PieceContext): ReactNode {
  const children = node.children as PieceNode[] | undefined;
  if (!children) return null;
  return children.map((c, i) => <Frag key={c.id ?? i}>{ctx.render(c)}</Frag>);
}

function Frag({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// ─── Layout (5) ────────────────────────────────────────────────────

const Stack: PieceDefinition = {
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

const Grid: PieceDefinition = {
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

const Split: PieceDefinition = {
  kind: 'Split',
  meta: { category: 'layout', description: '雙欄佈局' },
  render: (node, ctx) => (
    <div {...{ [UI]: 'split' }} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {renderChildren(node, ctx)}
    </div>
  ),
};

const Card: PieceDefinition = {
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

const Tabs: PieceDefinition = {
  kind: 'Tabs',
  meta: { category: 'layout', description: '頁籤' },
  render: (node, ctx) => {
    const tabs = (node.tabs as Array<{ id: string; label: string; content: PieceNode }>) ?? [];
    // Namespace the active-tab key by the Tabs node's id so multiple Tabs in
    // the same surface don't clobber each other's state. Host can still override
    // explicitly via `bind` if they want to share state across two Tabs.
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

// ─── Content (7) ───────────────────────────────────────────────────

const Heading: PieceDefinition = {
  kind: 'Heading',
  meta: { category: 'content' },
  render: (node, ctx) => {
    const level = ((node.level as number) ?? 3) as 1 | 2 | 3 | 4 | 5 | 6;
    const Tag = `h${level}` as const;
    const text = resolveValue<string>(node, ctx, 'text', '');
    return <Tag {...{ [UI]: 'heading' }} style={{ margin: '0 0 8px 0' }}>{text}</Tag>;
  },
};

const Text: PieceDefinition = {
  kind: 'Text',
  meta: { category: 'content' },
  render: (node, ctx) => {
    const text = resolveValue<string>(node, ctx, 'text', '');
    return <span {...{ [UI]: 'text' }}>{text}</span>;
  },
};

const Code: PieceDefinition = {
  kind: 'Code',
  meta: { category: 'content' },
  render: (node, ctx) => {
    const code = resolveValue<string>(node, ctx, 'code', '');
    return (
      <pre {...{ [UI]: 'code' }} style={{
        background: 'var(--dddk-bg, #fafafa)', padding: 8, borderRadius: 6,
        fontFamily: 'var(--dddk-font-mono, ui-monospace, monospace)', fontSize: 12,
        margin: 0, overflowX: 'auto',
      }}>{code}</pre>
    );
  },
};

const Image: PieceDefinition = {
  kind: 'Image',
  meta: { category: 'content' },
  render: (node) => (
    <img {...{ [UI]: 'image' }} src={node.src as string} alt={(node.alt as string) ?? ''}
      style={{ maxWidth: '100%', borderRadius: 6 }} />
  ),
};

const Tag: PieceDefinition = {
  kind: 'Tag',
  meta: { category: 'content' },
  render: (node) => {
    const tone = (node.tone as string) ?? 'neutral';
    const colors: Record<string, { bg: string; fg: string }> = {
      neutral: { bg: 'rgba(0,0,0,0.06)', fg: 'inherit' },
      success: { bg: 'rgba(16,185,129,0.12)', fg: '#10b981' },
      warning: { bg: 'rgba(245,158,11,0.12)', fg: '#f59e0b' },
      error: { bg: 'rgba(239,68,68,0.12)', fg: '#ef4444' },
      info: { bg: 'rgba(59,130,246,0.12)', fg: '#3b82f6' },
    };
    const c = colors[tone] ?? colors.neutral!;
    return (
      <span {...{ [UI]: 'tag' }} style={{
        background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 12,
        fontSize: 11, fontWeight: 500, display: 'inline-block',
      }}>{node.text as string}</span>
    );
  },
};

const Divider: PieceDefinition = {
  kind: 'Divider',
  meta: { category: 'content' },
  render: () => <hr {...{ [UI]: 'divider' }} style={{ border: 0, borderTop: '1px solid var(--dddk-border, rgba(0,0,0,0.1))', margin: '8px 0' }} />,
};

const Markdown: PieceDefinition = {
  kind: 'Markdown',
  meta: { category: 'content' },
  // Minimal — host should plug a real md renderer if they want rich rendering.
  render: (node, ctx) => {
    const text = resolveValue<string>(node, ctx, 'text', '');
    return <div {...{ [UI]: 'markdown' }} style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;
  },
};

// ─── Data (4) ──────────────────────────────────────────────────────

const Listing: PieceDefinition = {
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

const Table: PieceDefinition = {
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

const Metric: PieceDefinition = {
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

const Timeline: PieceDefinition = {
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

// ─── Input (10) ────────────────────────────────────────────────────

function field(node: PieceNode, child: ReactNode) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
      {node.label != null && <span>{node.label as string}</span>}
      {child}
    </label>
  );
}

const baseInputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', border: '1px solid var(--dddk-border, rgba(0,0,0,0.15))',
  borderRadius: 6, font: 'inherit', background: 'var(--dddk-bg, #fff)', color: 'inherit',
};

const TextField: PieceDefinition = {
  kind: 'TextField',
  meta: { category: 'input' },
  render: (node, ctx) => field(node, (
    <input type="text" {...{ [UI]: 'textfield' }} style={baseInputStyle}
      value={String(resolveValue<string>(node, ctx, 'value', '') ?? '')}
      placeholder={node.placeholder as string}
      onChange={(e) => node.bind && ctx.setBinding(node.bind, e.target.value)} />
  )),
};

const TextArea: PieceDefinition = {
  kind: 'TextArea',
  meta: { category: 'input' },
  render: (node, ctx) => field(node, (
    <textarea {...{ [UI]: 'textarea' }} style={baseInputStyle}
      rows={(node.rows as number) ?? 3}
      value={String(resolveValue<string>(node, ctx, 'value', '') ?? '')}
      placeholder={node.placeholder as string}
      onChange={(e) => node.bind && ctx.setBinding(node.bind, e.target.value)} />
  )),
};

const NumberField: PieceDefinition = {
  kind: 'NumberField',
  meta: { category: 'input' },
  render: (node, ctx) => field(node, (
    <input type="number" {...{ [UI]: 'numberfield' }} style={baseInputStyle}
      value={Number(resolveValue<number>(node, ctx, 'value', 0)) || 0}
      min={node.min as number} max={node.max as number} step={node.step as number}
      onChange={(e) => node.bind && ctx.setBinding(node.bind, Number(e.target.value))} />
  )),
};

const PasswordField: PieceDefinition = {
  kind: 'PasswordField',
  meta: { category: 'input' },
  render: (node, ctx) => field(node, (
    <input type="password" {...{ [UI]: 'password' }} style={baseInputStyle}
      value={String(resolveValue<string>(node, ctx, 'value', '') ?? '')}
      onChange={(e) => node.bind && ctx.setBinding(node.bind, e.target.value)} />
  )),
};

const Checkbox: PieceDefinition = {
  kind: 'Checkbox',
  meta: { category: 'input' },
  render: (node, ctx) => (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
      <input type="checkbox" checked={Boolean(resolveValue<boolean>(node, ctx, 'value', false))}
        onChange={(e) => node.bind && ctx.setBinding(node.bind, e.target.checked)} />
      <span>{node.label as string}</span>
    </label>
  ),
};

const Switch: PieceDefinition = {
  kind: 'Switch',
  meta: { category: 'input' },
  // Visually distinct from checkbox; semantically same.
  render: (node, ctx) => {
    const checked = Boolean(resolveValue<boolean>(node, ctx, 'value', false));
    return (
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
        <span
          onClick={() => node.bind && ctx.setBinding(node.bind, !checked)}
          style={{
            width: 32, height: 18, borderRadius: 9, position: 'relative',
            background: checked ? 'var(--dddk-accent)' : 'rgba(0,0,0,0.2)',
            transition: 'background 120ms',
          }}>
          <span style={{
            position: 'absolute', top: 2, left: checked ? 16 : 2,
            width: 14, height: 14, borderRadius: '50%', background: '#fff',
            transition: 'left 120ms',
          }} />
        </span>
        {Boolean(node.label) && <span>{node.label as string}</span>}
      </label>
    );
  },
};

const Picker: PieceDefinition = {
  kind: 'Picker',
  meta: { category: 'input' },
  render: (node, ctx) => {
    const options = (node.options as Array<string | { value: string; label: string }>) ?? [];
    return field(node, (
      <select style={baseInputStyle}
        value={String(resolveValue<string>(node, ctx, 'value', '') ?? '')}
        onChange={(e) => node.bind && ctx.setBinding(node.bind, e.target.value)}>
        {options.map((o) => {
          const v = typeof o === 'string' ? o : o.value;
          const l = typeof o === 'string' ? o : o.label;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    ));
  },
};

const DatePicker: PieceDefinition = {
  kind: 'DatePicker',
  meta: { category: 'input' },
  render: (node, ctx) => field(node, (
    <input type="datetime-local" style={baseInputStyle}
      value={String(resolveValue<string>(node, ctx, 'value', '') ?? '')}
      onChange={(e) => node.bind && ctx.setBinding(node.bind, e.target.value)} />
  )),
};

const Slider: PieceDefinition = {
  kind: 'Slider',
  meta: { category: 'input' },
  render: (node, ctx) => field(node, (
    <input type="range"
      min={(node.min as number) ?? 0}
      max={(node.max as number) ?? 100}
      step={(node.step as number) ?? 1}
      value={Number(resolveValue<number>(node, ctx, 'value', 0)) || 0}
      onChange={(e) => node.bind && ctx.setBinding(node.bind, Number(e.target.value))} />
  )),
};

const FilePicker: PieceDefinition = {
  kind: 'FilePicker',
  meta: { category: 'input' },
  render: (node, ctx) => field(node, (
    <input type="file" accept={node.accept as string}
      multiple={Boolean(node.multiple)}
      onChange={(e) => {
        if (!node.bind) return;
        const files = Array.from(e.target.files ?? []);
        ctx.setBinding(node.bind, files);
      }} />
  )),
};

// ─── Action (3) ────────────────────────────────────────────────────

const Button: PieceDefinition = {
  kind: 'Button',
  meta: { category: 'action' },
  render: (node, ctx) => {
    const variant = (node.variant as string) ?? 'primary';
    const styles: Record<string, React.CSSProperties> = {
      primary: { background: 'var(--dddk-accent, #3b82f6)', color: '#fff' },
      secondary: { background: 'transparent', color: 'inherit', border: '1px solid var(--dddk-border)' },
      destructive: { background: '#ef4444', color: '#fff' },
    };
    return (
      <button type="button" {...{ [UI]: 'button' }}
        onClick={() => ctx.trigger((node.action as string) ?? 'submit', node.payload)}
        style={{
          ...styles[variant], padding: '6px 14px', borderRadius: 6, border: 0,
          font: 'inherit', cursor: 'pointer', fontWeight: 500,
        }}>
        {node.text as string}
      </button>
    );
  },
};

const Link: PieceDefinition = {
  kind: 'Link',
  meta: { category: 'action' },
  render: (node) => (
    <a {...{ [UI]: 'link' }} href={node.href as string} target={node.target as string}
      style={{ color: 'var(--dddk-accent)', textDecoration: 'underline', cursor: 'pointer' }}>
      {node.text as string}
    </a>
  ),
};

const IconButton: PieceDefinition = {
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

// ─── Feedback (4) ──────────────────────────────────────────────────

const Spinner: PieceDefinition = {
  kind: 'Spinner',
  meta: { category: 'feedback' },
  render: () => <span {...{ [UI]: 'spinner' }}>⋯</span>,
};

const ProgressBar: PieceDefinition = {
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

const EmptyState: PieceDefinition = {
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

const ErrorState: PieceDefinition = {
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

// ─── Slot (1) — the escape hatch ──────────────────────────────────

const Slot: PieceDefinition = {
  kind: 'Slot',
  meta: { category: 'slot', description: '渲染 host 提供的 React/Web component' },
  render: (node, ctx) => {
    // Two render modes:
    //   1. inline `render` function provided directly (direct API path)
    //   2. named `slotName` resolved against a host-registered slot map
    //      (the renderer's onAction handler exposes named slots; for now we
    //      look up window.__dddkSlots, host can also extend catalog)
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

// ─── catalog assembly ─────────────────────────────────────────────

export const builtinPieces: PieceDefinition[] = [
  // layout
  Stack, Grid, Split, Card, Tabs,
  // content
  Heading, Text, Code, Image, Tag, Divider, Markdown,
  // data
  Listing, Table, Metric, Timeline,
  // input
  TextField, TextArea, NumberField, PasswordField,
  Checkbox, Switch, Picker, DatePicker, Slider, FilePicker,
  // action
  Button, Link, IconButton,
  // feedback
  Spinner, ProgressBar, EmptyState, ErrorState,
  // slot
  Slot,
];

export function createBuiltinCatalog(): PieceCatalog {
  return new Catalog(builtinPieces);
}
