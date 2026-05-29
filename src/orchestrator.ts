/**
 * DotDotDuck — main orchestrator.
 * Wires gestures + palette + dwell + skills + subtitle UI together.
 *
 * Webagent integration is OPTIONAL — pass a factory and it'll be used for skill
 * agent runs; otherwise dddk works standalone for palette + skills + voice.
 *
 * See ./docs/00-overview.md for the full design.
 */

import {
  WebAgent,
  clearOverlays as clearWebagentOverlays,
  type WebAgentConfig,
  type AgentEvent,
  type SelectionContext,
} from './agent';
import type { LLMSource } from './agent/llm/router';

import { GestureManager, type GestureCallbacks } from './triggers/space-gesture';
import { CommandPalette, type PaletteItem } from './triggers/command-palette';
import { Spotter } from './triggers/spotter';
import { SkillRegistry } from './skills/registry';
import { PanelRuntime } from './triggers/panel-runtime';
import { ensureDwellStyles } from './triggers/dwell/styles';
import { Placements } from './ui/placement';
import { sdkString } from './utils/sdk-i18n';
import { PinnedPanelRegistry } from './modules/pinned-panel';
import { ToolsRegistry } from './tools-registry';
import type { Skill, ScriptSkill } from './skills/types';
import { PreferenceStore } from './skills/preferences';
import { Subtitle } from './ui/subtitle';
import { TypedEmitter } from './event-emitter';
import type {
  Locale,
  StorageAdapter,
  I18nDict,
  DddkEventName,
  DddkEventMap,
  DddkEventHandler,
  IntentEvent,
} from './types';
import type { AgentSession, OnLoopEnd } from './agent/webagent/types';

export interface DotDotDuckConfig {
  locale?: Locale;
  agentName?: string;
  siteName?: string;

  /**
   * LLM source — single `LLMProvider` (same model everywhere) or `LLMRouter`
   * (per-role). Required for any agent functionality; if omitted, palette
   * commands without LLM still work but `startAgent()` will no-op with a
   * subtitle warning, and Voice / SelectionTools will reject construction.
   */
  llm?: LLMSource;

  /** Skills available in palette and via /command syntax. */
  skills?: Skill[];

  /** Palette commands. dddk ships ZERO built-in commands; host adds all. */
  paletteCommands?: PaletteItem[];

  /**
   * WebAgent config (excluding `llm`, which lives at top level on this config).
   * Use `brand` + `appendSystemPrompt` to layer domain knowledge onto the
   * default prompt — see docs/13-prompt-design.md for the API.
   * dddk creates the WebAgent instance internally and intercepts its events
   * so that subtitles / surface / ask_user all flow through dddk's UI layer.
   */
  webAgent?: Omit<WebAgentConfig, 'llm' | 'customActions'> & {
    customActions?: WebAgentConfig['customActions'];
  };

  /**
   * Per-entry webagent behavior.
   *
   * The same webagent is used from three entry points:
   *   - voice     — push-to-talk / continuous listen
   *   - selection — user selects text then asks AI
   *   - palette   — palette "Ask AI" free-text input
   *
   * Each entry can be either `one_shot` (ask → answer → close) or
   * `continuous` (stays open as a panel, can chain more turns).
   *
   * `voice.keepListening: true` is the "walkie-talkie" mode — mic auto-reopens
   * after the agent finishes responding.
   *
   * Defaults: voice / selection one_shot, palette continuous.
   */
  webAgentEntries?: {
    voice?:     { mode?: 'one_shot' | 'continuous'; keepListening?: boolean };
    selection?: { mode?: 'one_shot' | 'continuous' };
    palette?:   { mode?: 'one_shot' | 'continuous' };
  };

  /**
   * Inject persistent context into the agent at each turn. Host queries their
   * own backend (CRM / customer DB / long-term memory) and returns system
   * messages to prepend. Toolbox keeps only session-level context internally.
   */
  webAgentContextProvider?: (turn: {
    customerId?: string;
    text: string;
    sessionId?: string;
  }) => Promise<Array<{ role: 'system' | 'assistant' | 'user'; content: string }>> | Array<{ role: 'system' | 'assistant' | 'user'; content: string }>;

  /**
   * Voice input config. Default: `{ enabled: true }`. Set `enabled: false`
   * to disable the hold-space STT gesture (palette / spotter still work).
   * Can be flipped at runtime via `dddk.setVoiceEnabled(bool)`.
   */
  voice?: {
    enabled?: boolean;
  };

  /**
   * DOM-grounded agent config. Default: `{ enabled: true }` when `llm` is
   * set; effectively off when `llm` is unset.
   *
   * Set `enabled: false` to keep the LLM (for inline AI / voice cleanup /
   * other roles) but completely disable the agent loop — `startAgent()`
   * no-ops with an info subtitle, palette plain-text Enter does NOT fire
   * the agent, and skills that emit `agent` calls log a warning. Use this
   * when you want dddk's palette / voice / Dwell pieces but explicitly
   * NOT the autonomous "let the agent click things on the page" pathway.
   *
   * Can be flipped at runtime via `dddk.setAgentEnabled(bool)`.
   */
  agent?: {
    enabled?: boolean;
  };

  /** Per-host storage (for clipboard history, recent commands, etc.). Defaults to localStorage. */
  storage?: StorageAdapter;

  /** Host route navigation callback (for SPA-friendly nav). Hosts whose
   *  router returns a Promise (e.g. SvelteKit's `goto(path)`) should
   *  return that Promise so the agent knows when the page render
   *  completes before reading the new DOM. */
  onNavigate?: (path: string) => void | Promise<void>;

  /**
   * Custom renderer for PanelSkill surfaces. When a PanelSkill calls
   * `ctx.render(surface)`, the runtime hands the surface to this
   * function which paints it into the panel content area. Use this to
   * support host-defined surface shapes (rich HTML, framework components,
   * piece schemas). When omitted, the runtime renders nothing — the
   * skill is responsible for any DOM via other side-effects.
   *
   * The `onAction(actionName, data)` callback wires user gestures
   * (clicks on `[data-dddk-action]` elements) back to the skill's
   * `onAction` handler.
   */
  panelRenderPiece?: (
    container: HTMLElement,
    surface: unknown,
    onAction: (action: string, data: unknown) => void,
  ) => void;

  /** Override gesture key (legacy 'ctrl' for migration). Default 'space'. */
  gestureKey?: 'space' | 'ctrl';

  /**
   * How long the user must hold the gesture key before voice triggers.
   * Default 250ms — snappy enough that the gesture feels live, clear of
   * the natural fast-typing space-tap range (~80-200ms). Bump if your
   * audience types prose fast and hits accidental voice triggers; lower
   * if you want the gesture to feel even more instant.
   */
  holdThresholdMs?: number;

  /**
   * Window for "second tap counts as double-tap reject" detection.
   * Default 350ms. Two space taps inside this window → onReject;
   * outside → second tap is just a fresh single-tap. Useful to tune for
   * users with slower fingers (raise) or to fire reject more eagerly
   * (lower).
   */
  doubleTapWindowMs?: number;

  /** Locale dictionary override. */
  i18n?: I18nDict;

  /**
   * Camera icon at the right of the palette input — lets users attach an image
   * (uploaded file or page screenshot) to their next query.
   *   - omit / undefined: no camera button (default)
   *   - `false`: explicitly off (same as omit, but type-clear)
   *   - object: enable with this config (see {@link CameraOptions})
   */
  camera?: import('./triggers/command-palette').CameraOptions | false;

  /**
   * Optional chip row rendered below the palette input. Each `PaletteItem`
   * with a `category` field that matches a chip's `id` shows when that
   * chip is active. An implicit "All" chip is prepended automatically.
   */
  paletteCategories?: import('./triggers/command-palette').PaletteCategory[];
  /** Label for the implicit "All" chip. Defaults to "All". */
  paletteAllCategoriesLabel?: string;

  /**
   * Override the indicator labels shown in the subtitle bar. All fields
   * optional — leave undefined to use the bundled locale-aware defaults.
   *
   *  - `running`: shown immediately after the user taps Space accept /
   *    reject on an agent confirm prompt, while the next LLM call is
   *    in flight. Defaults: `'Agent 執行中…'` (zh-TW) / `'Agent running…'`.
   *  - `processing`: shown by the SDK's `dddk.subtitle.showIndicator
   *    ('processing')` calls (immersive-translate progress, voice
   *    transcription, etc.) when no explicit label is passed.
   *  - `listening`: STT-active indicator label.
   *
   * Pass strings or per-locale records:
   *   indicators: { running: 'Working on it…' }
   *   indicators: { running: { en: 'Working…', 'zh-TW': '處理中…' } }
   */
  indicators?: {
    running?: string | Record<string, string>;
    processing?: string | Record<string, string>;
    listening?: string | Record<string, string>;
  };

