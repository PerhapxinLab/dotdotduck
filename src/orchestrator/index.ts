/**
 * DotDotDuck — main orchestrator.
 * Wires gestures + palette + dwell + skills + subtitle UI together.
 *
 * Webagent integration is OPTIONAL — pass a factory and it'll be used for skill
 * agent runs; otherwise dddk works standalone for palette + skills + voice.
 *
 * See ../docs/00-overview.md for the full design.
 *
 * This file is the shell — constructor / mount / destroy / events /
 * runtime toggles / public getters. The heavy lifting lives in sibling
 * modules under `./orchestrator/`:
 *
 *   - agent-lifecycle.ts  — build / pump / stop / route the WebAgent loop
 *   - skill-dispatcher.ts — runSkill, ScriptSkill, surface tools, palette items
 *   - highlight.ts        — frame any DOM element (shared with Dwell)
 *   - intent-buffer.ts    — per-run IntentEvent buffer + exportAgentRun
 *   - helpers.ts          — pure functions (blobToDataUrl, defaultStorage, searchPageText)
 *   - types.ts            — DotDotDuckConfig
 */

import {
  WebAgent,
  type SelectionContext,
} from '../agent';

import { GestureManager, type GestureCallbacks } from '../triggers/space-gesture';
import { CommandPalette } from '../triggers/command-palette';
import { Spotter } from '../triggers/spotter';
import { SkillRegistry } from '../skills/registry';
import { PanelRuntime } from '../triggers/panel-runtime';
import { Placements } from '../ui/placement';
import { sdkString } from '../utils/sdk-i18n';
import { PinnedPanelRegistry } from '../modules/pinned-panel';
import { ToolsRegistry } from '../tools-registry';
import { PreferenceStore } from '../skills/preferences';
import { Subtitle } from '../ui/subtitle';
import { TypedEmitter } from '../event-emitter';
import type {
  Locale,
  StorageAdapter,
  DddkEventName,
  DddkEventHandler,
  IntentEvent,
} from '../types';

import type { DotDotDuckConfig } from './types';
import { AgentLifecycle } from './agent-lifecycle';
import { SkillDispatcher } from './skill-dispatcher';
import { HighlightOverlay } from './highlight';
import { IntentBuffer } from './intent-buffer';
import { Memory } from '../agent/memory';
import { defaultStorage, searchPageText } from './helpers';

export type { DotDotDuckConfig } from './types';
export { searchPageText, blobToDataUrl, defaultStorage } from './helpers';

export class DotDotDuck {
  readonly skills: SkillRegistry;
  /** @internal */
  _panelRuntime: PanelRuntime | null = null;
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

  // ─── internal state (consumed by sibling modules under ./orchestrator/) ──
  // All fields below carry a leading `_` and the `@internal` JSDoc tag —
  // they're public-by-TS so the helper classes can read/write them, but
  // host code should never touch them. The public API surface flows
  // through the `runSkill` / `startAgent` / etc. methods below.

  /** @internal */ _config: DotDotDuckConfig;
  /** @internal */ _gestures?: GestureManager;
  /** @internal */ _emitter = new TypedEmitter();
  /** @internal */ _storage: StorageAdapter;
  /** @internal */ _prefs: PreferenceStore;
  /** @internal */ _pendingPrefs: { skillId: string; resolve: () => void; reject: () => void } | null = null;
  /**
   * Ad-hoc Surface awaiting host submission. Lifecycle:
   *   1. ScriptSkill step calls `tools.surface(...)` → emits `surface` event
   *   2. Host renders + collects user input
   *   3. Host calls `dddk.submitSurface(data)` or `dddk.cancelSurface()`
   *   4. The promise returned to the skill resolves with data (or null)
   * @internal
   */
  _pendingSurface: { resolve: (data: Record<string, unknown> | null) => void } | null = null;
  /** @internal */ _agentInstance: WebAgent | null = null;
  /** @internal */ _voiceEnabled: boolean;
  /** @internal */ _agentEnabled: boolean;
  /** @internal */ _currentSelection: SelectionContext | null = null;

