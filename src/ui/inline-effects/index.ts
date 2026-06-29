// Framework-agnostic primitives for inline AI edit UX. Use these from any host
// (Svelte, React, plain DOM) to show:
//
//   • a "Processing" line under the selection while the LLM works
//     (`mountProcessingLine`)
//   • a strikethrough-old → new diff panel with accept / reject / insert-below /
//     copy / chat-followup buttons (`mountInlineDiff`)
//   • a chat-style follow-up session that remembers prior turns so a follow-up
//     prompt like "make it shorter" carries context (`InlineChatSession`)
//
// The InlineAgent module (`@perhapxin/dddk/agent` inline) consumes these when
// an action is configured with `displayAs: 'inline-diff'`. Hosts that have
// their own selection / replacement plumbing (e.g. a Tiptap-based editor) can
// call these helpers directly without going through InlineAgent.

export { mountProcessingLine } from './processingLine';
export type { ProcessingLineHandle, ProcessingLineOpts } from './processingLine';
export { mountInlineDiff } from './inlineDiff';
export type {
  InlineDiffHandle,
  InlineDiffOpts,
  InlineDiffOutcome,
  InlineDiffLabels,
} from './inlineDiff';
export { InlineChatSession } from './chatSession';
export type {
  InlineChatTurn,
  InlineChatSendArgs,
  InlineChatTransport,
} from './chatSession';