  /**
   * Auto-hide policy for the streaming subtitle bar AFTER the agent's
   * final paragraph has fully streamed in (`AgentEvent kind: 'final'`).
   * Pass:
   *  - `0` or omit — uses the SDK default (12s).
   *  - milliseconds — auto-hide after this many ms once finalized.
   *
   * Errors that abort the run get a separate `error` slot — same
   * config shape if you pass an object.
   */
  agentSubtitleAutoHideMs?: number | { summary?: number; error?: number };
}

export class DotDotDuck {
  readonly skills: SkillRegistry;
  private panelRuntime: PanelRuntime | null = null;
  readonly subtitle: Subtitle;
  readonly palette: CommandPalette;
  readonly spotter: Spotter;
  /**
   * Mount custom DOM into one of the canonical screen slots
   * (`subtitle` / `indicator` / `palette` / `dock` / `modal` / `banner`
   * / `fab` / `toast`). The slot's position, z-index, and max-width are
   * already defined by the shared placement stylesheet — hosts only
   * style the content, not the chrome.
   *
   *   const h = dddk.placement.mount('banner', '<div>Maintenance at 10pm</div>');
   *   // ... later:
   *   h.unmount();
   */
  readonly placement = new Placements();

  /**
   * Pinned-panel registry — small persistent cards anchored to one of
   * the four screen corners. Use for onboarding checklists, "powered by"
   * widgets, multi-step forms.
   *
   *   const h = dddk.panel.create({
   *     id: 'getting-started',
   *     title: 'The Basics',
   *     items: [
   *       { kind: 'task', id: 'a', label: 'Create your first project' },
   *       { kind: 'task', id: 'b', label: 'Invite your team' },
   *     ],
   *     onSubmit: (data) => analytics.track('onboarding.done', data.values),
   *   });
   *   h.complete('a');
   *   h.unmount();
   */
  readonly panel = new PinnedPanelRegistry();

  /**
   * Tool registry — host registers capabilities (QA / search / recommend /
   * custom domain actions) and the webagent picks them up automatically.
   * The LLM sees each tool's name + description + JSON-schema parameters,
   * decides when to call them, and the result feeds back into the loop.
   *
   *   dddk.tools.register({ name, description, parameters, handler });
   *   dddk.tools.registerQA({ items: customerFAQ });
   *   dddk.tools.unregister('qa_lookup');
   *   dddk.tools.list();
   *
   * Tools registered BEFORE the webagent is first invoked land in the
   * initial customActions set. Tools registered AFTER are injected into
   * the live agent via `agent.registerAction()`, so order doesn't matter.
   * Details + the QA convenience helper live in `tools-registry.ts`.
   */
  readonly tools = new ToolsRegistry();

  private config: DotDotDuckConfig;
  private gestures?: GestureManager;
  private emitter = new TypedEmitter();
  private storage: StorageAdapter;
  private prefs: PreferenceStore;
  private pendingPrefs: { skillId: string; resolve: () => void; reject: () => void } | null = null;
  /**
   * Ad-hoc Surface awaiting host submission. Lifecycle:
   *   1. ScriptSkill step calls `tools.surface(...)` → emits `surface` event
   *   2. Host renders + collects user input
   *   3. Host calls `dddk.submitSurface(data)` or `dddk.cancelSurface()`
   *   4. The promise returned to the skill resolves with data (or null)
   */
  private pendingSurface: { resolve: (data: Record<string, unknown> | null) => void } | null = null;
  private agentInstance: WebAgent | null = null;
  private voiceEnabled: boolean;
  private agentEnabled: boolean;
  private currentSelection: SelectionContext | null = null;

  constructor(config: DotDotDuckConfig = {}) {
    this.config = config;
    this.skills = new SkillRegistry(config.skills);
    this.subtitle = new Subtitle({ locale: config.locale === 'en' ? 'en' : 'zh-TW' });
    // Indicator label overrides — host can pass a string OR a
    // { [locale]: string } map. We resolve to the active locale, falling
    // back to English if the locale isn't in the map.
    const resolveIndicator = (
      v: string | Record<string, string> | undefined,
    ): string | null => {
      if (!v) return null;
      if (typeof v === 'string') return v;
      return v[String(config.locale ?? 'en')] ?? v.en ?? null;
    };
    const running = resolveIndicator(config.indicators?.running);
    if (running) this.subtitle.setRunningLabel(running);
    // Wire the × close button on the subtitle bar to:
    //   1. stop a running agent (with stopped-feedback subtitle)
    //   2. fire gesture_escape so a running ScriptSkill cancels too
    //      (its `waitForAcceptOrEscape` listens on this event; without
    //      this hook a click-outside during a script just hid the
    //      subtitle and the NEXT step's subtitle would silently appear)
    this.subtitle.setCloseHandler(() => {
      this.handleUserStopAgent('close');
      this.emitter.emit('gesture_escape', undefined);
    });
    this.storage = config.storage ?? defaultStorage();
    this.prefs = new PreferenceStore(this.storage, this.config.locale);
    this.voiceEnabled = config.voice?.enabled ?? true;
    this.agentEnabled = config.agent?.enabled ?? true;

    this.palette = new CommandPalette({
      initialItems: this.buildPaletteItems(),
      locale: config.locale,
      placeholder: this.t('palette.placeholder', sdkString(config.locale, 'palette.placeholder')),
      searchPage: (q) => searchPageText(q),
      // Camera button is OFF unless the host passes a `camera` config — the SDK
      // ships zero defaults. Hosts who want the screenshot button wire it up
      // explicitly via DotDotDuckConfig.camera.
      camera: this.config.camera === false ? undefined : this.config.camera,
      categories: this.config.paletteCategories,
      allCategoriesLabel: this.config.paletteAllCategoriesLabel,
      onActivate: (info) => {
        this.emitIntent({
          kind: 'palette_activated',
          itemId: info.itemId,
          arg: info.arg,
          selectionText: info.selectionText,
          attachmentsCount: info.attachmentsCount,
          timestamp: Date.now(),
        });
      },
    });

    this.spotter = new Spotter({
      // Spotter is wired but the auto-ring (the pink frame that appears around
      // whatever element you hover for 200ms) is OFF by default. It was a UX
      // misfire — text-rich pages produce a frame around every paragraph the
      // user pauses on. Hosts that want the ring (e.g. for a "pick an
      // element" picker UI) can call `dddk.spotter.start()` themselves.
      ignoreSelector: '[data-dddk-ui]',
      enableRing: false,
      onLock: ({ selector }) => {
        this.emitter.emit('pointer_lock', {
          selector,
          element: document.querySelector<HTMLElement>(selector)!,
        });
      },
      onLassoComplete: (info) => this.emitter.emit('pointer_lasso', info),
      onRingShow: ({ selector }) => this.emitter.emit('pointer_ring_show', { selector }),
      onRingHide: () => this.emitter.emit('pointer_ring_hide', undefined),
    });
  }

  /**
   * Update the active locale at runtime. Used by hosts that flip
   * `en` / `zh-TW` via an in-page toggle (no full reload). Updates the
   * orchestrator's own copy plus owned components (`subtitle`). Sibling
   * modules the host owns (`InlineAgent`, `VoiceModule`, …) need their
   * own `setLocale` call from the host.
   */
  setLocale(locale: Locale): void {
    this.config.locale = locale;
    this.subtitle.setLocale(locale);
    try { this.palette.setLocale(locale); } catch { /* palette torn down */ }
    try { this.agentInstance?.setLocale(locale); } catch { /* agent not built */ }
  }

  // ─── lifecycle ──────────────────────────────────────────────────

