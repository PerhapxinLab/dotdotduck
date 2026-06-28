/**
 * @perhapxin/dddk — Command palette + voice + Dwell + inline AI + DOM-grounded agent SDK.
 *
 * Public root entry. Tree-shake-friendly partial entries also available:
 *   - `@perhapxin/dddk/agent`  — WebAgent + InlineAgent + LLM router + sitemap
 *   - `@perhapxin/dddk/llm`    — providers, router, adapter registry only
 *   - `@perhapxin/dddk/ui`     — Subtitle, placement, dock-state, Pieces
 *   - `@perhapxin/dddk/skills` — SkillRegistry, evals
 *   - `@perhapxin/dddk/toolbox/*` — search / qa / classify / recommend ...
 */

// ─── orchestrator ──────────────────────────────────────────────────

export { DotDotDuck, searchPageText, SessionsRegistry, AgentsRegistry } from './orchestrator';
export type { DotDotDuckConfig, SessionRegistration, RegisterableAgent } from './orchestrator';

// ─── tools registry ────────────────────────────────────────────────

export { ToolsRegistry } from './tools-registry';
export type { ToolSpec, RegisterQAOpts, QAToolItem } from './tools-registry';

// ─── triggers (input surfaces) ─────────────────────────────────────

export {
  GestureManager,
} from './triggers/space-gesture';
export type { GestureCallbacks, GestureManagerOptions } from './triggers/space-gesture';

export {
  CommandPalette,
  listPrefixMatches,
  displayPrefix,
} from './triggers/command-palette';
export type {
  PaletteItem,
  PaletteItemPrefix,
  PaletteAgentTool,
  PaletteHandle,
  PaletteAttachment,
  PaletteContext,
  PaletteCategory,
  ResultSurface,
  CameraOptions,
  CommandPaletteOptions,
} from './triggers/command-palette';

export { Spotter } from './triggers/spotter';
export type { SpotterOptions, SpotterState } from './triggers/spotter';

export { PanelRuntime } from './triggers/panel-runtime';
export type { PanelRuntimeHost, PanelRuntimeOptions } from './triggers/panel-runtime';

export { Dwell, type DwellConfig } from './triggers/dwell';
export { MobileTrigger, type MobileTriggerConfig, type MobileFABConfig } from './triggers/mobile';

// ─── ActionDeck (typed action system on palette items) ────────────

export {
  runAction,
  defaultIconFor,
} from './triggers/action-panel';
export type {
  PaletteAction,
  CopyAction,
  InsertAction,
  OpenUrlAction,
  NavigateAction,
  AgentTaskAction,
  RenderSurfaceAction,
  RunSkillAction,
  CustomAction,
  ActionRunContext,
} from './triggers/action-panel';

// ─── Agent subsystem (LLM engines + LLM layer + sitemap) ───────────

export {
  WebAgent,
  InlineAgent,
  AgentCursor,
  StreamingEnvelopeParser,
  Memory,
  CoreMemory,
  EpisodicMemory,
  SemanticMemory,
  DrawerMemory,
  createDrawerMemory,
  // v0.2.0 ROADMAP 1.1 — unified memory facade
  UnifiedMemory,
  createUnifiedMemory,
  Plan,
  TodosArtifact,
  MarkdownArtifact,
  border,
  highlight,
  spotlight,
  inject,
  removeOverlay,
  clearOverlays,
  listOverlays,
  readDOM,
  builtinActions,
  // Opt-in action exports — host opts in via `customActions: [...]`.
  escalateToHuman,
  trackIntent,
  workflowActions,
  validateForm,
  waitUntil,
  serializeSitemap,
  resolvePath,
  searchSitemap,
  listAuthGatedPaths,
  SAAS_SITEMAP_TEMPLATE,
  SitemapLearner,
} from './agent';
export type {
  PlanConfig,
  PlanInput,
  TaskPlan,
  TodoItem,
  MarkdownDoc,
  PlanSnapshot,
  PlanStorageAdapter,
} from './agent';
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
  BrandPrompt,
  PromptContext,
  SystemPromptOverride,
  DomReadOptions,
  InlineAgentConfig,
  InlineAction,
  ToolHandle,
  ContextProvider,
  ContextProviderHandle,
  ContextRole,
  ContextRequest,
  InlineScopeConfig,
  ScopeHandle,
  ScopeResolver,
  AgentCursorConfig,
  SitemapNode,
  SitemapResolution,
  SitemapLearnerOptions,
  SitemapLearnerStorage,
  Drawer,
  DrawerMemoryOpts,
  DrawerSearchOpts,
  // v0.2.0 ROADMAP 1.1 — unified memory facade types
  UnifiedMemoryConfig,
  RememberOpts,
  RecallResult,
  MemoryConfig,
  CoreMemoryConfig,
  CoreMemorySchema,
  CoreFieldType,
  EpisodicMemoryConfig,
  EpisodicEntry,
  SemanticMemoryConfig,
  SemanticMemoryEntry,
  MemoryProvider,
  MemoryPrivacyConfig,
  EnvelopeStreamEvent,
} from './agent';

