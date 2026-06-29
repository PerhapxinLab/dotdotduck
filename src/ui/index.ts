export { Subtitle } from './subtitle';
// PieceRenderer (host-side surface renderer) lives in `../pieces/` and is re-exported from there.

// Inline AI edit UX primitives — processing line, diff panel, chat session.
// Hosts (perhapxin's doc editor, Tiptap embed, plain inputs) can call these
// directly; InlineAgent uses them via `displayAs: 'inline-diff'`.
export {
  mountProcessingLine,
  mountInlineDiff,
  InlineChatSession,
} from './inline-effects';
export type {
  ProcessingLineHandle,
  ProcessingLineOpts,
  InlineDiffHandle,
  InlineDiffOpts,
  InlineDiffOutcome,
  InlineDiffLabels,
  InlineChatTurn,
  InlineChatSendArgs,
  InlineChatTransport,
} from './inline-effects';