  mount(): void {
    const callbacks: GestureCallbacks = {
      onAccept: () => {
        this.emitter.emit('gesture_accept', undefined);
        // The subtitle bar accepts callbacks (onAccept) from callers
        // (Proactive prompt, agent ask_user, etc.) but its DOM only
        // wires button clicks. Bridge the gesture here so a space tap
        // also fires the same callback. Returns false when no callback
        // is registered — we don't suppress the gesture in that case.
        this.subtitle.invokeAccept();
        this.emitIntent({ kind: 'agent_answered', answer: 'accept', via: 'gesture', timestamp: Date.now() });
      },
      onReject: () => {
        this.emitter.emit('gesture_reject', undefined);
        const hadReject = this.subtitle.invokeReject();
        // If the subtitle had its own reject (e.g. confirm dialog: "no"),
        // that handler already fired and the bar is gone. If not, this
        // is a "user dismissed the agent" double-tap — stop the loop
        // with a polished feedback line.
        if (!hadReject) {
          if (this.agentInstance?.isRunning()) {
            this.handleUserStopAgent('reject');
          } else {
            this.subtitle.hide();
          }
        }
        this.emitIntent({ kind: 'agent_answered', answer: 'reject', via: 'gesture', timestamp: Date.now() });
      },
      onAcceptLine: () => {
        this.emitter.emit('gesture_accept', undefined);
        this.subtitle.invokeAccept();
      },
      onVoiceStart: () => {
        if (!this.voiceEnabled) return;
        // Long-press space while agent is running = "I have a new
        // prompt to say". Stop the current agent loop cleanly first,
        // then let voice take over.
        this.handleUserStopAgent('voice');
        this.emitter.emit('voice_start', undefined);
      },
      onVoiceEnd: () => {
        if (!this.voiceEnabled) return;
        this.emitter.emit('voice_end', { text: '' });
      },
      onPaletteToggle: (selection) => {
        this.currentSelection = selection ? this.captureSelection(selection) : null;
        // Opening the palette signals "I want to type a new prompt" —
        // stop the agent so the next message is a clean start, not a
        // race with the in-flight loop.
        this.handleUserStopAgent('palette');
        this.emitter.emit('palette_open', { selection });
        this.palette.toggle(selection);
      },
      onEscape: () => {
        this.emitter.emit('gesture_escape', undefined);
        // PanelRuntime owns Esc when a panel skill is open — esc
        // means "go back one step / close this panel", NOT "stop
        // the agent" / "close the palette". Bail before any of the
        // cross-cutting stop handlers fire.
        if (this.panelRuntime?.isOpen()) return;
        // Palette owns Esc when it's in result-mode or a sub-menu —
        // esc means "back one level" there, not "close the whole
        // palette". Let the palette's own keydown handler take care
        // of it. (Palette's plain list mode still falls through to
        // the close() call below.)
        if (this.palette.hasInternalEsc()) return;
        this.handleUserStopAgent('esc');
        this.palette.close();
        this.spotter.unlock();
      },
    };

    this.gestures = new GestureManager({
      callbacks,
      gestureKey: this.config.gestureKey,
      holdThresholdMs: this.config.holdThresholdMs,
      doubleTapWindowMs: this.config.doubleTapWindowMs,
      shouldIntercept: () => this.subtitle.isVisible() || this.palette.isOpen(),
    });
    this.gestures.start();
    // Keep GestureManager.hasSuggestion in sync with subtitle visibility —
    // single space tap → accept ONLY fires when hasSuggestion is true.
    // Without this hook a proactive prompt would render but space taps
    // would be no-ops; double-tap reject still works because it doesn't
    // gate on hasSuggestion.
    const gestures = this.gestures;
    this.subtitle.setVisibilityListener((visible) => {
      gestures.hasSuggestion = visible;
    });

    // Touch-tap relay: the subtitle bar's internal touch handler emits
    // DOM events instead of calling invokeAccept/Reject directly, so
    // we can run the SAME full pipeline desktop Space goes through —
    // emit `gesture_accept` for script skills, log intent, etc.
    const onBarTapAccept = (): void => this.triggerAccept();
    const onBarTapReject = (): void => this.triggerReject();
    document.addEventListener('dddk:bar-tap-accept', onBarTapAccept);
    document.addEventListener('dddk:bar-tap-reject', onBarTapReject);

    // NOTE: Spotter is NOT auto-started. Its hover-ring fires on plain
    // mousemove and would shadow every paragraph on a text-rich page. Hosts
    // that need it call `dddk.spotter.start()` themselves.
  }

  destroy(): void {
    this.gestures?.destroy();
    this.spotter.destroy();
    this.palette.close();
    this.subtitle.hide();
    this.subtitle.hideIndicator();
    this.agentInstance?.destroy();
    this.emitter.clear();
  }

  // ─── events ─────────────────────────────────────────────────────

  on<E extends DddkEventName>(event: E, handler: DddkEventHandler<E>): void {
    this.emitter.on(event, handler);
  }

  off<E extends DddkEventName>(event: E, handler: DddkEventHandler<E>): void {
    this.emitter.off(event, handler);
  }

  // ─── skill dispatch ─────────────────────────────────────────────

  async runSkill(idOrCommand: string, vars: Record<string, string> = {}): Promise<void> {
    const skill = this.skills.match(idOrCommand) ?? this.skills.get(idOrCommand);
    if (!skill) return;

    // Preferences gate — if any required pref missing, render setup surface first.
    if (skill.preferences && skill.preferences.length > 0) {
      const schema = { skillId: skill.id, fields: skill.preferences };
      const ctx = this.prefs.contextFor(schema);
      if (!ctx.isComplete()) {
        const surface = this.prefs.buildSetupSurface(schema);
        const ok = await new Promise<boolean>((resolve) => {
          this.pendingPrefs = {
            skillId: skill.id,
            resolve: () => {
              this.pendingPrefs = null;
              resolve(true);
            },
            reject: () => {
              this.pendingPrefs = null;
              resolve(false);
            },
          };
          this.emitter.emit('surface', { surface, placement: 'modal' });
        });
        if (!ok || !ctx.isComplete()) return;
      }
    }

    this.emitter.emit('skill_start', { skillId: skill.id });
    this.emitIntent({ kind: 'skill_started', skillId: skill.id, timestamp: Date.now() });
    this.currentSkillId = skill.id;

    try {
      switch (skill.type) {
        case 'script':
          await this.runScriptSkill(skill);
          break;
        case 'prompt': {
          const args = this.skills.parseArgs(idOrCommand);
          const merged = args ? { ...vars, args } : vars;
          const prompt = this.skills.resolvePrompt(skill, merged);
          this.startAgent(prompt);
          break;
        }
        case 'action':
          await skill.handler(this.buildActionContext(skill.id));
          break;
        case 'surface': {
          const surface = await skill.build(this.buildActionContext(skill.id));
          this.emitter.emit('surface', { surface, placement: 'modal' });
          // Host listens to the `surface` event and calls onSubmit upon submission.
          break;
        }
        case 'panel': {
          await this.ensurePanelRuntime().enter(skill);
          break;
        }
      }
    } finally {
      this.emitter.emit('skill_done', { skillId: skill.id });
      this.emitIntent({ kind: 'skill_finished', skillId: skill.id, timestamp: Date.now() });
      if (this.currentSkillId === skill.id) this.currentSkillId = null;
    }
  }

  /** Emit a structured intent event. Public so other modules can push too. */
  emitIntent(event: import('./types').IntentEvent): void {
    this.emitter.emit('intent', event);
    // Buffer into the current run so `exportAgentRun()` returns the full
    // sequence of decisions alongside the session turn log. We accept
    // anything emitted between `beginAgentRun` and the next one — that
    // includes confirm gates, ask_user answers, pause decisions, etc.
    if (this.currentRunId) this.currentRunIntents.push(event);
  }

  // ─── highlight (frame any DOM element) ──────────────────────────
  //
  // The same visual treatment Dwell uses for its long-press "pinned"
  // element — an outline with the accent color — exposed as a public
  // API so any caller can frame an element to draw the user's eye.
  //
  // Frame style is the same `[data-dddk-dwell-target]` outline defined
  // in dwell/styles.ts. We share the attribute on purpose: only one
  // element should be framed at a time, and Dwell's CSS already covers
  // theming via `--dddk-dwell-frame-*` CSS vars.

  private highlightedEl: HTMLElement | null = null;
  private highlightDismissTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Frame an element with the same outline Dwell uses on long-press.
   * Replaces any existing highlight (only one frame at a time).
   *
   * @returns true if the element was found and framed
   */
  highlightElement(
    target: string | HTMLElement,
    opts?: { autoDismiss?: number; scroll?: boolean },
  ): boolean {
    if (typeof document === 'undefined') return false;
    this.clearHighlight();
    ensureDwellStyles();
    // String input is treated as a CSS selector. The querySelector call
    // throws SyntaxError on invalid syntax (e.g. a bare numeric agent
    // index like "13") — swallow it instead of letting the pump die.
    // Callers that have a numeric index from the indexed DOM dump should
    // resolve via `WebAgent.resolveSelector(...)` first.
    let el: HTMLElement | null;
    if (typeof target === 'string') {
      try {
        el = document.querySelector<HTMLElement>(target);
      } catch {
        return false;
      }
    } else {
      el = target;
    }
    if (!el) return false;
    // Clear any pre-existing frame (Dwell pin, prior highlight) — we own
    // the attribute now.
    document
      .querySelectorAll('[data-dddk-dwell-target]')
      .forEach((n) => n.removeAttribute('data-dddk-dwell-target'));
    el.setAttribute('data-dddk-dwell-target', '');
    this.highlightedEl = el;
    if (opts?.scroll !== false) {
      // Position the element's TOP near the upper third of the viewport
      // (~18% from the top) rather than centering it. Centering pushes
      // long sections halfway off-screen and crops the title; pinning to
      // the very top hides any context above (heading / breadcrumb / nav).
      // 18% leaves room for site chrome + a bit of breathing space.
      try {
        const rect = el.getBoundingClientRect();
        const targetTop = Math.round(window.innerHeight * 0.18);
        const desiredScrollY = window.scrollY + rect.top - targetTop;
        window.scrollTo({ top: Math.max(0, desiredScrollY), behavior: 'smooth' });
      } catch { /* noop */ }
    }
    if (opts?.autoDismiss && opts.autoDismiss > 0) {
      this.highlightDismissTimer = setTimeout(() => this.clearHighlight(), opts.autoDismiss);
    }
    return true;
  }