// ─── LLM (providers, router, adapter registry) ─────────────────────

export {
  OpenAIProvider,
  GoogleProvider,
  ProxyProvider,
  resolveLLM,
  isLLMRouter,
} from './agent/llm';
export type {
  LLMRouter,
  LLMSource,
  LLMRouterRole,
  LLMProvider,
  CompleteOptions,
  CompleteResult,
  LLMMessage,
  LLMRole,
  ContentPart,
  ToolDefinition,
  ToolCall,
  OpenAIProviderConfig,
  GoogleProviderConfig,
  ProxyProviderConfig,
} from './agent/llm';

// Adapter registry — explicit `seedDefaultAdapters()` required (tsup
// tree-shakes pure side-effect imports).
export {
  seedDefaultAdapters,
  registerAdapter,
  getAdapter,
  listAdapters,
  unregisterAdapter,
  createProvider,
  openaiAdapter,
  googleAdapter,
  proxyAdapter,
  agnesAdapter,
} from './agent/llm';
export type { LLMAdapter, AdapterConfig } from './agent/llm';

// ─── skills (registry only — zero built-ins) ───────────────────────

export { SkillRegistry } from './skills/registry';
export type {
  Skill,
  BaseSkill,
  ScriptSkill,
  ScriptStep,
  PromptSkill,
  ActionSkill,
  ActionSkillContext,
  SurfaceSkill,
  SurfaceSkillContext,
  PanelSkill,
  PanelSkillContext,
  SkillTools,
  SurfacePlacement,
} from './skills/types';

export { PreferenceStore } from './skills/preferences';
export type {
  PreferenceField,
  PreferenceKind,
  PreferenceSchema,
  PreferenceContext,
} from './skills/preferences';

export {
  defineEval,
  runEvals,
  MockLLM,
  mockToolCall,
} from './skills/evals';

// v0.2.0 ROADMAP 2.6 — multi-step transaction with rollback
export { runTransaction } from './skills/transaction';
export type {
  TransactionStep,
  TransactionOpts,
  TransactionOutcome,
} from './skills/transaction';

// v0.2.0 ROADMAP 2.4 — form widget adapter registry
export {
  registerFormWidget,
  unregisterFormWidget,
  listFormWidgets,
  findFormWidget,
} from './agent/webagent/form-widgets';
export type {
  FormWidgetAdapter,
  FormWidgetFillContext,
} from './agent/webagent/form-widgets';
export type {
  EvalSpec,
  EvalAssertion,
  EvalTrace,
  EvalResult,
  EvalReport,
  RunEvalsOptions,
  MockLLMOptions,
} from './skills/evals';

// ─── UI primitives ─────────────────────────────────────────────────

export { Subtitle } from './ui/subtitle';
export { createDockState } from './ui/dock-state';
export type { DockState, DockStateValue, DockStateOpts } from './ui/dock-state';