  /** @internal */ readonly _highlight = new HighlightOverlay();
  /** @internal */ readonly _intentBuffer = new IntentBuffer();
  /** @internal */ readonly _lifecycle: AgentLifecycle;
  /** @internal */ readonly _dispatcher: SkillDispatcher;
  readonly memory: Memory | null;

  constructor(config: DotDotDuckConfig = {}) {
    this._config = config;
    this.memory = config.memory ? new Memory(config.memory) : null;
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
    // Helper classes — created AFTER all fields they touch are initialised.
    this._lifecycle = new AgentLifecycle(this);
    this._dispatcher = new SkillDispatcher(this);
    // Wire the × close button on the subtitle bar to:
    //   1. stop a running agent (with stopped-feedback subtitle)
    //   2. fire gesture_escape so a running ScriptSkill cancels too
    //      (its `waitForAcceptOrEscape` listens on this event; without
    //      this hook a click-outside during a script just hid the
    //      subtitle and the NEXT step's subtitle would silently appear)
    this.subtitle.setCloseHandler(() => {
      this._lifecycle.handleUserStopAgent('close');
      this._emitter.emit('gesture_escape', undefined);
    });
    this._storage = config.storage ?? defaultStorage();
    this._prefs = new PreferenceStore(this._storage, this._config.locale);
    this._voiceEnabled = config.voice?.enabled ?? true;
    this._agentEnabled = config.agent?.enabled ?? true;

    this.palette = new CommandPalette({
      initialItems: this._dispatcher.buildPaletteItems(),
      locale: config.locale,
      placeholder: this._t('palette.placeholder', sdkString(config.locale, 'palette.placeholder')),
      searchPage: (q) => searchPageText(q),
      // Camera button is OFF unless the host passes a `camera` config — the SDK
      // ships zero defaults. Hosts who want the screenshot button wire it up
      // explicitly via DotDotDuckConfig.camera.
      camera: this._config.camera === false ? undefined : this._config.camera,
      categories: this._config.paletteCategories,
      allCategoriesLabel: this._config.paletteAllCategoriesLabel,
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
        this._emitter.emit('pointer_lock', {
          selector,
          element: document.querySelector<HTMLElement>(selector)!,
        });
      },
      onLassoComplete: (info) => this._emitter.emit('pointer_lasso', info),
      onRingShow: ({ selector }) => this._emitter.emit('pointer_ring_show', { selector }),
      onRingHide: () => this._emitter.emit('pointer_ring_hide', undefined),
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
    this._config.locale = locale;
    this.subtitle.setLocale(locale);
    try { this.palette.setLocale(locale); } catch { /* palette torn down */ }
    try { this._agentInstance?.setLocale(locale); } catch { /* agent not built */ }
  }

  // ─── lifecycle ──────────────────────────────────────────────────

  mount(): void {
    const callbacks: GestureCallbacks = {
      onAccept: () => {
        this._emitter.emit('gesture_accept', undefined);
        // The subtitle bar accepts callbacks (onAccept) from callers
        // (Proactive prompt, agent ask_user, etc.) but its DOM only
        // wires button clicks. Bridge the gesture here so a space tap
        // also fires the same callback. Returns false when no callback
        // is registered — we don't suppress the gesture in that case.
        this.subtitle.invokeAccept();
        this.emitIntent({ kind: 'agent_answered', answer: 'accept', via: 'gesture', timestamp: Date.now() });
      },
      onReject: () => {
        this._emitter.emit('gesture_reject', undefined);
        const hadReject = this.subtitle.invokeReject();
        // If the subtitle had its own reject (e.g. confirm dialog: "no"),
        // that handler already fired and the bar is gone. If not, this
        // is a "user dismissed the agent" double-tap — stop the loop
        // with a polished feedback line.
        if (!hadReject) {
          if (this._agentInstance?.isRunning()) {
            this._lifecycle.handleUserStopAgent('reject');
          } else {
            this.subtitle.hide();
          }
        }
        this.emitIntent({ kind: 'agent_answered', answer: 'reject', via: 'gesture', timestamp: Date.now() });
      },
      onAcceptLine: () => {
        this._emitter.emit('gesture_accept', undefined);
        this.subtitle.invokeAccept();
      },
      onVoiceStart: () => {
        if (!this._voiceEnabled) return;
        // Long-press space while agent is running = "I have a new
        // prompt to say". Stop the current agent loop cleanly first,
        // then let voice take over.
        this._lifecycle.handleUserStopAgent('voice');
        this._emitter.emit('voice_start', undefined);
      },
      onVoiceEnd: () => {
        if (!this._voiceEnabled) return;
        this._emitter.emit('voice_end', { text: '' });
      },
      onPaletteToggle: (selection) => {
        this._currentSelection = selection ? this._captureSelection(selection) : null;
        // Opening the palette signals "I want to type a new prompt" —
        // stop the agent so the next message is a clean start, not a
        // race with the in-flight loop.
        this._lifecycle.handleUserStopAgent('palette');
        this._emitter.emit('palette_open', { selection });
        this.palette.toggle(selection);
      },
      onEscape: () => {
        this._emitter.emit('gesture_escape', undefined);
        // PanelRuntime owns Esc when a panel skill is open — esc
        // means "go back one step / close this panel", NOT "stop
        // the agent" / "close the palette". Bail before any of the
        // cross-cutting stop handlers fire.
        if (this._panelRuntime?.isOpen()) return;
        // Palette owns Esc when it's in result-mode or a sub-menu —
        // esc means "back one level" there, not "close the whole
        // palette". Let the palette's own keydown handler take care
        // of it. (Palette's plain list mode still falls through to
        // the close() call below.)
        if (this.palette.hasInternalEsc()) return;
        this._lifecycle.handleUserStopAgent('esc');
        this.palette.close();
        this.spotter.unlock();
      },
    };

    this._gestures = new GestureManager({
      callbacks,
      gestureKey: this._config.gestureKey,
      holdThresholdMs: this._config.holdThresholdMs,
      doubleTapWindowMs: this._config.doubleTapWindowMs,
      shouldIntercept: () => this.subtitle.isVisible() || this.palette.isOpen(),
    });
    this._gestures.start();
    // Keep GestureManager.hasSuggestion in sync with subtitle visibility —
    // single space tap → accept ONLY fires when hasSuggestion is true.
    // Without this hook a proactive prompt would render but space taps
    // would be no-ops; double-tap reject still works because it doesn't
    // gate on hasSuggestion.
    const gestures = this._gestures;
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
    this._gestures?.destroy();
    this.spotter.destroy();
    this.palette.close();
    this.subtitle.hide();
    this.subtitle.hideIndicator();
    this._agentInstance?.destroy();
    this._emitter.clear();
  }

  // ─── events ─────────────────────────────────────────────────────

  on<E extends DddkEventName>(event: E, handler: DddkEventHandler<E>): void {
    this._emitter.on(event, handler);
  }

  off<E extends DddkEventName>(event: E, handler: DddkEventHandler<E>): void {
    this._emitter.off(event, handler);
  }

  // ─── skill dispatch ─────────────────────────────────────────────

  async runSkill(idOrCommand: string, vars: Record<string, string> = {}): Promise<void> {
    return this._dispatcher.runSkill(idOrCommand, vars);
  }

  /** Emit a structured intent event. Public so other modules can push too. */
  emitIntent(event: IntentEvent): void {
    this._intentBuffer.emitIntent(this._emitter, event);
  }

  /**
   * v0.2.0 ROADMAP item 7.3.
   *
   * Public host-facing `track(name, props?)` API. Mirrors the standard
   * product-analytics surface — engineers recognise this from existing
   * tooling. Routes through the same intent stream as the SDK's typed
   * events; downstream sinks see one canonical pipe.
   *
   * `name` should be snake_case past-tense ("order_completed",
   * "checkout_started") — describes what happened, not what to do.
   *
   * @example
   * ```ts
   * dddk.track('order_completed', { order_id, value: 49.99, items: 3 });
   * dddk.track('survey_dismissed');
   * ```
   */
  track(name: string, props?: Record<string, unknown>): void {
    if (!name || typeof name !== 'string') return;
    this.emitIntent({
      kind: 'custom_track',
      name,
      props: props ?? {},
      timestamp: Date.now(),
    });
  }

  // ─── highlight (frame any DOM element) ──────────────────────────

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
    return this._highlight.highlightElement(target, opts);
  }