  /** Remove any active highlight frame. */
  clearHighlight(): void {
    if (this.highlightDismissTimer) {
      clearTimeout(this.highlightDismissTimer);
      this.highlightDismissTimer = null;
    }
    if (this.highlightedEl) {
      this.highlightedEl.removeAttribute('data-dddk-dwell-target');
      this.highlightedEl = null;
    }
  }

  /**
   * Lazy-initialize the PanelRuntime. The runtime is a separate DOM overlay
   * from the regular CommandPalette — it handles `PanelSkill` execution
   * (top input + bottom panel + navigation stack).
   */
  private ensurePanelRuntime(): PanelRuntime {
    if (!this.panelRuntime) {
      this.panelRuntime = new PanelRuntime({
        host: {
          llm: this.config.llm
            ? async (prompt: string) => {
                const llm = this.config.llm;
                if (!llm) return '';
                const r = await (llm as { complete?: (p: string) => Promise<string> }).complete?.(prompt);
                return r ?? '';
              }
            : undefined,
          navigate: (path: string) => this.navigate(path),
          renderPiece: this.config.panelRenderPiece,
        },
      });
    }
    return this.panelRuntime;
  }

  /** Check whether a PanelSkill is currently active. */
  isPanelOpen(): boolean {
    return this.panelRuntime?.isOpen() ?? false;
  }

  /**
   * Programmatically fire `voice_start` — same event the long-press gesture
   * emits. Mobile FAB long-press, custom triggers (e.g. host's own header
   * button bound via `MobileTrigger.bindTrigger`), or any other entry point
   * can call this to enter voice mode without simulating keyboard events.
   */
  triggerVoiceStart(): void {
    if (!this.voiceEnabled) return;
    this.emitter.emit('voice_start', undefined);
  }

  /** Fire `voice_end` to match a prior `triggerVoiceStart`. */
  triggerVoiceEnd(): void {
    if (!this.voiceEnabled) return;
    this.emitter.emit('voice_end', { text: '' });
  }

  /** Programmatically close any active panel skill (Esc equivalent for host). */
  async closePanel(): Promise<void> {
    if (this.panelRuntime) await this.panelRuntime.close();
  }

  /**
   * Kick the webagent. `selection` defaults to whatever was captured at the
   * last palette open — pass `{ selection: null }` to force no selection
   * context, or pass an explicit `SelectionContext` to override.
   */
  startAgent(task: string, options: { selection?: SelectionContext | null } = {}): void {
    if (!this.config.llm) {
      this.subtitle.show({
        text: this.t('agent.no_webagent', 'No LLM configured — set `llm` on DotDotDuck.'),
        type: 'info',
        autoHide: 2500,
      });
      return;
    }
    if (!this.agentEnabled) {
      this.subtitle.show({
        text: this.t('agent.disabled', 'Agent is disabled.'),
        type: 'info',
        autoHide: 2000,
      });
      return;
    }
    if (!this.agentInstance) this.agentInstance = this.buildAgent();
    if (this.agentInstance.isRunning()) this.agentInstance.stop();
    // Wipe state from the previous round — borders / pin frames / subtitles
    // left over from a prior agent run shouldn't bleed into this one.
    // Without this the user sees stale "Agent · border(...)" pills and
    // outlines from the previous question still hanging around when they
    // start a new task.
    this.clearHighlight();
    clearWebagentOverlays();
    this.subtitle.hide();
    let selection =
      options.selection === undefined ? this.currentSelection : options.selection;

    // If no live window-selection is set but the palette has a pinned
    // context (Dwell-pinned element etc.), feed THAT into the agent's
    // SelectionContext so the agent knows which element the user is asking
    // about — without it the agent only sees the question + full DOM and
    // has to guess. We read from `pinnedContext` (sticky across palette
    // close) rather than `context.selectionText` (cleared on close) so this
    // still works when the handler ran `p.close()` before `startAgent`.
    if (!selection || (!selection.text && (!selection.elements || selection.elements.length === 0))) {
      const pinned = this.palette.pinnedContext;
      if (pinned.text || pinned.element) {
        selection = {
          ...(selection ?? {}),
          text: pinned.text || selection?.text,
          elements: pinned.element ? [pinned.element] : selection?.elements,
        };
      }
    }

    // Auto-attach images queued in the palette context (camera-captured PNGs)
    // as base64 data URLs in the agent's SelectionContext.images. webagent
    // already supports `images: string[]`. We also prepend a metadata note
    // to the task with each image's `sourceUrl` so the agent knows WHICH
    // page the screenshot is from — important when the user took the
    // screenshot on page A and then asks the question from page B.
    const queuedAttachments = this.palette.context.attachments.filter((a) => a.kind === 'image');
    if (queuedAttachments.length > 0) {
      void Promise.all(queuedAttachments.map((a) => blobToDataUrl(a.blob)))
        .then((images) => {
          const meta = queuedAttachments
            .map((a, i) => {
              const where = a.sourceUrl ? ` from ${a.sourceUrl}` : '';
              return `Image ${i + 1} (${a.source}${where})`;
            })
            .join('\n');
          const augmentedTask = meta
            ? `${task}\n\n[Attachments]\n${meta}`
            : task;
          const sel: SelectionContext = { ...(selection ?? {}), images };
          this.runAgentStream(augmentedTask, { selection: sel });
          this.emitter.emit('agent_start', { task: augmentedTask });
          // Clear once consumed — host can re-attach for next run.
          this.palette.clearAttachments();
        })
        .catch((err) => {
          // Image conversion failed — don't strand the agent. Fall back to
          // running the original task without attachments so the user still
          // gets a response. (Common cause: revoked Blob URL, OOM on giant
          // image, or FileReader denied by privacy policy.)
          console.warn('[dddk] failed to attach palette images, running without:', err);
          this.emitter.emit('agent_start', { task });
          this.runAgentStream(task, selection ? { selection } : {});
          this.palette.clearAttachments();
        });
      return;
    }

    this.emitter.emit('agent_start', { task });
    this.beginAgentRun(task);
    this.runAgentStream(task, selection ? { selection } : {});
  }

  private runAgentStream(task: string, opts: { selection?: SelectionContext } = {}): void {
    const agent = this.agentInstance;
    if (!agent) return;
    void this.pumpAgentStream(agent.runStream(task, opts));
  }

  // ─── per-run intent bookkeeping ─────────────────────────────────────
  //
  // A "run" is one user query and everything that follows it — narrations,
  // tool calls, confirms, pauses, until the loop ends (final / stopped).
  // We give it an id at start time and buffer every intent emitted while
  // it's active. Hosts call `exportAgentRun()` to get the whole thing
  // (session + intents) as one JSON blob.
  private currentRunId: string | null = null;
  private currentRunIntents: IntentEvent[] = [];
  /**
   * Active skill id while a skill is running. Set on skill_started and
   * cleared on skill_finished. Read by `renderLoopClosure` so the
   * `agent_feedback` IntentEvent can attribute satisfaction back to the
   * skill that triggered the run — enables per-skill quality breakdown
   * on the dashboard without after-the-fact time-window heuristics.
   */
  private currentSkillId: string | null = null;

  private beginAgentRun(task: string): void {
    this.currentRunId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.currentRunIntents = [];
    this.emitIntent({
      kind: 'agent_run_started',
      runId: this.currentRunId,
      task,
      sessionId: this.agentInstance?.getSession()?.id ?? '',
      timestamp: Date.now(),
    });
  }

  private endAgentRunCompleted(): void {
    if (!this.currentRunId) return;
    this.emitIntent({
      kind: 'agent_run_completed',
      runId: this.currentRunId,
      sessionId: this.agentInstance?.getSession()?.id ?? '',
      turnCount: this.agentInstance?.getSession()?.turns.length ?? 0,
      timestamp: Date.now(),
    });
    // Keep runId / intents around until next run starts so an
    // `exportAgentRun()` call right after the loop ends still works.
  }

  private endAgentRunStopped(reason: 'close' | 'esc' | 'reject' | 'palette' | 'voice' | 'unknown'): void {
    if (!this.currentRunId) return;
    this.emitIntent({
      kind: 'agent_run_stopped',
      runId: this.currentRunId,
      sessionId: this.agentInstance?.getSession()?.id ?? '',
      reason,
      timestamp: Date.now(),
    });
  }

  /**
   * Snapshot the current (or most-recent) agent run as a single JSON
   * blob — session turns + every intent emitted during the run. Useful
   * for shipping a complete query record to a dashboard / DB after the
   * loop ends. Returns `null` if no agent has ever run in this session.
   */
  exportAgentRun(): {
    runId: string;
    sessionId: string;
    session: AgentSession;
    intents: IntentEvent[];
    exportedAt: number;
  } | null {
    const session = this.agentInstance?.getSession();
    if (!session) return null;
    return {
      runId: this.currentRunId ?? '',
      sessionId: session.id,
      session: JSON.parse(JSON.stringify(session)) as AgentSession,
      intents: this.currentRunIntents.slice(),
      exportedAt: Date.now(),
    };
  }