// Canonical screen placement slots — every transient piece of UI
// (subtitle bar, voice indicator, palette, dock, modal, banner, FAB,
// toast) routes through this stylesheet so positions are defined once
// and stay consistent.
export {
  Placements,
  ensurePlacementStyles,
  applyPlacement,
  clearPlacement,
  PLACEMENT_ATTR,
} from './ui/placement';
export type { PlacementSlot, PlacementHandle } from './ui/placement';

// Pieces — declarative UI primitives system (lives at ui/pieces/).
export {
  PieceCatalog,
  PieceRenderer,
  PieceDomRenderer,
  readPointer,
  resolveValue,
  builtinPieces,
  createBuiltinCatalog,
  envelopeToSurface,
  surfaceToEnvelope,
} from './ui/pieces';
export type {
  PieceNode,
  PieceContext,
  PieceDefinition,
  PieceSurface,
  PieceRendererProps,
  PieceDomRendererOptions,
} from './ui/pieces';

// ─── built-in feature modules ──────────────────────────────────────

export {
  ImmersiveTranslate,
  VoiceModule,
  ThemeToggleModule,
  LanguageSwitcherModule,
  FormAssistModule,
  OnboardingModule,
  PinnedPanelRegistry,
  inspectForm,
} from './modules';
export type {
  VoiceModuleConfig,
  AudioTranscriber,
  ThemeToggleConfig,
  LanguageSwitcherConfig,
  FormAssistConfig,
  FormAssistInfo,
  OnboardingConfig,
  ImmersiveTranslateConfig,
  PinnedPanelHandle,
  PinnedPanelSpec,
  PinnedPanelPlacement,
} from './modules';

// ─── platform helpers ──────────────────────────────────────────────

export {
  isMac,
  paletteShortcutLabel,
  paletteShortcutLabelPlus,
} from './utils/platform';

// ─── utilities ─────────────────────────────────────────────────────

export { Cache } from './cache';
export type { CacheOptions, CacheTier } from './cache';

export {
  HeatRank,
  makeCacheAdapter,
} from './utils/heat-rank';
export type {
  HeatRankOptions,
  HeatRankAdapter,
} from './utils/heat-rank';

// ─── v0.2.0 ingest layer ──────────────────────────────────────────────

export {
  EVENT_SCHEMA_VERSION,
  makeEvent,
  Transport,
  HttpSink,
  DebugSink,
  MultiSink,
} from './ingest';
export type {
  EventCategory,
  BaseEvent,
  ClickEventProps,
  ScrollEventProps,
  HoverEventProps,
  FocusEventProps,
  RoutingEventProps,
  PerformanceEventProps,
  SessionStartProps,
  PageViewProps,
  CustomEventProps,
  EventSink,
  TransportOptions,
} from './ingest';

// ─── analytics (self-hosted store + export + SQL schema) ──────────
export {
  EventStore,
  defaultMapper,
  fieldMapper,
  filterEvents,
  eventToRow,
  rowToEvent,
  dddkEventsDDL,
  DDDK_EVENTS_COLUMNS,
  DDDK_EVENTS_DDL_SQLITE,
  DDDK_EVENTS_DDL_POSTGRES,
  DDDK_EVENTS_DDL_MYSQL,
  toCSV,
  toNDJSON,
  toSQL,
} from './analytics';
export type {
  Cap,
  CapInfo,
  EventStoreOpts,
  EventQuery,
  OnFullPolicy,
  NotifyHostHandler,
  SqlSchemaMapper,
  DddkEventRow,
  SqlDialect,
  ToCSVOptions,
  ToNDJSONOptions,
  ToSQLOptions,
} from './analytics';

// ─── shared types ──────────────────────────────────────────────────

export type {
  Locale,
  SubtitleType,
  SubtitleShowOptions,
  StorageAdapter,
  I18nDict,
  DddkEventName,
  DddkEventMap,
  DddkEventHandler,
  IntentEvent,
} from './types';
