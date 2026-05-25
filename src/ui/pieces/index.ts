/**
 * @perhapxin/dddk Pieces — unified UI primitive system.
 * See ../../docs/13-pieces.md for the full design.
 */

export type {
  PieceNode,
  PieceContext,
  PieceDefinition,
  PieceSurface,
} from './types';
export { PieceCatalog } from './types';

export { PieceRenderer, readPointer, resolveValue } from './renderer';
export type { PieceRendererProps } from './renderer';

export { PieceDomRenderer } from './dom-renderer';
export type { PieceDomRendererOptions } from './dom-renderer';

export { builtinPieces, createBuiltinCatalog } from './builtin';

export { envelopeToSurface, surfaceToEnvelope } from './surface-bridge';