  /** Resume a saved session — used by the host's onMount after a full
   *  page reload. If there's no saved session or it's in a terminal
   *  state, no-ops. Otherwise pumps the stream into the dddk UI as if
   *  the loop had never been interrupted. */
  resumeAgent(): void {
    if (!this.agentEnabled) return;
    if (!this.config.llm) return;
    if (!this.agentInstance) this.agentInstance = this.buildAgent();
    void this.pumpAgentStream(this.agentInstance.resumeStream());
  }

  /** Tell the agent that its continuity window should close now (used
   *  for `sessionScope: 'palette'` hosts when the palette closes). */
  endAgentContinuity(): void {
    this.agentInstance?.endContinuity();
  }

  /** Wipe any saved agent session — the next `runStream()` starts
   *  fresh. Hosts call this after a full page reload to drop an
   *  abandoned conversation from the previous load. */
  clearAgentSession(): void {
    this.agentInstance?.clearSession();
  }

  /** Stop a running agent and clear its on-screen UI. Safe to call
   *  when the agent is idle (no-ops). Use this when the host wants to
   *  cancel mid-task — e.g. the user clicked an in-app link / sidebar
   *  entry, signalling they're moving on regardless of where the
   *  agent thinks it is. */
  stopAgent(): void {
    this.handleUserStopAgent('close');
  }

  /**
   * Fire the same "accept" gesture that single-tap Space fires on
   * desktop — emits `gesture_accept`, advances script skills waiting
   * on it, advances streaming pause hints, accepts confirm dialogs,
   * etc. Use this from a mobile FAB tap or any host-built "next"
   * button so touch users get the full Space-equivalent pipeline,
   * not just `subtitle.invokeAccept()` (which alone misses script
   * skills + intent analytics).
   */
  triggerAccept(): void {
    this.emitter.emit('gesture_accept', undefined);
    this.subtitle.invokeAccept();
    this.emitIntent({ kind: 'agent_answered', answer: 'accept', via: 'gesture', timestamp: Date.now() });
  }

  /**
   * Fire the same "reject" gesture that double-tap Space fires on
   * desktop — emits `gesture_reject`, exits script skills, rejects
   * confirms, or stops an in-flight agent. Use this from a mobile
   * double-tap on the FAB / subtitle bar.
   */
  triggerReject(): void {
    this.emitter.emit('gesture_reject', undefined);
    const hadReject = this.subtitle.invokeReject();
    if (!hadReject) {
      if (this.agentInstance?.isRunning()) {
        this.handleUserStopAgent('reject');
      } else {
        this.subtitle.hide();
      }
    }
    this.emitIntent({ kind: 'agent_answered', answer: 'reject', via: 'gesture', timestamp: Date.now() });
  }

  /**
   * Cross-cutting "stop the agent now" handler. Reasons:
   *   - `close`: user clicked the × on the subtitle bar
   *   - `esc`: Escape key while agent was running
   *   - `palette`: user opened the command palette (which means they
   *     want to send a new prompt)
   *   - `reject`: user double-tapped Space to reject
   *   - `voice`: user long-pressed Space to start a new voice prompt
   *
   * Surfaces a brief "stopped — say something new" subtitle so the user
   * knows their gesture worked and the agent is safely halted. Skipped
   * if the agent wasn't running (avoids "stopped" flashing on idle).
   */
  private handleUserStopAgent(reason: 'close' | 'esc' | 'palette' | 'reject' | 'voice'): void {
    const agent = this.agentInstance;
    if (!agent || !agent.isRunning()) return;
    // Emit BEFORE stop so the run still has its runId and dashboards
    // see the cancellation cleanly. The Push goes into currentRunIntents
    // too via emitIntent, so exportAgentRun() returns it.
    this.endAgentRunStopped(reason);
    // `palette` / `voice` are interruptions that come WITH a new prompt
    // attached — the user wants to redirect mid-task, not abandon the
    // conversation. Soft-stop so the next runStream() appends as a
    // follow-up turn even when `sessionContinuityMs: 0`. Other reasons
    // (× / Esc / double-tap reject) are explicit abandons → hard stop.
    if (reason === 'palette' || reason === 'voice') {
      agent.interruptForFollowup();
    } else {
      agent.stop();
    }
    this.subtitle.clearStreamed();
    this.subtitle.hideIndicator();
    this.clearHighlight();
    clearWebagentOverlays();
    // Voice + palette have their own next UI (mic indicator / palette
    // open) — don't double-up with a stopped subtitle that immediately
    // gets replaced. Close / esc / reject show the feedback line.
    if (reason === 'voice' || reason === 'palette') return;
    const key = reason === 'close' ? 'agent.stop_close'
      : reason === 'esc' ? 'agent.stop_esc'
      : 'agent.stop_reject';
    this.subtitle.show({ text: sdkString(this.config.locale, key), type: 'info', autoHide: 2500 });
  }

  /** Runtime toggle for voice (hold-space STT gesture). */
  setVoiceEnabled(enabled: boolean): void {
    this.voiceEnabled = enabled;
  }

  isVoiceEnabled(): boolean {
    return this.voiceEnabled;
  }

  /**
   * Runtime toggle for the DOM-grounded agent loop. When `false`,
   * `startAgent()` no-ops with a subtitle hint, palette plain-text Enter
   * does NOT fire the agent, and any in-flight run stops cleanly. Other
   * subsystems that use the LLM router (inline AI, voice cleanup, …)
   * keep working.
   */
  setAgentEnabled(enabled: boolean): void {
    this.agentEnabled = enabled;
    if (!enabled && this.agentInstance?.isRunning()) {
      this.agentInstance.stop();
    }
  }

  isAgentEnabled(): boolean {
    return this.agentEnabled;
  }

  /** Access the underlying WebAgent (null until first startAgent call). */
  getAgent(): WebAgent | null {
    return this.agentInstance;
  }

  /** Forward a user response to the agent (for ask_user / surface form submits). */
  respondToAgent(answer: string | Record<string, unknown>): void {
    this.agentInstance?.respond(answer);
  }

  /**
   * Called by host after the user submits a preferences setup surface.
   * Persists the values and resumes the skill that triggered it.
   */
  submitPreferences(values: Record<string, unknown>): void {
    if (!this.pendingPrefs) return;
    this.prefs.write(this.pendingPrefs.skillId, values);
    this.pendingPrefs.resolve();
  }

  cancelPreferences(): void {
    this.pendingPrefs?.reject();
  }

  // ─── webagent integration ──────────────────────────────────────

  /** Read a host-supplied indicator label override (`config.indicators
   *  .processing` / `.listening`). Accepts string or per-locale map. */
  private resolveIndicatorOverride(kind: 'processing' | 'listening'): string | null {
    const v = this.config.indicators?.[kind];
    if (!v) return null;
    if (typeof v === 'string') return v;
    return v[String(this.config.locale ?? 'en')] ?? v.en ?? null;
  }

  /** Pull the auto-hide ms for agent summary / error subtitles out of
   *  config. Returns 0 (sticky) when the host didn't configure it. */
  private resolveAgentAutoHide(kind: 'summary' | 'error'): number {
    const v = this.config.agentSubtitleAutoHideMs;
    if (v === undefined) return 0;
    if (typeof v === 'number') return v;
    return v[kind] ?? 0;
  }

