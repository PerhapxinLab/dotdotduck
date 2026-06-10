import type { PieceDefinition } from '../types';
import { resolveValue } from '../renderer';
import { tone } from '../tokens';
import { UI } from './_shared';

export const Heading: PieceDefinition = {
  kind: 'Heading',
  meta: { category: 'content' },
  render: (node, ctx) => {
    const level = ((node.level as number) ?? 3) as 1 | 2 | 3 | 4 | 5 | 6;
    const Tag = `h${level}` as const;
    const text = resolveValue<string>(node, ctx, 'text', '');
    return <Tag {...{ [UI]: 'heading' }} style={{ margin: '0 0 8px 0' }}>{text}</Tag>;
  },
};

export const Text: PieceDefinition = {
  kind: 'Text',
  meta: { category: 'content' },
  render: (node, ctx) => {
    const text = resolveValue<string>(node, ctx, 'text', '');
    return <span {...{ [UI]: 'text' }}>{text}</span>;
  },
};

export const Code: PieceDefinition = {
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

export const Image: PieceDefinition = {
  kind: 'Image',
  meta: { category: 'content' },
  render: (node) => (
    <img {...{ [UI]: 'image' }} src={node.src as string} alt={(node.alt as string) ?? ''}
      style={{ maxWidth: '100%', borderRadius: 6 }} />
  ),
};

export const Tag: PieceDefinition = {
  kind: 'Tag',
  meta: { category: 'content' },
  render: (node) => {
    const c = tone(node.tone);
    return (
      <span {...{ [UI]: 'tag' }} style={{
        background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 12,
        fontSize: 11, fontWeight: 500, display: 'inline-block',
      }}>{node.text as string}</span>
    );
  },
};

export const Divider: PieceDefinition = {
  kind: 'Divider',
  meta: { category: 'content' },
  render: () => <hr {...{ [UI]: 'divider' }} style={{ border: 0, borderTop: '1px solid var(--dddk-border, rgba(0,0,0,0.1))', margin: '8px 0' }} />,
};

export const Markdown: PieceDefinition = {
  kind: 'Markdown',
  meta: { category: 'content' },
  render: (node, ctx) => {
    const text = resolveValue<string>(node, ctx, 'text', '');
    return <div {...{ [UI]: 'markdown' }} style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;
  },
};
