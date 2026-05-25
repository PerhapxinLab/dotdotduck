/**
 * Pieces — dddk's UI primitive system.
 *
 * Like HTML elements, but a curated set covering common SaaS UI patterns,
 * plus a `Slot` escape hatch for host-supplied components.
 *
 * Two ways to author the same UI:
 *   1. Direct API:  Pieces.Card({ children: [Pieces.Heading({ text: 'Hi' })] })
 *   2. Flat envelope (id-keyed component list): { component: 'Card', children: [{ component: 'Heading', text: 'Hi' }] }
 *
 * Both paths resolve through the same PieceRenderer with the same catalog.
 */

import type { ReactNode } from 'react';

// ─── core shapes ───────────────────────────────────────────────────

/** Discriminated piece — `kind` selects the catalog entry. */
export interface PieceNode {
  kind: string;
  /** Optional id, used to address nodes for partial updates. */
  id?: string;
  /** Optional binding path (JSON Pointer or simple key) into the data model. */
  bind?: string;
  /** Catalog-specific props. */
  [key: string]: unknown;
}

export interface PieceContext {
  /** Reactive data model (mutated by inputs, read by `bind`). */
  data: Record<string, unknown>;
  /** Update a bound value. */
  setBinding(path: string, value: unknown): void;
  /** Fire a named action — e.g. 'submit', 'cancel', or any custom string. */
  trigger(actionName: string, payload?: unknown): void;
  /** Render a child PieceNode (recursive). */
  render(node: PieceNode): ReactNode;
}

export interface PieceDefinition<P = Record<string, unknown>> {
  kind: string;
  /**
   * Render function. Returns React node OR a DOM element factory for
   * non-React hosts (advanced — most users return JSX).
   */
  render(props: P & PieceNode, ctx: PieceContext): ReactNode;
  /**
   * Optional JSON Schema for props — useful when an LLM agent authors the
   * piece from an envelope (the schema gives the LLM a contract).
   */
  propsSchema?: Record<string, unknown>;
  /**
   * Optional display metadata for tooling (palette previews, docs).
   */
  meta?: {
    category: 'layout' | 'content' | 'data' | 'input' | 'action' | 'feedback' | 'slot';
    description?: string;
  };
}

// ─── catalog ───────────────────────────────────────────────────────

export class PieceCatalog {
  private pieces = new Map<string, PieceDefinition>();

  constructor(initial: PieceDefinition[] = []) {
    for (const p of initial) this.register(p);
  }

  register(piece: PieceDefinition): void {
    if (this.pieces.has(piece.kind)) {
      console.warn(`[Pieces] kind "${piece.kind}" already registered — replacing.`);
    }
    this.pieces.set(piece.kind, piece);
  }

  get(kind: string): PieceDefinition | undefined {
    return this.pieces.get(kind);
  }

  list(): PieceDefinition[] {
    return Array.from(this.pieces.values());
  }

  /**
   * Merge another catalog into this one. Host's custom catalog wins on
   * conflict — lets enterprises extend / override built-ins.
   */
  extend(other: PieceCatalog | PieceDefinition[]): void {
    const incoming = Array.isArray(other) ? other : other.list();
    for (const p of incoming) this.register(p);
  }
}

// ─── tree / surface ────────────────────────────────────────────────

/**
 * A complete UI surface — root piece + optional initial data model.
 * Output of a skill, palette command, or external envelope translation.
 */
export interface PieceSurface {
  root: PieceNode;
  data?: Record<string, unknown>;
}