  private buildAgent(): WebAgent {
    // Collect opted-in palette commands → expose as webagent custom actions.
    const paletteTools = this.collectPaletteTools();
    // Host-registered tools via `dddk.tools.register(...)` / `registerQA(...)`.
    // Snapshot is one-shot for the initial customActions set; tools registered
    // AFTER buildAgent() runs land via `this.tools.attachAgent(agent)` below.
    const hostTools = this.tools.snapshot();

    const agent = new WebAgent({
      ...this.config.webAgent,
      llm: this.config.llm!,
      locale: this.config.locale ?? this.config.webAgent?.locale,
      agentName: this.config.agentName ?? this.config.webAgent?.agentName,
      siteName: this.config.siteName ?? this.config.webAgent?.siteName,
      customActions: [
        ...(this.config.webAgent?.customActions ?? []),
        ...paletteTools,
        ...hostTools,
      ],
    });

    // Host router bridge — webagent emits `navigated` events; this
    // callback also drives the SPA goto (the agent's own code calls
    // this BEFORE the SPA settle window).
    agent.setNavigateBridge((path: string) => this.navigate(path));

    // ask_user / ask_user_choice are dispatched via the action handler;
    // the handler calls back into these to render the host UI.
    agent.setAskUserHandler(({ question, resolve }) => {
      this.emitIntent({ kind: 'agent_asked', question, timestamp: Date.now() });
      this.subtitle.show({
        text: question,
        type: 'agent',
        onAccept: () => {
          this.emitIntent({ kind: 'agent_answered', question, answer: 'yes', via: 'gesture', timestamp: Date.now() });
          resolve('yes');
        },
        onReject: () => {
          this.emitIntent({ kind: 'agent_answered', question, answer: 'no', via: 'gesture', timestamp: Date.now() });
          resolve('no');
        },
        onCancel: () => resolve(''),
      });
    });

    agent.setAskUserChoiceHandler(({ question, options, allowFreeText, resolve }) => {
      this.emitIntent({ kind: 'agent_asked', question, timestamp: Date.now() });
      this.subtitle.showChoice({
        question,
        options,
        allowFreeText,
        onChoose: (value, index) => {
          this.emitIntent({
            kind: 'agent_answered',
            question,
            answer: value,
            via: index === -1 ? 'text' : 'gesture',
            timestamp: Date.now(),
          });
          resolve(value);
        },
        onCancel: () => resolve(''),
      });
    });

    // `pause` is the narrator's mid-stream beat. We DON'T spawn a
    // separate prompt subtitle — that would wipe the text the agent
    // just streamed. Instead, attach a "press space to continue" hint
    // to the existing streaming bar so the text remains visible while
    // the user reads. If for some reason there's no streaming bar
    // active (e.g. agent called pause as its first action), fall back
    // to a regular ask_user-style prompt so the gesture still works.
    agent.setPauseHandler(({ hint, resolve }) => {
      const emitPauseDecision = (decision: 'continue' | 'stop'): void => {
        if (!this.currentRunId) return;
        this.emitIntent({
          kind: 'agent_pause_decision',
          runId: this.currentRunId,
          decision,
          timestamp: Date.now(),
        });
      };
      if (this.subtitle.isStreaming()) {
        this.subtitle.applyStreamingPauseHint({
          hint,
          onAccept: () => {
            // Wipe the streamed text so the NEXT subject starts in a
            // clean bar. Each subject in the walkthrough is its own
            // paragraph; accumulating across subjects makes the bar
            // read as one tangled wall-of-text. (The streaming bar el
            // itself stays mounted so the next text-delta appends
            // smoothly with no visible flicker.)
            this.subtitle.replaceStreamed('');
            emitPauseDecision('continue');
            resolve('continue');
          },
          onReject: () => {
            emitPauseDecision('stop');
            resolve('');
            this.handleUserStopAgent('reject');
          },
        });
      } else {
        // No streaming bar — fall back to the regular agent prompt.
        this.subtitle.show({
          text: hint,
          type: 'agent',
          onAccept: () => { emitPauseDecision('continue'); resolve('continue'); },
          onReject: () => {
            emitPauseDecision('stop');
            resolve('');
            this.handleUserStopAgent('reject');
          },
          onCancel: () => resolve(''),
        });
      }
    });

    // Attach the live agent to the tools registry so any future
    // `dddk.tools.register(...)` calls flow into this running agent
    // immediately, not just into the snapshot at build time.
    this.tools.attachAgent(agent);

    return agent;
  }

  // ─── agent event pump ──────────────────────────────────────────
  /**
   * Consume the agent's AsyncIterable<AgentEvent> stream and route each
   * event to its dddk UI slot:
   *
   *   thinking     → showIndicator('processing')
   *   text-delta   → subtitle.appendStreamed(delta) (cancels the indicator)
   *   tool-start   → frame target element, hide indicator
   *   tool-end     → no-op (next text-delta or next tool-start carries the visual)
   *   confirm      → subtitle.show with onAccept / onReject calling decide()
   *   navigated    → clear overlays (the bridge already moved the router)
   *   final        → finalizeStreamed with autoHide
   *   error        → subtitle.show error
   *
   * The async `for await` loop runs in the background — the host's
   * `startAgent()` returns synchronously, and event handlers on the
   * orchestrator (gestures, palette, voice) keep firing throughout.
   */
  private async pumpAgentStream(stream: AsyncIterable<AgentEvent>): Promise<void> {
    const thinkingLabel =
      this.resolveIndicatorOverride('processing')
      ?? sdkString(this.config.locale, 'agent.thinking');
    const finalAutoHide = this.resolveAgentAutoHide('summary');

    // Universal "agent is no longer running" cleanup. Fires on:
    //   - natural completion (final / error)
    //   - exception inside the pump
    //   - external `agent.stop()` (stream exits with signal aborted)
    //   - any other path that ends the for-await
    // Symptom we're guarding against: thinking indicator camping on
    // screen after the agent halted via click-outside / palette open /
    // long-press voice / esc. ANY stop reason should clear it.
    const safeCleanup = (): void => {
      this.subtitle.hideIndicator();
      this.clearHighlight();
      clearWebagentOverlays();
    };

    try {
      for await (const ev of stream) {
        switch (ev.kind) {
          case 'thinking':
            if (!this.subtitle.isStreaming()) {
              this.subtitle.showIndicator('processing', thinkingLabel);
            }
            this.emitter.emit('agent_thinking', undefined);
            break;

          case 'text-delta':
            this.subtitle.appendStreamed(ev.delta);
            break;

          case 'tool-start':
            this.subtitle.hideIndicator();
            if (ev.targetSelector) {
              // Resolve numeric `[N]` indexes via the agent's per-turn
              // map before falling through to CSS selector matching.
              // Without this, the LLM passing a bare "13" would crash
              // querySelector with SyntaxError.
              const resolved = this.agentInstance?.resolveSelector(ev.targetSelector);
              if (resolved) this.highlightElement(resolved as HTMLElement);
              else this.highlightElement(ev.targetSelector);
            }
            this.emitter.emit('agent_tool_start', { name: ev.name, args: ev.args, targetSelector: ev.targetSelector });
            break;

          case 'tool-end':
            this.emitter.emit('agent_tool_end', { name: ev.name, result: ev.result });
            break;

          case 'navigating':
            // SPA route change kicked off but the new page isn't ready
            // to read yet — show a polished loading indicator until
            // `navigated` arrives.
            this.subtitle.showIndicator('processing', sdkString(this.config.locale, 'agent.loading'));
            clearWebagentOverlays();
            this.clearHighlight();
            break;

          case 'navigated':
            // New page settled. Hide the loading indicator; the next
            // text-delta from the model will create the streaming bar
            // for narration about the new page.
            this.subtitle.hideIndicator();
            break;

          case 'confirm':
            await this.routeConfirm(ev);
            break;

          case 'final':
            // Close the streamed narration first, then render the
            // host-configured loop-closure (text / feedback / ask_user
            // / silent). Without this the bar just disappears, which
            // reads as a broken UI rather than a finished run.
            this.subtitle.finalizeStreamed(
              finalAutoHide > 0 ? { autoHide: finalAutoHide } : {},
            );
            this.clearHighlight();
            clearWebagentOverlays();
            this.emitter.emit('agent_final', undefined);
            await this.renderLoopClosure();
            this.endAgentRunCompleted();
            break;

          case 'error':
            this.subtitle.hideIndicator();
            if (!ev.retrying) {
              const errMsg = this.config.locale === 'zh-TW'
                ? `出了點問題：${ev.error.message}`
                : `Something went wrong: ${ev.error.message}`;
              if (this.subtitle.isStreaming()) {
                this.subtitle.appendStreamed('\n\n' + errMsg);
                this.subtitle.finalizeStreamed({ autoHide: 6_000 });
              } else {
                this.subtitle.show({ text: errMsg, type: 'info', autoHide: 6_000 });
              }
              this.clearHighlight();
              clearWebagentOverlays();
              this.emitter.emit('agent_error', { error: ev.error });
            }
            break;
        }
      }
    } catch (err) {
      // Pump itself threw (shouldn't normally — agent catches its own
      // errors and emits `error` events). Defensive cleanup.
      if (this.subtitle.isStreaming()) {
        this.subtitle.finalizeStreamed({ autoHide: 4_000 });
      }
      safeCleanup();
      if (typeof console !== 'undefined') {
        console.warn('[dddk] agent pump threw:', err);
      }
    } finally {
      // Always-fires cleanup. Handles the "stream ended without firing
      // a terminal event" case — most commonly when an external
      // `agent.stop()` (via close button, esc, palette open,
      // long-press voice) aborts the loop mid-flight. Without this
      // hook the thinking indicator stayed up forever.
      safeCleanup();
    }
  }

  /**
   * Resolve the active `onLoopEnd` config — host override, or the SDK
   * default of a temperate "✓ Done" line. Returning `{kind: 'silent'}`
   * means legacy "subtitle disappears" behaviour.
   */
  private resolveLoopEnd(): OnLoopEnd {
    const hostCfg = this.config.webAgent?.onLoopEnd;
    if (hostCfg) return hostCfg;
    return {
      kind: 'text',
      text: sdkString(this.config.locale, 'agent.done'),
      autoHide: 3000,
    };
  }