  /** Remove any active highlight frame. */
  clearHighlight(): void {
    this._highlight.clearHighlight();
  }

  /**
   * Lazy-initialize the PanelRuntime. The runtime is a separate DOM overlay
   * from the regular CommandPalette — it handles `PanelSkill` execution
   * (top input + bottom panel + navigation stack).
   * @internal
   */
  _ensurePanelRuntime(): PanelRuntime {
    if (!this._panelRuntime) {
      this._panelRuntime = new PanelRuntime({
        host: {
          llm: this._config.llm
            ? async (prompt: string) => {
                const llm = this._config.llm;
                if (!llm) return '';
                const r = await (llm as { complete?: (p: string) => Promise<string> }).complete?.(prompt);
                return r ?? '';
              }
            : undefined,
          navigate: (path: string) => this._navigate(path),
          renderPiece: this._config.panelRenderPiece,
        },
      });
    }
    return this._panelRuntime;
  }

  /** Check whether a PanelSkill is currently active. */
  isPanelOpen(): boolean {
    return this._panelRuntime?.isOpen() ?? false;
  }

  /**
   * Programmatically fire `voice_start` — same event the long-press gesture
   * emits. Mobile FAB long-press, custom triggers (e.g. host's own header
   * button bound via `MobileTrigger.bindTrigger`), or any other entry point
   * can call this to enter voice mode without simulating keyboard events.
   */
  triggerVoiceStart(): void {
    if (!this._voiceEnabled) return;
    this._emitter.emit('voice_start', undefined);
  }

