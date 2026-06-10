/**
 * Rich selection pieces — MediaCard, OptionGroup, ChoiceList.
 *
 * MediaCard is a transparent presentation tile (image + text). OptionGroup
 * wraps MediaCard-shaped tiles into a keyboard-navigable radio group.
 * ChoiceList is its text-only sibling. Both share roving-tabindex semantics.
 */

import type { PieceDefinition } from '../types';
import { readPointer } from '../pointer';
import { UI, rovingTabindexKeyHandler } from './_shared';

export const MediaCard: PieceDefinition = {
  kind: 'MediaCard',
  meta: { category: 'layout', description: 'Image + text tile. Transparent; compose inside a Card or OptionGroup.' },
  render: (node) => {
    const orientation = (node.orientation as 'top' | 'left') ?? 'top';
    const image = node.image as { src: string; alt?: string; aspectRatio?: string } | undefined;
    const title = (node.title as string) ?? '';
    const description = node.description as string | undefined;
    const meta = (node.meta as string[]) ?? [];
    const isLeft = orientation === 'left';
    return (
      <div
        {...{ [UI]: 'media-card' }}
        data-orientation={orientation}
        style={{
          display: 'flex',
          flexDirection: isLeft ? 'row' : 'column',
          gap: isLeft ? 12 : 8,
          alignItems: isLeft ? 'flex-start' : 'stretch',
        }}
      >
        {image?.src && (
          <div style={{
            flex: isLeft ? '0 0 96px' : '0 0 auto',
            width: isLeft ? 96 : '100%',
            aspectRatio: image.aspectRatio ?? (isLeft ? '1' : '16/9'),
            overflow: 'hidden',
            borderRadius: 'var(--dddk-radius-sm, 6px)',
            background: 'var(--dddk-bg-subtle, rgba(0,0,0,0.04))',
          }}>
            <img
              src={image.src}
              alt={image.alt ?? ''}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          {title && <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3 }}>{title}</div>}
          {description && (
            <div style={{ fontSize: 13, color: 'var(--dddk-text-muted, #64748b)', lineHeight: 1.45 }}>{description}</div>
          )}
          {meta.length > 0 && (
            <div style={{ display: 'flex', gap: 8, fontSize: 11.5, color: 'var(--dddk-text-muted, #64748b)', marginTop: 2 }}>
              {meta.map((m, i) => <span key={i}>{m}</span>)}
            </div>
          )}
        </div>
      </div>
    );
  },
};

interface OptionSpec {
  value: string;
  title: string;
  description?: string;
  meta?: string[];
  image?: { src: string; alt?: string; aspectRatio?: string };
}