  /**
   * Render the configured loop closure when the agent loop ends. Sits
   * between `finalizeStreamed` and `endAgentRunCompleted` in
   * pumpAgentStream.
   *
   * Each kind maps onto an existing subtitle surface:
   *   text     → subtitle.show with autoHide; no gesture wiring.
   *   feedback → subtitle.show with onAccept/onReject/onCancel, emits
   *              `agent_feedback` with satisfied = true / false / null.
   *   ask_user → subtitle.showChoice; the picked value flows into
   *              `agent_feedback.summary`.
   *   silent   → no-op; legacy "subtitle disappears" behavior.
   */
  private async renderLoopClosure(): Promise<void> {
    const closure = this.resolveLoopEnd();
    if (closure.kind === 'silent') return;

    if (closure.kind === 'text') {
      const autoHide = closure.autoHide ?? 3000;
      this.subtitle.show({
        text: closure.text,
        type: 'agent',
        autoHide,
      });
      // Don't block endAgentRunCompleted on the autoHide window — the
      // run is logically complete already; the subtitle just dwells.
      return;
    }

    // Snapshot the run + skill at closure render time. Both are stored
    // on every agent_feedback IntentEvent so the dashboard can roll up
    // satisfaction by run or by skill without time-window heuristics.
    const runId = this.currentRunId ?? undefined;
    const skillId = this.currentSkillId ?? undefined;

    if (closure.kind === 'feedback') {
      const now = (): number => Date.now();
      // `persistent: true` removes every passive dismiss path — × close
      // button hidden, Esc ignored, outside-click / any-key ignored.
      // The bar can only close via Space (accept), double-tap (reject),
      // or click on the ✓ / ✕ buttons. Trade-off: visitor can't skip the
      // prompt, but we always get a labelled satisfied/not-satisfied
      // signal — that's the whole point of opting into feedback mode.
      await new Promise<void>((resolve) => {
        const close = (satisfied: boolean): void => {
          this.emitIntent({ kind: 'agent_feedback', runId, skillId, satisfied, summary: closure.text, timestamp: now() });
          // Tear the bar down — accept / reject callbacks don't go through
          // the gesture-manager `invokeAccept` path that normally hides
          // the subtitle, so we hide it here. Without this the bar stays
          // visible after the click and the user thinks ✓ / ✕ didn't fire.
          this.subtitle.hide();
          resolve();
        };
        this.subtitle.show({
          text: closure.text,
          type: 'agent',
          persistent: true,
          onAccept: () => close(true),
          onReject: () => close(false),
        });
      });
      return;
    }

    // ask_user — picker with the host's options. Picked value goes
    // into the agent_feedback intent so dashboards can break down
    // satisfaction by chosen bucket.
    const optionLabels = closure.options.map((o) => o.label);
    await new Promise<void>((resolve) => {
      this.subtitle.showChoice({
        question: closure.question,
        options: optionLabels,
        allowFreeText: false,
        onChoose: (value, index) => {
          const picked = closure.options[index];
          this.emitIntent({
            kind: 'agent_feedback',
            runId,
            skillId,
            satisfied: null,
            summary: picked?.value ?? value,
            timestamp: Date.now(),
          });
          resolve();
        },
        onCancel: () => {
          this.emitIntent({ kind: 'agent_feedback', runId, skillId, satisfied: null, summary: '', timestamp: Date.now() });
          resolve();
        },
      });
    });
  }

  /**
   * Route a `confirm` event to the subtitle bar with Space-accept /
   * double-tap-reject wiring. The agent is awaiting `decide()` — we
   * resolve it from the user's gesture.
   */
  private async routeConfirm(ev: Extract<AgentEvent, { kind: 'confirm' }>): Promise<void> {
    const targetSelector =
      (typeof ev.args.selector === 'string' ? ev.args.selector : null) ??
      (typeof ev.args.target === 'string' ? ev.args.target : null) ??
      (typeof ev.args.element === 'string' ? ev.args.element : null);
    if (targetSelector) {
      const resolved = this.agentInstance?.resolveSelector(targetSelector);
      if (resolved) this.highlightElement(resolved as HTMLElement);
      else this.highlightElement(targetSelector);
    } else {
      this.clearHighlight();
    }

    await new Promise<void>((resolve) => {
      this.subtitle.show({
        text: ev.message,
        type: 'agent',
        onAccept: () => {
          this.emitIntent({ kind: 'confirm_action', actionName: ev.actionName, params: ev.args, approved: true, timestamp: Date.now() });
          ev.decide(true);
          resolve();
        },
        onReject: () => {
          this.emitIntent({ kind: 'confirm_action', actionName: ev.actionName, params: ev.args, approved: false, timestamp: Date.now() });
          this.clearHighlight();
          ev.decide(false);
          resolve();
        },
        onCancel: () => {
          this.clearHighlight();
          ev.decide(false);
          resolve();
        },
      });
    });
  }

  /**
   * Collect palette commands that have opted into agent exposure
   * (via `agentTool: {...}`), turn them into WebAgent customActions.
   */
  private collectPaletteTools(): NonNullable<WebAgentConfig['customActions']> {
    const tools: NonNullable<WebAgentConfig['customActions']> = [];

    // Per-item exposure — items the host opted into via `agentTool: {...}`
    // become their own named agent tools. Same shape as before.
    for (const item of this.palette.getItems()) {
      if (!item.agentTool || !item.handler) continue;
      tools.push({
        name: this.toolNameOf(item),
        description: item.agentTool.description,
        parameters: item.agentTool.parameters,
        requireConfirmation: item.agentTool.requireConfirmation,
        handler: async (params) => {
          const arg = (params as { arg?: string }).arg ?? '';
          try {
            // Reuse the palette item's handler — agent sees same result host expected
            await item.handler!({
              close: () => {},
              replace: () => {},
              get input() { return ''; },
              setInput: () => {},
              get context() {
                return { selectionText: '', attachments: [] };
              },
              showResult: () => {},
              clearResult: () => {},
              setInputContext: () => {},
              clearInputContext: () => {},
            }, arg);
            return { ok: true };
          } catch (err) {
            return { ok: false, reason: 'unknown' as const, message: (err as Error).message };
          }
        },
      });
    }

    // `open_palette` was previously registered here as a generic "show
    // the UI and let the agent click into it" tool. Removed in v0.1.0+:
    // multi-step UI navigation (open → click row → click sub-menu) is
    // unreliable on small models. Hosts that want the agent to invoke a
    // palette command now register semantic intent tools instead — e.g.
    // `immersive_translate({language})`, `start_site_tour()`,
    // `search_docs({query})`. The host's tool handler drives the palette
    // UI animation if visual feedback is desired. See
    // `dddk-frontend/src/lib/agent-tools.ts` for the reference pattern.

    return tools;
  }

  /** Normalize palette id → safe action name (a-z0-9_). */
  private toolNameOf(item: PaletteItem): string {
    return `palette_${item.id.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`;
  }

  // ─── helpers ────────────────────────────────────────────────────

  private async runScriptSkill(skill: ScriptSkill): Promise<void> {
    let i = 0;
    for (const step of skill.steps) {
      this.emitter.emit('skill_step', { skillId: skill.id, stepIndex: i });

      if (step.page) this.navigate(step.page);
      if (step.subtitle) {
        this.subtitle.show({ text: step.subtitle, type: 'agent' });
      }
      if (step.action) {
        await step.action(this.buildSkillTools());
      }
      if (step.waitForUser !== false) {
        const outcome = await this.waitForAcceptOrEscape();
        // Esc OR double-tap space both exit the tour early — double-tap
        // is the canonical "no/dismiss" gesture and should behave like Esc.
        if (outcome !== 'accept') {
          this.subtitle.hide();
          this.clearHighlight();
          break;
        }
      }
      this.subtitle.hide();
      i++;
    }
  }

  /**
   * Resolves on the next user gesture:
   *   - `'accept'`  → single space tap or accept-button click
   *   - `'escape'`  → Esc key
   *   - `'reject'`  → double space tap (treated as exit by ScriptSkill)
   *
   * Callers can branch on the outcome to advance vs. bail out of a
   * multi-step flow.
   */
  private waitForAcceptOrEscape(): Promise<'accept' | 'escape' | 'reject'> {
    return new Promise((resolve) => {
      const cleanup = () => {
        this.off('gesture_accept', onAccept);
        this.off('gesture_escape', onEsc);
        this.off('gesture_reject', onReject);
      };
      const onAccept = () => { cleanup(); resolve('accept'); };
      const onEsc    = () => { cleanup(); resolve('escape'); };
      const onReject = () => { cleanup(); resolve('reject'); };
      this.on('gesture_accept', onAccept);
      this.on('gesture_escape', onEsc);
      this.on('gesture_reject', onReject);
    });
  }

  private buildSkillTools(): import('./skills/types').SkillTools {
    return {
      navigate: (path) => this.navigate(path),
      // All three overlay primitives map to the same Dwell-style frame —
      // visual consistency with long-press selection. `color` / `label`
      // params are accepted but currently ignored; the frame is themed via
      // `--dddk-dwell-frame-*` CSS vars on the host.
      highlight: (selector) => { this.highlightElement(selector); return selector; },
      border:    (selector) => { this.highlightElement(selector); return selector; },
      spotlight: (selector) => { this.highlightElement(selector); return selector; },
      inject: () => '',
      subtitle: (text) => this.subtitle.show({ text, type: 'agent' }),
      clearOverlays: () => this.clearHighlight(),
      ask: async () => '',
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
      surface: (surface, opts) => this.showSurfaceAndAwait(surface, opts?.placement ?? 'modal'),
    };
  }