  /** Fire `voice_end` to match a prior `triggerVoiceStart`. */
  triggerVoiceEnd(): void {
    if (!this._voiceEnabled) return;
    this._emitter.emit('voice_end', { text: '' });
  }

  /** Programmatically close any active panel skill (Esc equivalent for host). */
  async closePanel(): Promise<void> {
    if (this._panelRuntime) await this._panelRuntime.close();
  }

  /**
   * Kick the webagent. `selection` defaults to whatever was captured at the
   * last palette open — pass `{ selection: null }` to force no selection
   * context, or pass an explicit `SelectionContext` to override.
   */
  startAgent(task: string, options: { selection?: SelectionContext | null } = {}): void {
    this._lifecycle.startAgent(task, options);
  }

  /**
   * Snapshot the current (or most-recent) agent run as a single JSON
   * blob — session turns + every intent emitted during the run. Useful
   * for shipping a complete query record to a dashboard / DB after the
   * loop ends. Returns `null` if no agent has ever run in this session.
   */
  exportAgentRun(): ReturnType<IntentBuffer['exportAgentRun']> {
    return this._intentBuffer.exportAgentRun(this._agentInstance?.getSession());
  }

  /** Resume a saved session — used by the host's onMount after a full
   *  page reload. If there's no saved session or it's in a terminal
   *  state, no-ops. Otherwise pumps the stream into the dddk UI as if
   *  the loop had never been interrupted. */
  resumeAgent(): void {
    this._lifecycle.resumeAgent();
  }

  /** Tell the agent that its continuity window should close now (used
   *  for `sessionScope: 'palette'` hosts when the palette closes). */
  endAgentContinuity(): void {
    this._agentInstance?.endContinuity();
  }

  /** Wipe any saved agent session — the next `runStream()` starts
   *  fresh. Hosts call this after a full page reload to drop an
   *  abandoned conversation from the previous load. */
  clearAgentSession(): void {
    this._agentInstance?.clearSession();
  }

  /** Stop a running agent and clear its on-screen UI. Safe to call
   *  when the agent is idle (no-ops). Use this when the host wants to
   *  cancel mid-task — e.g. the user clicked an in-app link / sidebar
   *  entry, signalling they're moving on regardless of where the
   *  agent thinks it is. */
  stopAgent(): void {
    this._lifecycle.handleUserStopAgent('close');
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
    this._lifecycle.triggerAccept();
  }

