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

// v0.2.0 ROADMAP 1.9 — streaming envelope parser, public so adapters
// and tests can feed it tool-call args deltas.
export { StreamingEnvelopeParser } from './webagent/runtime/streaming-envelope';
export type { EnvelopeStreamEvent } from './webagent/runtime/streaming-envelope';

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

export {
  builtinActions,
  // Opt-in action exports — host registers via `customActions`.
  escalateToHuman,
  trackIntent,
  workflowActions,
  validateForm,
  waitUntil,
} from './webagent/actions';

// v0.2.0 ROADMAP 2.4 — form widget adapter registry
export {
  registerFormWidget,
  unregisterFormWidget,
  listFormWidgets,
  findFormWidget,
} from './webagent/form-widgets';
export type {
  FormWidgetAdapter,
  FormWidgetFillContext,
} from './webagent/form-widgets';

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
  type InlineScopeConfig,
  type ScopeHandle,
  type ScopeResolver,
} from './inline';

export type {
  ToolHandle,
  ContextProvider,
  ContextProviderHandle,
  ContextRole,
  ContextRequest,
} from './webagent/types';

export {
  defaultUrlProvider,
  defaultPageSummaryProvider,
  defaultDomProvider,
  defaultScreenshotProvider,
  defaultHistoryProvider,
  defaultSelectionProvider,
  recordNavigation,
  DEFAULT_CONTEXT_PROVIDERS,
  getDefaultContextProvider,
} from './webagent/context-providers';

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

// ─── Memory (agent's long-term recall + 3-tier hybrid memory) ──────

export {
  Memory,
  CoreMemory,
  EpisodicMemory,
  SemanticMemory,
  DrawerMemory,
  createDrawerMemory,
  // v0.2.0 ROADMAP 1.1 — unified facade
  UnifiedMemory,
  createUnifiedMemory,
} from './memory';
export type {
  MemoryConfig, CoreMemoryConfig, CoreMemorySchema, CoreFieldType,
  EpisodicMemoryConfig, EpisodicEntry,
  SemanticMemoryConfig, SemanticMemoryEntry, MemoryProvider,
  MemoryPrivacyConfig,
  Drawer, DrawerMemoryOpts, DrawerSearchOpts,
  // v0.2.0 ROADMAP 1.1 — unified facade types
  UnifiedMemoryConfig, RememberOpts, RecallResult,
} from './memory';

// ─── Plan (LLM-mediated structured artifact module) ────────────────
// Standalone module — owns `todos` (used by webagent.planner) +
// `markdown` artifacts. Attach with `plan.attachTo(dddk)` then wire
// `webagent.planner: (input) => plan.makeTodos(input)`.
export {
  Plan,
  TodosArtifact,
  MarkdownArtifact,
  type PlanConfig,
  type PlanInput,
  type TaskPlan,
  type TodoItem,
  type MarkdownDoc,
  type PlanSnapshot,
  type PlanStorageAdapter,
} from './plan';