  /**
   * Show a Surface and await the host's submission. Used by skill tools and
   * any host code that wants the same "emit → user fills → resolve" pattern.
   */
  showSurfaceAndAwait(
    surface: unknown,
    placement: import('./skills/types').SurfacePlacement = 'modal',
  ): Promise<Record<string, unknown> | null> {
    // If something is already pending, cancel it before starting a new one —
    // surfaces are modal-ish; two at once would deadlock the script.
    if (this.pendingSurface) {
      this.pendingSurface.resolve(null);
      this.pendingSurface = null;
    }
    return new Promise((resolve) => {
      this.pendingSurface = {
        resolve: (data) => {
          this.pendingSurface = null;
          resolve(data);
        },
      };
      this.emitter.emit('surface', { surface, placement });
    });
  }

  /**
   * Host calls this when the user submits the active Surface form. Routes
   * to whichever subsystem opened the surface:
   *   - If a ScriptSkill called `tools.surface(...)` → resolves that promise
   *   - If webagent was awaiting a host interaction → resumes the agent loop
   * (Both can be pending at once in theory — we resolve both for safety.)
   */
  submitSurface(data: Record<string, unknown>): void {
    if (this.pendingSurface) {
      this.pendingSurface.resolve(data);
    }
    this.agentInstance?.respond(data);
  }

  /** Host calls this when the user cancels the Surface (Esc / backdrop click). */
  cancelSurface(): void {
    if (this.pendingSurface) {
      this.pendingSurface.resolve(null);
    }
    // Tell webagent the user cancelled — it gets an empty answer.
    this.agentInstance?.respond('');
  }

  private buildActionContext(skillId?: string): import('./skills/types').ActionSkillContext {
    const self = this;
    return {
      getPreferences<T = Record<string, unknown>>(): T {
        if (!skillId) return {} as T;
        return self.prefs.read(skillId) as T;
      },
      palette: {
        close: () => this.palette.close(),
        replace: (items) =>
          this.palette.setItems(items.map((i) => ({ id: i.id, name: i.name, handler: i.handler }))),
      },
      subtitle: {
        show: (opts) =>
          this.subtitle.show({
            text: opts.text,
            type: (opts.type as never) ?? 'info',
            autoHide: opts.autoHide,
          }),
        hide: () => this.subtitle.hide(),
      },
      storage: {
        get: <T,>(key: string) => {
          const raw = this.storage.get(key);
          if (raw == null) return null;
          const s = raw as string;
          try {
            return JSON.parse(s) as T;
          } catch {
            return s as unknown as T;
          }
        },
        set: (key, value) => {
          this.storage.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        },
      },
      agent: (task) => this.startAgent(task),
      navigate: (path) => this.navigate(path),
    };
  }

  private buildPaletteItems(): PaletteItem[] {
    const items: PaletteItem[] = [];

    for (const skill of this.skills.list()) {
      // Skills marked `hidden: true` are still callable (host can fire
      // them via `dddk.runSkill(id)` or wire their own palette items
      // pointing at them), but they don't auto-appear in the default
      // "Skills" section. Use this when you want explicit control over
      // section / placement / labelling in the palette.
      if (skill.hidden) continue;
      // If skill.name already looks like `/command`, use it as-is to avoid
      // duplication ("/introduce — /introduce"). Otherwise prefix `/<id>` so
      // the palette can route the slash command, and append name for context.
      const looksLikeSlashCommand = skill.name.trim().startsWith('/');
      const displayName = looksLikeSlashCommand
        ? skill.name
        : `/${skill.id} — ${skill.name}`;
      items.push({
        id: skill.id,
        name: displayName,
        description: skill.description,
        section: 'Skills',
        // No `icon` field — skills are intentionally rendered without icons
        // in the palette (host-defined PaletteItems can opt in via their own
        // `icon` field; skills stay neutral so they read as text actions).
        handler: (h) => {
          h.close();
          this.runSkill(skill.id);
        },
      });
    }

    for (const cmd of this.config.paletteCommands ?? []) {
      items.push(cmd);
    }

    return items;
  }

  private navigate(path: string): void {
    if (this.config.onNavigate) this.config.onNavigate(path);
    else if (typeof location !== 'undefined') location.assign(path);
  }

  /**
   * Capture rich selection context from the current Window.Selection plus
   * spotter's lock state. Best-effort — missing bits stay undefined.
   */
  private captureSelection(text: string): SelectionContext {
    const ctx: SelectionContext = { text };
    if (typeof window === 'undefined') return ctx;
    const sel = window.getSelection?.();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect?.();
      if (rect && (rect.width || rect.height)) {
        ctx.bbox = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
    }
    return ctx;
  }

  private t(key: string, fallback: string): string {
    const dict = this.config.i18n?.[this.config.locale ?? 'en'];
    return dict?.[key] ?? fallback;
  }
}

// ─── helpers ────────────────────────────────────────────────────────


/**
 * Render a webagent before_action payload into a one-line subtitle label.
 *
 * Goal: enough information that the user can tell what's about to happen
 * (`click ".submit-btn"`, `navigate /docs`, `scroll_to #pricing`) without
 * being a noisy debug dump. Long params get truncated; the target selector
 * is preferred over `params.selector` because the agent's "extractTargetSelector"
 * already picked the most user-meaningful one.
 */
function formatActionForSubtitle(
  actionName: string,
  params: Record<string, unknown>,
  targetSelector?: string,
): string {
  const targetSel = targetSelector ?? (typeof params.selector === 'string' ? params.selector : '');
  const path   = typeof params.path  === 'string' ? params.path  : '';
  const url    = typeof params.url   === 'string' ? params.url   : '';
  const text   = typeof params.text  === 'string' ? params.text  : '';
  const value  = typeof params.value === 'string' ? params.value : '';
  const trim = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  // For element-targeting actions, prefer the element's visible text
  // (aria-label / innerText) over the raw CSS selector. Users seeing
  // `Agent · border(section:nth-child(5))` learn nothing; they want
  // `Agent · border(「Inline AI demo」)`.
  const targetLabel = targetSel ? describeElementForSubtitle(targetSel) ?? trim(targetSel) : '';

  const detail =
      path        ? trim(path)
    : url         ? trim(url)
    : targetLabel ? targetLabel
    : value       ? `"${trim(value, 32)}"`
    : text        ? `"${trim(text, 32)}"`
    : '';
  return detail ? `Agent · ${actionName}(${detail})` : `Agent · ${actionName}`;
}

/**
 * Query a CSS selector and return the element's visible label
 * (`aria-label` / `title` / `innerText`) wrapped in 「」. Falls back to
 * `null` if nothing meaningful is found — caller uses the raw selector.
 */
function describeElementForSubtitle(selector: string): string | null {
  if (typeof document === 'undefined') return null;
  let el: Element | null = null;
  try { el = document.querySelector(selector); } catch { return null; }
  if (!el) return null;
  const aria = el.getAttribute('aria-label') ?? el.getAttribute('title');
  if (aria && aria.trim()) return `「${truncateLabel(aria.trim(), 28)}」`;
  const text = (el as HTMLElement).innerText?.trim() ?? el.textContent?.trim();
  if (text) return `「${truncateLabel(text, 28)}」`;
  return null;
}

function truncateLabel(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Browser-side: read a Blob into a base64 data URL so it can ride in a
 *  prompt as `selection.images[]`. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function defaultStorage(): StorageAdapter {
  return {
    get: (k) => (typeof localStorage !== 'undefined' ? localStorage.getItem(`dddk.${k}`) : null),
    set: (k, v) => {
      if (typeof localStorage !== 'undefined') localStorage.setItem(`dddk.${k}`, v);
    },
    remove: (k) => {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(`dddk.${k}`);
    },
  };
}

/**
 * Walk the current page's visible DOM text and return up to 20 hits whose
 * trimmed text content contains `q` (case-insensitive). Exported so hosts
 * can wire it into a `#`-prefix browse() — typing `#<query>` searches the
 * page in front of the user, distinct from `docs:` (full-text search across
 * the docs corpus).
 */
export function searchPageText(q: string): Array<{ text: string; element: HTMLElement }> {
  if (typeof document === 'undefined' || !q.trim()) return [];
  const out: Array<{ text: string; element: HTMLElement }> = [];
  const needle = q.toLowerCase();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = (node.textContent ?? '').trim();
    if (text.toLowerCase().includes(needle)) {
      const el = node.parentElement;
      if (el && el.offsetParent !== null) {
        out.push({ text: text.slice(0, 80), element: el });
        if (out.length >= 20) break;
      }
    }
  }
  return out;
}
