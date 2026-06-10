/**
 * Public config + internal-surface types for the orchestrator.
 *
 * `DotDotDuckConfig` is the host-facing configuration object passed to
 * `new DotDotDuck(config)`. The interface is re-exported from
 * `orchestrator/index.ts` for backwards compatibility so consumers can
 * still `import type { DotDotDuckConfig } from '@perhapxin/dddk'`.
 */

import type { WebAgentConfig } from '../agent';
import type { LLMSource } from '../agent/llm/router';
import type { PaletteItem } from '../triggers/command-palette';
import type { Skill } from '../skills/types';
import type { Locale, StorageAdapter, I18nDict } from '../types';

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

  /** 3-tier hybrid memory (core / episodic / semantic). All tiers opt-in.
   *  When set, agent context is augmented with the relevant memory blocks
   *  on every new run. */
  memory?: import('../agent/memory/types').MemoryConfig;

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
  camera?: import('../triggers/command-palette').CameraOptions | false;

  /**
   * Optional chip row rendered below the palette input. Each `PaletteItem`
   * with a `category` field that matches a chip's `id` shows when that
   * chip is active. An implicit "All" chip is prepended automatically.
   */
  paletteCategories?: import('../triggers/command-palette').PaletteCategory[];
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