export const OptionGroup: PieceDefinition = {
  kind: 'OptionGroup',
  meta: { category: 'input', description: 'Keyboard-navigable MediaCard-shaped radio group. Fires `trigger("choose", { value, index })`.' },
  render: (node, ctx) => {
    const options = (node.options as OptionSpec[]) ?? [];
    const bind = (node.bind as string) ?? '';
    const layout = (node.layout as 'row' | 'column') ?? 'column';
    const columns = node.columns as number | undefined;
    const selected = bind ? readPointer(ctx.data, bind) : undefined;
    const isRow = layout === 'row';
    const gridCols = isRow ? (columns ?? options.length) : 1;

    const choose = (i: number) => {
      if (bind) ctx.setBinding(bind, options[i]!.value);
      ctx.trigger('choose', { value: options[i]!.value, index: i });
    };

    return (
      <div
        {...{ [UI]: 'option-group' }}
        role="radiogroup"
        data-layout={layout}
        style={{
          display: 'grid',
          gridTemplateColumns: isRow ? `repeat(${gridCols}, minmax(0, 1fr))` : '1fr',
          gap: 8,
        }}
      >
        {options.map((opt, i) => {
          const isSelected = opt.value === selected || (selected === undefined && i === 0);
          return (
            <div
              key={opt.value}
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => choose(i)}
              onKeyDown={(e) => rovingTabindexKeyHandler(e, i, options.length, isRow, () => choose(i))}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 12,
                cursor: 'pointer',
                outline: 'none',
                borderRadius: 'var(--dddk-radius, 10px)',
                border: '1px solid',
                borderColor: isSelected ? 'var(--dddk-accent, #6366f1)' : 'var(--dddk-border, rgba(0,0,0,0.08))',
                background: isSelected ? 'var(--dddk-accent-soft, rgba(99,102,241,0.08))' : 'transparent',
                transition: 'border-color 120ms, background 120ms',
              }}
              onFocus={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0 2px var(--dddk-accent-soft, rgba(99,102,241,0.2))'; }}
              onBlur={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
            >
              {opt.image?.src && (
                <div style={{
                  width: '100%',
                  aspectRatio: opt.image.aspectRatio ?? '16/9',
                  overflow: 'hidden',
                  borderRadius: 'var(--dddk-radius-sm, 6px)',
                  background: 'var(--dddk-bg-subtle, rgba(0,0,0,0.04))',
                }}>
                  <img src={opt.image.src} alt={opt.image.alt ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
              )}
              <div style={{ fontWeight: 600, fontSize: 14 }}>{opt.title}</div>
              {opt.description && (
                <div style={{ fontSize: 13, color: 'var(--dddk-text-muted, #64748b)', lineHeight: 1.45 }}>{opt.description}</div>
              )}
              {opt.meta && opt.meta.length > 0 && (
                <div style={{ display: 'flex', gap: 8, fontSize: 11.5, color: 'var(--dddk-text-muted, #64748b)' }}>
                  {opt.meta.map((m, mi) => <span key={mi}>{m}</span>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  },
};

export const ChoiceList: PieceDefinition = {
  kind: 'ChoiceList',
  meta: { category: 'input', description: 'Text-only radio sibling of OptionGroup. Same keyboard model, denser.' },
  render: (node, ctx) => {
    const options = (node.options as Array<{ value: string; label: string; description?: string }>) ?? [];
    const bind = (node.bind as string) ?? '';
    const orientation = (node.orientation as 'row' | 'column') ?? 'column';
    const selected = bind ? readPointer(ctx.data, bind) : undefined;
    const isRow = orientation === 'row';

    const choose = (i: number) => {
      if (bind) ctx.setBinding(bind, options[i]!.value);
      ctx.trigger('choose', { value: options[i]!.value, index: i });
    };

    return (
      <div
        {...{ [UI]: 'choice-list' }}
        role="radiogroup"
        data-orientation={orientation}
        style={{
          display: 'flex',
          flexDirection: isRow ? 'row' : 'column',
          gap: 6,
        }}
      >
        {options.map((opt, i) => {
          const isSelected = opt.value === selected || (selected === undefined && i === 0);
          return (
            <div
              key={opt.value}
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => choose(i)}
              onKeyDown={(e) => rovingTabindexKeyHandler(e, i, options.length, isRow, () => choose(i))}
              style={{
                flex: isRow ? '1 1 0' : '0 0 auto',
                padding: '10px 14px',
                cursor: 'pointer',
                outline: 'none',
                borderRadius: 'var(--dddk-radius-sm, 6px)',
                border: '1px solid',
                borderColor: isSelected ? 'var(--dddk-accent, #6366f1)' : 'var(--dddk-border, rgba(0,0,0,0.08))',
                background: isSelected ? 'var(--dddk-accent-soft, rgba(99,102,241,0.08))' : 'transparent',
                transition: 'border-color 120ms, background 120ms',
              }}
              onFocus={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0 2px var(--dddk-accent-soft, rgba(99,102,241,0.2))'; }}
              onBlur={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
            >
              <div style={{ fontWeight: 500, fontSize: 14 }}>{opt.label}</div>
              {opt.description && (
                <div style={{ fontSize: 12.5, color: 'var(--dddk-text-muted, #64748b)', marginTop: 2 }}>{opt.description}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  },
};
