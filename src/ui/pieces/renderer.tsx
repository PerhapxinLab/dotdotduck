/**
 * PieceRenderer — unified React renderer for any catalog.
 *
 * Same renderer drives:
 *  - Direct authoring (Pieces.Card({ children: [...] }))
 *  - Flat surface envelopes (translated to PieceNode then rendered)
 *  - Skill detail views in the palette
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { PieceCatalog, PieceContext, PieceNode, PieceSurface } from './types';

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

// ─── JSON Pointer (RFC 6901, simplified) ──────────────────────────

export function readPointer(data: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  if (!path.startsWith('/')) return data[path];
  const parts = path.slice(1).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur: unknown = data;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as object)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function applyPointer(
  data: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  if (!path) return data;
  if (!path.startsWith('/')) {
    return { ...data, [path]: value };
  }
  const parts = path.slice(1).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  const last = parts.pop();
  // Path-based shallow clone: only clone the objects on the write path. The
  // rest of the tree keeps reference equality so consumers using `===` on
  // unrelated sibling branches won't re-render unnecessarily, and we don't
  // pay the structuredClone cost on every keystroke for large forms.
  const next: Record<string, unknown> = { ...data };
  if (!last) return next;
  let cur: Record<string, unknown> = next;
  for (const p of parts) {
    const existing = cur[p];
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      // Shallow-clone this level so we don't mutate the original.
      const cloned = { ...(existing as Record<string, unknown>) };
      cur[p] = cloned;
      cur = cloned;
    } else {
      const fresh: Record<string, unknown> = {};
      cur[p] = fresh;
      cur = fresh;
    }
  }
  cur[last] = value;
  return next;
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
