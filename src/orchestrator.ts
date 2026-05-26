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
  type AgentSession,
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
} from './types';

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

  /** Host route navigation callback (for SPA-friendly nav). */
  onNavigate?: (path: string) => void;

  /** Override gesture key (legacy 'ctrl' for migration). Default 'space'. */
  gestureKey?: 'space' | 'ctrl';

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
   * Auto-hide policy for SDK-emitted agent summary / error subtitles
   * (the ones the orchestrator's built-in `agent.on('done')` and
   * `agent.on('error')` handlers surface). Pass:
   *  - `0` or omit (default) — sticky; user dismisses on their own pace
   *  - milliseconds — auto-hide after this many ms
   *
   * Hosts that want different behaviour per type (e.g. error sticky,
   * summary auto-hide) pass an object. Hosts that subscribe to the
   * underlying agent events themselves and render their own subtitle
   * can skip this entirely.
   */
  agentSubtitleAutoHideMs?: number | { summary?: number; error?: number };

  /**
   * Force every SDK-emitted agent subtitle (done summary / error) into
   * a Space-gated `agent` bar with accept / reject buttons. Default
   * `false` — done summary uses plain `info` (any-key dismiss, no
   * satisfaction signal).
   *
   * Set `true` when you want:
   *  1. **Explicit dismiss** — no accidental dismissal, the user has
   *     to press Space (accept) or double-tap Space (reject).
   *  2. **Satisfaction signal** — accept / reject emits an
   *     `agent_feedback` intent (`satisfied: true | false | null`)
   *     so the host can measure agent quality from the intent stream.
   *  3. **Continuity hook** — onAccept becomes the natural place to
   *     queue the next agent turn (e.g. "ask a follow-up").
   *
   * Per the dddk-frontend's demo guidance: prefer gated subtitles
   * over silent text. The SDK keeps the plain-text path available
   * for embedded / dashboard contexts where Space isn't reachable.
   */
  gateAgentSubtitles?: boolean;
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
    this.storage = config.storage ?? defaultStorage();
    this.prefs = new PreferenceStore(this.storage, this.config.locale);
    this.voiceEnabled = config.voice?.enabled ?? true;
    this.agentEnabled = config.agent?.enabled ?? true;

    this.palette = new CommandPalette({
      initialItems: this.buildPaletteItems(),
      placeholder: this.t('palette.placeholder', 'Search commands or page…'),
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
        // Double-tap Space is the canonical "no / dismiss" gesture. We
        // fire onReject (so analytics differentiate yes from no) AND
        // auto-hide if no reject handler was registered (info subtitles
        // with no real "no" semantic — they just need to go away).
        const hadReject = this.subtitle.invokeReject();
        if (!hadReject) this.subtitle.hide();
        this.emitIntent({ kind: 'agent_answered', answer: 'reject', via: 'gesture', timestamp: Date.now() });
      },
      onAcceptLine: () => {
        this.emitter.emit('gesture_accept', undefined);
        this.subtitle.invokeAccept();
      },
      onVoiceStart: () => {
        if (!this.voiceEnabled) return;
        this.emitter.emit('voice_start', undefined);
      },
      onVoiceEnd: () => {
        if (!this.voiceEnabled) return;
        this.emitter.emit('voice_end', { text: '' });
      },
      onPaletteToggle: (selection) => {
        this.currentSelection = selection ? this.captureSelection(selection) : null;
        this.emitter.emit('palette_open', { selection });
        this.palette.toggle(selection);
      },
      onEscape: () => {
        this.emitter.emit('gesture_escape', undefined);
        // Esc closes palette / unlocks spotter only. Subtitles are
        // dismissed via double-tap Space (routes through onReject →
        // both the reject callback and the dismiss happen), or via
        // click / any-key for info-type subtitles.
        this.palette.close();
        this.spotter.unlock();
      },
    };

    this.gestures = new GestureManager({
      callbacks,
      gestureKey: this.config.gestureKey,
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
    }
  }

  /** Emit a structured intent event. Public so other modules can push too. */
  emitIntent(event: import('./types').IntentEvent): void {
    this.emitter.emit('intent', event);
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
    const el = typeof target === 'string'
      ? document.querySelector<HTMLElement>(target)
      : target;
    if (!el) return false;
    // Clear any pre-existing frame (Dwell pin, prior highlight) — we own
    // the attribute now.
    document
      .querySelectorAll('[data-dddk-dwell-target]')
      .forEach((n) => n.removeAttribute('data-dddk-dwell-target'));
    el.setAttribute('data-dddk-dwell-target', '');
    this.highlightedEl = el;
    if (opts?.scroll !== false) {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* noop */ }
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
                // Use the simplest interface: feed the prompt as a single user turn.
                const r = await (llm as { complete?: (p: string) => Promise<string> }).complete?.(prompt);
                return r ?? '';
              }
            : undefined,
          navigate: (path: string) => this.navigate(path),
          renderPiece: undefined,
          // Hosts that want richer rendering can swap in their own PieceRenderer-backed
          // implementation by listening to `panel_render` and rendering themselves —
          // see docs/toolbox/06-proactive.md for the same pattern via surface events.
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
          this.agentInstance?.run(augmentedTask, { selection: sel });
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
          this.agentInstance?.run(task, selection ? { selection } : {});
          this.palette.clearAttachments();
        });
      return;
    }

    this.emitter.emit('agent_start', { task });
    this.agentInstance.run(task, selection ? { selection } : {});
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
    // This is the "palette as agent tool" mechanism. Items are exposed only
    // if they declare `agentTool: {...}` — default is NOT exposed (safer).
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

    // Intercept ALL webagent events → route to dddk UI layer.
    agent.on('subtitle', (text) => {
      this.subtitle.show({
        text,
        type: 'agent',
        onAccept: () => agent.respond('continue'),
        onReject: () => agent.stop(),
        onCancel: () => agent.stop(),
      });
    });

    // Real-time "agent is doing X" feedback. Without this, the user clicks
    // "Ask AI" and sees nothing on screen until the loop ends — they assume
    // the agent silently bailed. Showing each action as it fires (`navigate
    // → /docs`, `scroll_to .pricing`, …) makes the agent's intent legible
    // and lets the user catch and stop it if it heads the wrong way.
    //
    // Destructive actions still go through the separate `confirm_action`
    // flow below (which blocks until the user decides). before_action is
    // ONLY for visibility on routine ops — never blocks.
    //
    agent.on('before_action', (payload) => {
      // No mid-screen pill here — the per-step border around the target
      // plus the confirm_action subtitle (in interactive mode) carry the
      // narration. Hosts that want a pill can listen to before_action
      // themselves and call subtitle.showIndicator.
      if (payload.targetSelector) {
        // Frame the action target the same way Dwell frames a long-pressed
        // element — visual continuity so the user sees what the agent is
        // about to touch. The next action's frame replaces this one;
        // `done` / `error` events clear the final frame.
        this.highlightElement(payload.targetSelector);
      }
    });
    // After each step completes, hide the action pill and clear the
    // per-step border so visuals don't bleed into the next step.
    agent.on('step', () => {
      this.subtitle.hideIndicator();
      clearWebagentOverlays();
      // Don't clear `highlightElement` here — the border framing IS the
      // user's visual anchor for what just happened. It clears on the
      // next before_action (which immediately reframes the new target)
      // or on `done` / `error`.
    });

    agent.on('ask_user', ({ question }) => {
      this.emitIntent({ kind: 'agent_asked', question, timestamp: Date.now() });
      this.subtitle.show({
        text: question,
        type: 'agent',
        hints: 'space 同意 ｜ 雙擊 space 拒絕 ｜ 或輸入後 ctrl+space',
        onAccept: () => {
          this.emitIntent({ kind: 'agent_answered', question, answer: 'yes', via: 'gesture', timestamp: Date.now() });
          agent.respond('yes');
        },
        onReject: () => {
          this.emitIntent({ kind: 'agent_answered', question, answer: 'no', via: 'gesture', timestamp: Date.now() });
          agent.respond('no');
        },
        onCancel: () => agent.stop(),
      });
    });

    // Multi-choice variant — the agent asks for ONE of N options. We
    // render via Subtitle.showChoice (click / digit-key / free-text).
    // The chosen string flows back via agent.respond. `agent_answered`
    // intent uses the option index when canonical, or `'free-text'`
    // when the user typed into the Other slot.
    agent.on('ask_user_choice', (payload) => {
      this.emitIntent({ kind: 'agent_asked', question: payload.question, timestamp: Date.now() });
      this.subtitle.showChoice({
        question: payload.question,
        options: payload.options,
        allowFreeText: payload.allowFreeText,
        onChoose: (value, index) => {
          this.emitIntent({
            kind: 'agent_answered',
            question: payload.question,
            answer: value,
            via: index === -1 ? 'text' : 'gesture',
            timestamp: Date.now(),
          });
          agent.respond(value);
        },
        onCancel: () => agent.stop(),
      });
    });

    // confirm_action fires before EVERY action in step-mode (or just
    // destructive ones otherwise). Frame the target element so the user
    // can SEE what's about to be touched, then surface a subtitle bar
    // asking for confirmation. Reject (double-tap) stops the agent.
    agent.on('confirm_action', (payload) => {
      // Find a target selector to frame (most action params include
      // selector / target / element / path).
      const targetSelector =
        (typeof payload.params.selector === 'string' ? payload.params.selector : null) ??
        (typeof payload.params.target   === 'string' ? payload.params.target   : null) ??
        (typeof payload.params.element  === 'string' ? payload.params.element  : null);
      if (targetSelector) {
        this.highlightElement(targetSelector);
      } else {
        this.clearHighlight();
      }
      this.subtitle.show({
        text: payload.message,
        type: 'agent',
        onAccept: () => {
          this.emitIntent({ kind: 'confirm_action', actionName: payload.actionName, params: payload.params, approved: true, timestamp: Date.now() });
          payload.decide(true);
        },
        onReject: () => {
          this.emitIntent({ kind: 'confirm_action', actionName: payload.actionName, params: payload.params, approved: false, timestamp: Date.now() });
          this.clearHighlight();
          payload.decide(false);
        },
        onCancel: () => {
          this.clearHighlight();
          payload.decide(false);
        },
      });
    });

    agent.on('piece_surface', ({ surface, placement }) => {
      // Forward to dddk's `surface` event — host listens and renders via
      // PieceRenderer. Map webagent's PiecePlacement (`'center' | 'inline'
      // | 'dock'`) to dddk's SurfacePlacement: 'center' → 'modal',
      // 'inline' → 'subtitle'.
      const mapped: import('./skills/types').SurfacePlacement =
        placement === 'inline' ? 'subtitle'
        : placement === 'center' ? 'modal'
        : placement;
      this.emitter.emit('surface', { surface, placement: mapped });
    });

    agent.on('navigate', ({ path }) => this.navigate(path));

    // The "thinking" indicator shows once at the start of a run, then
    // hides until done/error so it can show again on the next run().
    // After step 1 the subtitle / border / per-step confirmations
    // carry the visual narrative — re-flashing every step would just
    // obscure the page underneath.
    let indicatorShownThisRun = false;
    const thinkingLabel =
      this.resolveIndicatorOverride('processing')
      ?? sdkString(this.config.locale, 'agent.thinking');
    agent.on('status', (status) => {
      if (status === 'thinking' && !indicatorShownThisRun) {
        this.subtitle.showIndicator('processing', thinkingLabel);
        indicatorShownThisRun = true;
      } else if (status === 'thinking') {
        // Subsequent thinking turns — silently. The user already knows.
      } else if (status === 'executing') {
        // Executing has its own UI (border frame + confirm subtitle in
        // interactive mode). No indicator needed.
        this.subtitle.hideIndicator();
      } else {
        // idle / done / failed / waiting — hide the indicator. Reset the
        // flag only when the run truly ended (done/failed), so a brief
        // "waiting" status (between confirm prompts) doesn't re-arm.
        this.subtitle.hideIndicator();
        if (status === 'done' || status === 'failed') {
          indicatorShownThisRun = false;
        }
      }
    });

    const summaryHideMs = this.resolveAgentAutoHide('summary');
    const errorHideMs = this.resolveAgentAutoHide('error');
    const gated = this.config.gateAgentSubtitles === true;

    agent.on('done', (session: AgentSession) => {
      this.subtitle.hideIndicator();
      if (session.summary) {
        // Two delivery modes:
        //  - Plain `info` (default): the user dismisses by clicking
        //    anywhere or pressing any non-Space key. No satisfaction
        //    signal captured.
        //  - `gated` (config.gateAgentSubtitles === true): mount as
        //    `agent` type with Space accept / double-Space reject.
        //    Accept emits a `feedback` intent with `satisfied: true`,
        //    reject emits `satisfied: false`. Hosts wired into the
        //    intent stream can measure agent quality + use it as the
        //    canonical "next agent turn" hook.
        if (gated) {
          const summary = session.summary;
          this.subtitle.show({
            text: summary,
            type: 'agent',
            onAccept: () => {
              this.emitIntent({ kind: 'agent_feedback', satisfied: true, summary, timestamp: Date.now() });
            },
            onReject: () => {
              this.emitIntent({ kind: 'agent_feedback', satisfied: false, summary, timestamp: Date.now() });
            },
            onCancel: () => {
              this.emitIntent({ kind: 'agent_feedback', satisfied: null, summary, timestamp: Date.now() });
            },
            ...(summaryHideMs > 0 ? { autoHide: summaryHideMs } : {}),
          });
        } else {
          this.subtitle.show({
            text: session.summary,
            type: 'info',
            ...(summaryHideMs > 0 ? { autoHide: summaryHideMs } : {}),
          });
        }
      }
      // If the host configured auto-hide, also clear the highlight /
      // overlays at the same time so the agent's framing doesn't
      // outlive its summary.
      if (summaryHideMs > 0) {
        setTimeout(() => {
          this.clearHighlight();
          clearWebagentOverlays();
        }, summaryHideMs);
      }
    });

    agent.on('error', (err) => {
      this.subtitle.show({
        text: `Agent 錯誤：${err.message}`,
        type: gated ? 'agent' : 'info',
        ...(gated ? {
          onAccept: () => { /* acknowledge — clears subtitle via the running indicator path */ },
          onReject: () => { /* same — error has no continue semantics */ },
        } : {}),
        ...(errorHideMs > 0 ? { autoHide: errorHideMs } : {}),
      });
      this.clearHighlight();
      clearWebagentOverlays();
    });

    // Attach the live agent to the tools registry so any future
    // `dddk.tools.register(...)` calls flow into this running agent
    // immediately, not just into the snapshot at build time.
    this.tools.attachAgent(agent);

    return agent;
  }

  /**
   * Collect palette commands that have opted into agent exposure
   * (via `agentTool: {...}`), turn them into WebAgent customActions.
   */
  private collectPaletteTools(): NonNullable<WebAgentConfig['customActions']> {
    const tools: NonNullable<WebAgentConfig['customActions']> = [];
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
