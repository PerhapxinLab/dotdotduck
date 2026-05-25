/**
 * Surface envelope ↔ Pieces bridge.
 *
 * The flat envelope shape (a list of components keyed by id + a data model)
 * is the on-the-wire format some agent runtimes emit. Our PieceSurface uses
 * a tree of PieceNodes with inline children. Same underlying primitives,
 * different wire shape. This file converts between them.
 */

import type { PieceSurface, PieceNode } from './types';

interface EnvelopeComponent {
  id: string;
  component: string;
  children?: string[];
  [key: string]: unknown;
}

interface SurfaceEnvelope {
  version: 'v0.10';
  updateComponents?: {
    surfaceId?: string;
    catalogId?: string;
    components: EnvelopeComponent[];
  };
  updateDataModel?: {
    surfaceId?: string;
    data: Record<string, unknown>;
  };
}

/**
 * Convert a flat envelope into a PieceSurface our renderer can consume.
 * Uses the component with id 'root' (or the first one) as the tree root,
 * recursively expanding `children` ids into nested PieceNodes.
 */
export function envelopeToSurface(envelope: SurfaceEnvelope): PieceSurface | null {
  const components = envelope.updateComponents?.components ?? [];
  if (components.length === 0) return null;

  const byId = new Map<string, EnvelopeComponent>();
  for (const c of components) byId.set(c.id, c);

  const rootComp = byId.get('root') ?? components[0];
  if (!rootComp) return null;

  const root = expand(rootComp, byId, new Set());

  return {
    root,
    data: envelope.updateDataModel?.data ?? {},
  };
}

function expand(
  comp: EnvelopeComponent,
  byId: Map<string, EnvelopeComponent>,
  visited: Set<string>,
): PieceNode {
  const { id, component, children, ...rest } = comp;
  const node: PieceNode = {
    kind: component,
    id,
    ...rest,
  };
  // Cycle guard: an envelope where component A lists B as a child and B lists
  // A back would recurse forever. Mark this id before descending, unmark after
  // (siblings can still reference the same component non-cyclically).
  if (visited.has(id)) return node;
  visited.add(id);
  if (Array.isArray(children) && children.length > 0) {
    const childNodes: PieceNode[] = [];
    for (const childId of children) {
      if (visited.has(childId)) continue;
      const child = byId.get(childId);
      if (child) childNodes.push(expand(child, byId, visited));
    }
    node.children = childNodes;
  }
  visited.delete(id);
  return node;
}

/**
 * Reverse — turn a PieceSurface into a flat envelope. Useful when the agent
 * authors UI imperatively and needs to send it cross-process.
 */
export function surfaceToEnvelope(surface: PieceSurface, surfaceId = 'default'): SurfaceEnvelope {
  const components: EnvelopeComponent[] = [];
  let nextAuto = 1;

  function visit(node: PieceNode, suggestedId?: string): string {
    const id = node.id ?? suggestedId ?? `auto_${nextAuto++}`;
    const childIds: string[] = [];
    if (Array.isArray(node.children)) {
      for (const child of node.children as PieceNode[]) {
        childIds.push(visit(child));
      }
    }
    const { kind, id: _drop, children: _drop2, ...rest } = node;
    const comp: EnvelopeComponent = {
      id,
      component: kind,
      ...(childIds.length > 0 ? { children: childIds } : {}),
      ...(rest as Record<string, unknown>),
    };
    components.push(comp);
    return id;
  }

  visit(surface.root, 'root');

  return {
    version: 'v0.10',
    updateComponents: { surfaceId, components },
    ...(surface.data ? { updateDataModel: { surfaceId, data: surface.data } } : {}),
  };
}
