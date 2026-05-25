/**
 * Skill type definitions — 4 kinds: Script / Prompt / Action / Surface
 * See ../../docs/05-skills-sdk.md for the full design.
 */

export interface ScriptStep {
  page?: string;
  subtitle?: string;
  action?: (tools: SkillTools) => void | Promise<void>;
  waitForUser?: boolean;
}

export interface SkillTools {
  navigate(path: string): void;
  highlight(selector: string, color?: string, label?: string): string;
  border(selector: string, color?: string, label?: string): string;
  spotlight(selector: string): string;
  inject(selector: string, text: string, position?: 'before' | 'after'): string;
  subtitle(text: string): void;
  clearOverlays(): void;
  ask(question: string): Promise<string>;
  wait(ms: number): Promise<void>;
  llm?(prompt: string): Promise<string>;
  runSkill?(id: string, vars?: Record<string, string>): Promise<void>;
  /**
   * Show an ad-hoc Surface (form / dialog / picker) mid-script and await the
   * user's submission. Resolves with the form data when the host calls
   * `dddk.submitSurface(data)`, or `null` if the user cancels via
   * `dddk.cancelSurface()` / Esc.
   *
   * The surface argument is a `PieceSurface` (root PieceNode + optional data).
   * `placement` defaults to `'modal'` (full-screen popup); use `'subtitle'`
   * for the subtitle bar, `'dock'` for a persistent side panel.
   */
  surface(
    surface: unknown,
    opts?: { placement?: SurfacePlacement }
  ): Promise<Record<string, unknown> | null>;
}

/**
 * Surface placement (revised 2026-05-22).
 *
 * - `palette`  — render inside an active PanelSkill's content area
 * - `subtitle` — render in the existing subtitle bar (lightest, ignorable)
 * - `dock`     — persistent side panel, user can minimize/close
 * - `modal`    — full-screen popup with backdrop (canonical "popup", supports forms)
 */
export type SurfacePlacement = 'palette' | 'subtitle' | 'dock' | 'modal';

// ─── Base skill ────────────────────────────────────────────────────

export interface BaseSkill {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  /** Hide from palette listing (still callable). */
  hidden?: boolean;
  /** Function returning whether this skill is currently visible to the user. */
  visible?: (ctx: { user?: unknown }) => boolean;
  /**
   * Declarative preferences. If any `required: true` field is unfilled,
   * dddk auto-renders a setup Surface form before dispatching the skill.
   * See ./preferences.ts
   */
  preferences?: Array<import('./preferences').PreferenceField>;
}

// ─── ScriptSkill ───────────────────────────────────────────────────

export interface ScriptSkill extends BaseSkill {
  type: 'script';
  steps: ScriptStep[];
}

// ─── PromptSkill ───────────────────────────────────────────────────

export interface PromptSkill extends BaseSkill {
  type: 'prompt';
  /** System prompt or prompt template. Use `{{var}}` placeholders. */
  prompt: string;
  variables?: Record<string, string>;
}

// ─── ActionSkill ───────────────────────────────────────────────────

export interface ActionSkillContext {
  palette: {
    close(): void;
    replace(items: Array<{ id: string; name: string; handler: () => void }>): void;
  };
  subtitle: {
    show(opts: { text: string; type?: string; autoHide?: number }): void;
    hide(): void;
  };
  storage: {
    get<T = string>(key: string): T | null;
    set(key: string, value: unknown): void;
  };
  /** Read this skill's declared preferences (empty object if no schema). */
  getPreferences<T = Record<string, unknown>>(): T;
  llm?(prompt: string): Promise<string>;
  agent?(task: string): void;
  navigate(path: string): void;
}

export interface ActionSkill extends BaseSkill {
  type: 'action';
  handler: (ctx: ActionSkillContext) => void | Promise<void>;
}

// ─── SurfaceSkill ──────────────────────────────────────────────────
// A skill that renders an interactive UI surface (form, dialog, multi-step
// panel) when invoked. `build` returns a `PieceSurface`; `onSubmit` receives
// the user's data.

export interface SurfaceSkillContext extends ActionSkillContext {}

export interface SurfaceSkill extends BaseSkill {
  type: 'surface';
  build: (ctx: SurfaceSkillContext) => Promise<unknown>;
  onSubmit?: (
    data: Record<string, unknown>,
    ctx: SurfaceSkillContext
  ) => Promise<unknown> | unknown;
}

// ─── PanelSkill ────────────────────────────────────────────────────
// A skill that takes over the palette layout with "top input + bottom panel"
// and stays interactive while the user types. Used for live search, chat,
// recommend explorers, etc. Runtime support requires the navigation-stack
// renderer (Phase 2 of the dddk core refactor).

export interface PanelSkillContext extends ActionSkillContext {
  /** Render a new PieceSurface into the panel area. */
  render(surface: unknown): void;
  /** Pop this panel skill off the navigation stack. */
  back(): void;
  /** Update the input box's placeholder. */
  setPlaceholder(text: string): void;
}

export interface PanelSkill extends BaseSkill {
  type: 'panel';
  /**
   * `palette`  — keep slash-command routing + ask-AI fallback; free-text goes
   *              to onInput. Best for search / recommend / qa / classify.
   * `takeover` — input is purely passed to onInput. No command parsing.
   *              Best for chat / continuous webagent.
   */
  inputMode: 'palette' | 'takeover';
  /** Custom placeholder for the input box while in this skill. */
  inputPlaceholder?: string;
  /** Called once when the skill is entered (empty input). */
  onEnter?: (ctx: PanelSkillContext) => Promise<unknown> | unknown;
  /** Called on every input change (debounced by the palette renderer). */
  onInput: (text: string, ctx: PanelSkillContext) => Promise<unknown> | unknown;
  /** Called when the user submits (Enter). Optional; many panels use onInput live. */
  onSubmit?: (text: string, ctx: PanelSkillContext) => Promise<unknown> | unknown;
  /** Called when the user activates a piece action inside the panel. */
  onAction?: (
    action: string,
    data: unknown,
    ctx: PanelSkillContext
  ) => Promise<unknown> | unknown;
  /** Called when the skill is popped from the stack. */
  onLeave?: () => Promise<void> | void;
}

export type Skill = ScriptSkill | PromptSkill | ActionSkill | SurfaceSkill | PanelSkill;
