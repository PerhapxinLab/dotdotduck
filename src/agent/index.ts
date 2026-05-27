/**
 * Agent subsystem — every LLM-driven engine in dddk lives here.
 *
 *   webagent/  — the DOM-grounded autonomous loop (read DOM → pick tool → act)
 *   inline/    — InlineAgent for editing text inside inputs / contenteditables
 *   llm/       — providers (OpenAI / Google / Proxy), router, adapter registry
 *   sitemap/   — sitemap tree + helpers + runtime SitemapLearner
 *   memory/    — long-term recall layer (BM25 over verbatim drawers)
 *   cursor.ts  — visible cursor overlay that previews each agent action
 *
 * Reachable from hosts via `@perhapxin/dddk/agent` (tree-shake friendly) or
 * from the root `@perhapxin/dddk` re-exports.
 */

// ─── WebAgent (DOM-grounded loop) ──────────────────────────────────

export { WebAgent } from './webagent/webagent';

export {
  border,
  highlight,
  spotlight,
  inject,
  removeOverlay,
  clearOverlays,
  listOverlays,
} from './webagent/overlay';

export { readDOM, type DomReadOptions } from './webagent/dom-reader';

export { builtinActions } from './webagent/actions';

export type {
  WebAgentConfig,
  AgentSession,
  AgentTurn,
  UserTurn,
  AgentStepTurn,
  AgentFinalTurn,
  AgentStatus,
  AgentEvent,
  ActionDefinition,
  ActionResult,
  ActionFailureReason,
  ActionContext,
  SitemapEntry,
  SitemapConfig,
  OverlayItem,
  OverlayType,
  PiecePlacement,
  RunOptions,
  SelectionContext,
} from './webagent/types';

export { DEFAULT_DESTRUCTIVE_PATTERNS } from './webagent/destructive';

export type { ScreenshotConfig, ScreenshotMode } from './webagent/screenshot';
export { captureScreenshots } from './webagent/screenshot';

export type {
  BrandPrompt,
  PromptContext,
  SystemPromptOverride,
} from './webagent/prompt';

// ─── Inline agent ──────────────────────────────────────────────────

export {
  InlineAgent,
  type InlineAgentConfig,
  type InlineAction,
} from './inline';

// ─── Agent cursor (visual layer) ───────────────────────────────────

export { AgentCursor, type AgentCursorConfig } from './cursor';

// ─── Sitemap ───────────────────────────────────────────────────────

export {
  serializeSitemap,
  resolvePath,
  searchSitemap,
  listAuthGatedPaths,
  SAAS_SITEMAP_TEMPLATE,
} from './sitemap/helpers';
export type { SitemapNode, SitemapResolution } from './sitemap/types';
export { buildSitemap } from './sitemap/build';
export type { NavTarget, BuildSitemapOpts } from './sitemap/build';
export {
  SitemapLearner,
  type SitemapLearnerOptions,
  type SitemapLearnerStorage,
} from './sitemap/learner';

// ─── Memory (agent's long-term recall layer) ───────────────────────

export {
  Memory,
  createMemory,
  type Drawer,
  type MemoryOpts,
  type MemorySearchOpts,
} from './memory';