  /**
   * Fire the same "reject" gesture that double-tap Space fires on
   * desktop — emits `gesture_reject`, exits script skills, rejects
   * confirms, or stops an in-flight agent. Use this from a mobile
   * double-tap on the FAB / subtitle bar.
   */
  triggerReject(): void {
    this._lifecycle.triggerReject();
  }

  /** Runtime toggle for voice (hold-space STT gesture). */
  setVoiceEnabled(enabled: boolean): void {
    this._voiceEnabled = enabled;
  }

  isVoiceEnabled(): boolean {
    return this._voiceEnabled;
  }

  /**
   * Runtime toggle for the DOM-grounded agent loop. When `false`,
   * `startAgent()` no-ops with a subtitle hint, palette plain-text Enter
   * does NOT fire the agent, and any in-flight run stops cleanly. Other
   * subsystems that use the LLM router (inline AI, voice cleanup, …)
   * keep working.
   */
  setAgentEnabled(enabled: boolean): void {
    this._agentEnabled = enabled;
    if (!enabled && this._agentInstance?.isRunning()) {
      this._agentInstance.stop();
    }
  }

  isAgentEnabled(): boolean {
    return this._agentEnabled;
  }

  /** Access the underlying WebAgent (null until first startAgent call). */
  getAgent(): WebAgent | null {
    return this._agentInstance;
  }

  /** Forward a user response to the agent (for ask_user / surface form submits). */
  respondToAgent(answer: string | Record<string, unknown>): void {
    this._agentInstance?.respond(answer);
  }

  /**
   * Called by host after the user submits a preferences setup surface.
   * Persists the values and resumes the skill that triggered it.
   */
  submitPreferences(values: Record<string, unknown>): void {
    if (!this._pendingPrefs) return;
    this._prefs.write(this._pendingPrefs.skillId, values);
    this._pendingPrefs.resolve();
  }

  cancelPreferences(): void {
    this._pendingPrefs?.reject();
  }

  /**
   * Show a Surface and await the host's submission. Used by skill tools and
   * any host code that wants the same "emit → user fills → resolve" pattern.
   */
  showSurfaceAndAwait(
    surface: unknown,
    placement: import('../skills/types').SurfacePlacement = 'modal',
  ): Promise<Record<string, unknown> | null> {
    return this._dispatcher.showSurfaceAndAwait(surface, placement);
  }

  /**
   * Host calls this when the user submits the active Surface form. Routes
   * to whichever subsystem opened the surface:
   *   - If a ScriptSkill called `tools.surface(...)` → resolves that promise
   *   - If webagent was awaiting a host interaction → resumes the agent loop
   * (Both can be pending at once in theory — we resolve both for safety.)
   */
  submitSurface(data: Record<string, unknown>): void {
    this._dispatcher.submitSurface(data);
  }

  /** Host calls this when the user cancels the Surface (Esc / backdrop click). */
  cancelSurface(): void {
    this._dispatcher.cancelSurface();
  }

  // ─── internal helpers consumed by sibling modules ───────────────

  /** @internal */
  _navigate(path: string): void {
    if (this._config.onNavigate) this._config.onNavigate(path);
    else if (typeof location !== 'undefined') location.assign(path);
  }

  /**
   * Capture rich selection context from the current Window.Selection plus
   * spotter's lock state. Best-effort — missing bits stay undefined.
   * @internal
   */
  _captureSelection(text: string): SelectionContext {
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

  /** @internal */
  _t(key: string, fallback: string): string {
    const dict = this._config.i18n?.[this._config.locale ?? 'en'];
    return dict?.[key] ?? fallback;
  }

  /** @internal — used by AgentLifecycle.buildAgent to collect palette tools. */
  _collectPaletteTools(): NonNullable<import('../agent').WebAgentConfig['customActions']> {
    return this._lifecycle.collectPaletteTools();
  }
}
