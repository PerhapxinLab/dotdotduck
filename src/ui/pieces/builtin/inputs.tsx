import type { PieceDefinition } from '../types';
import { resolveValue } from '../renderer';
import { BASE_INPUT_STYLE } from '../tokens';
import { UI, field } from './_shared';

export const TextField: PieceDefinition = {
  kind: 'TextField',
  meta: { category: 'input' },
  render: (node, ctx) => field(node, (
    <input type="text" {...{ [UI]: 'textfield' }} style={BASE_INPUT_STYLE}
      value={String(resolveValue<string>(node, ctx, 'value', '') ?? '')}
      placeholder={node.placeholder as string}
      onChange={(e) => node.bind && ctx.setBinding(node.bind, e.target.value)} />
  )),
};

export const TextArea: PieceDefinition = {
  kind: 'TextArea',
  meta: { category: 'input' },
  render: (node, ctx) => field(node, (
    <textarea {...{ [UI]: 'textarea' }} style={BASE_INPUT_STYLE}
      rows={(node.rows as number) ?? 3}
      value={String(resolveValue<string>(node, ctx, 'value', '') ?? '')}
      placeholder={node.placeholder as string}
      onChange={(e) => node.bind && ctx.setBinding(node.bind, e.target.value)} />
  )),
};

export const NumberField: PieceDefinition = {
  kind: 'NumberField',
  meta: { category: 'input' },
  render: (node, ctx) => field(node, (
    <input type="number" {...{ [UI]: 'numberfield' }} style={BASE_INPUT_STYLE}
      value={Number(resolveValue<number>(node, ctx, 'value', 0)) || 0}
      min={node.min as number} max={node.max as number} step={node.step as number}
      onChange={(e) => node.bind && ctx.setBinding(node.bind, Number(e.target.value))} />
  )),
};

export const PasswordField: PieceDefinition = {
  kind: 'PasswordField',
  meta: { category: 'input' },
  render: (node, ctx) => field(node, (
    <input type="password" {...{ [UI]: 'password' }} style={BASE_INPUT_STYLE}
      value={String(resolveValue<string>(node, ctx, 'value', '') ?? '')}
      onChange={(e) => node.bind && ctx.setBinding(node.bind, e.target.value)} />
  )),
};

export const Checkbox: PieceDefinition = {
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

export const Switch: PieceDefinition = {
  kind: 'Switch',
  meta: { category: 'input' },
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

export const Picker: PieceDefinition = {
  kind: 'Picker',
  meta: { category: 'input' },
  render: (node, ctx) => {
    const options = (node.options as Array<string | { value: string; label: string }>) ?? [];
    return field(node, (
      <select style={BASE_INPUT_STYLE}
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

export const DatePicker: PieceDefinition = {
  kind: 'DatePicker',
  meta: { category: 'input' },
  render: (node, ctx) => field(node, (
    <input type="datetime-local" style={BASE_INPUT_STYLE}
      value={String(resolveValue<string>(node, ctx, 'value', '') ?? '')}
      onChange={(e) => node.bind && ctx.setBinding(node.bind, e.target.value)} />
  )),
};

export const Slider: PieceDefinition = {
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

export const FilePicker: PieceDefinition = {
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
