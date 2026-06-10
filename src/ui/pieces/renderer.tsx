/**
 * PieceRenderer — unified React renderer for any catalog.
 * Drives direct authoring, flat envelopes, and palette detail views.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { PieceCatalog, PieceContext, PieceNode, PieceSurface } from './types';
import { readPointer, applyPointer } from './pointer';

export { readPointer } from './pointer';

export interface PieceRendererProps {
  surface: PieceSurface;
  catalog: PieceCatalog;
  onAction?: (name: string, payload: unknown, data: Record<string, unknown>) => void;
  onDataChange?: (data: Record<string, unknown>) => void;
}

export function PieceRenderer({
  surface,
  catalog,
  onAction,
  onDataChange,
}: PieceRendererProps) {
  const [data, setData] = useState<Record<string, unknown>>(surface.data ?? {});

  const setBinding = useCallback((path: string, value: unknown) => {
    setData((cur) => {
      const next = applyPointer(cur, path, value);
      onDataChange?.(next);
      return next;
    });
  }, [onDataChange]);

  const trigger = useCallback((name: string, payload?: unknown) => {
    onAction?.(name, payload, data);
  }, [onAction, data]);

  const ctx: PieceContext = useMemo(() => {
    const c: PieceContext = {
      data,
      setBinding,
      trigger,
      render: (node) => renderNode(node, c, catalog),
    };
    return c;
  }, [data, setBinding, trigger, catalog]);

  return <>{renderNode(surface.root, ctx, catalog)}</>;
}

function renderNode(node: PieceNode, ctx: PieceContext, catalog: PieceCatalog): ReactNode {
  const def = catalog.get(node.kind);
  if (!def) {
    return (
      <div data-dddk-ui="piece-unknown" style={{ color: '#cc3333', padding: 8 }}>
        Unknown piece: {node.kind}
      </div>
    );
  }
  return def.render(node, ctx);
}

/** Resolve a value via bind (preferred) or fallback to a literal prop. */
export function resolveValue<T>(
  node: PieceNode,
  ctx: PieceContext,
  literalKey: string,
  fallback?: T
): T {
  if (node.bind) {
    const v = readPointer(ctx.data, node.bind);
    if (v !== undefined) return v as T;
  }
  const lit = node[literalKey];
  if (lit !== undefined) return lit as T;
  return fallback as T;
}
