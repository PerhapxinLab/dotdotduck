import { resolveStorage } from '../../utils/storage/index.js';
import type { StorageAdapter, StorageKind } from '../../utils/storage/types.js';
import { betaSample } from '../../utils/text/sampling.js';
import type { Memory } from '../../agent/memory/index.js';
import { sdkString } from '../../utils/sdk-i18n';

/**
 * Structural Analytics interface — the subset of `Analytics` that
 * proactive needs. Declared here (not imported from the analytics
 * module) so consumers passing a `dddk/modules/analytics` instance
 * aren't blocked by TypeScript's nominal-typing on private fields.
 */
export interface AnalyticsLike {
  track(event: string, payload?: Record<string, unknown>): void;
}

export type Trigger = {
  id: string;
  condition: (ctx: TriggerContext) => boolean | Promise<boolean>;
};

export type TriggerContext = {
  now: number;
  page?: string;
  dwellMs?: number;
  scrollDepth?: number;
  user?: Record<string, unknown>;
  memory?: Memory;
  customMeta?: Record<string, unknown>;
};

export type PromptSurface = {
  text: string | ((ctx: TriggerContext) => string);
  placement?: 'inline' | 'dock' | 'modal';
  yesLabel?: string;
  noLabel?: string;
  dismissable?: boolean;
  autoTimeoutMs?: number;
  /**
   * Rich content surface. When provided, the renderer ignores `text` /
   * `yesLabel` / `noLabel` and renders this PieceSurface tree directly.
   * Use for recommendation grids (`OptionGroup` of `MediaCard`s),
   * confirm summaries, multi-option pickers — anything that benefits
   * from image + structured layout instead of plain text + yes/no.
   *
   * The piece tree should `trigger('choose', { value, index })` (or a
   * similar action) — the bridge maps any non-`yes` / non-`no` action
   * to `'dismiss'` for the standard 3-way response. Host can use the
   * `data` model to capture the picked value separately via analytics.
   */
  pieces?: {
    /** Standard PieceSurface shape: { root: PieceNode, data?: object } */
    root: { kind: string; [k: string]: unknown };
    data?: Record<string, unknown>;
  };
};

export type PromptDefinition = {
  id: string;
  category?: string;
  priority?: number;
  triggers: Trigger[];
  triggerLogic?: 'AND' | 'OR';
  surface: PromptSurface;
  onResponse?: (response: 'yes' | 'no' | 'dismiss', ctx: TriggerContext) => Promise<void> | void;
  variants?: Array<{ id: string; surface: PromptSurface }>;
  variantSelector?: 'random' | 'epsilon_greedy' | 'thompson_sampling';
};

export type FatigueConfig = {
  maxPerSession?: number;
  cooldownMs?: number;
  dismissPenalty?: { sameId?: 'session' | number; sameCategory?: number };
  consecutiveDismissCap?: number;
};

export type ProactiveOpts = {
  analytics?: AnalyticsLike;
  memory?: Memory;
  storage?: StorageKind;
  fatigue?: FatigueConfig;
  keys?: { yes?: string; no?: string; dismiss?: string };
  identity?: () => Record<string, unknown>;
  /** Locale for the default Yes / No prompt labels when a prompt's
   *  surface doesn't supply its own. `en` / `zh-TW` ship bundled. */
  locale?: string;
  render?: (prompt: PromptDefinition, variantSurface: PromptSurface) => Promise<'yes' | 'no' | 'dismiss'>;

  /**
   * Behavior when the dddk palette (or a PanelSkill) is currently open.
   *
   * - `suppress` (default)     — do not trigger any proactive prompt
   * - `blur_palette`           — visually blur/dim the palette and overlay
   *                              the proactive prompt (host renderer choice)
   * - `subtitle_only`          — only show prompts via subtitle bar placement;
   *                              only Space counts as a response; any other
   *                              input is treated as "user didn't see it"
   *                              and palette flow continues unaffected.
   */
  whenPaletteOpen?: 'suppress' | 'blur_palette' | 'subtitle_only';

  /**
   * Callback that returns whether the palette is currently open. Wired by
   * dddk orchestrator (`isPaletteOpen()` / `isPanelOpen()`) so proactive can
   * respect palette state without a hard dependency on dddk's class.
   */
  isPaletteOpen?: () => boolean;
};

type PromptState = {
  category?: string;
  lastShownAt: number;
  dismissedInSession: boolean;
  variantStats: Record<string, { yes: number; no: number; dismiss: number }>;
};

export class Proactive {
  private prompts = new Map<string, PromptDefinition>();
  private state = new Map<string, PromptState>();
  private storage: StorageAdapter;
  private analytics?: AnalyticsLike;
  private memory?: Memory;
  private opts: ProactiveOpts;
  private opened = false;
  private sessionShown = 0;
  private sessionDismisses = 0;
  private lastShownAt = 0;
  private paused = false;

  constructor(opts: ProactiveOpts = {}) {
    this.storage = resolveStorage(opts.storage ?? 'indexeddb');
    this.analytics = opts.analytics;
    this.memory = opts.memory;
    this.opts = opts;
  }

  async init(): Promise<void> {
    await this.storage.open('dddk-proactive');
    this.opened = true;
    const snap = (await this.storage.get('proactive:state')) as Record<string, PromptState> | undefined;
    if (snap) for (const [id, st] of Object.entries(snap)) this.state.set(id, st);
  }

  register(p: PromptDefinition): void {
    this.prompts.set(p.id, p);
    if (!this.state.has(p.id)) {
      this.state.set(p.id, {
        category: p.category,
        lastShownAt: 0,
        dismissedInSession: false,
        variantStats: {},
      });
    }
  }

  unregister(id: string): void {
    this.prompts.delete(id);
  }

  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }

  /** Evaluate all prompts; fire the highest-priority eligible one. Returns the prompt id if fired. */
  async tick(ctx: Omit<TriggerContext, 'now' | 'memory'> = {}): Promise<string | undefined> {
    if (this.paused) return;
    const fatigue = this.opts.fatigue ?? {};
    if (this.sessionShown >= (fatigue.maxPerSession ?? 3)) return;
    if (Date.now() - this.lastShownAt < (fatigue.cooldownMs ?? 60_000)) return;
    if (this.sessionDismisses >= (fatigue.consecutiveDismissCap ?? 3)) return;

    // Palette coordination — see ProactiveOpts.whenPaletteOpen
    const paletteOpen = this.opts.isPaletteOpen?.() ?? false;
    const mode = this.opts.whenPaletteOpen ?? 'suppress';
    if (paletteOpen && mode === 'suppress') return;
    // `blur_palette` and `subtitle_only` still proceed; the render function is
    // expected to honor the constraint (e.g. force placement='subtitle' or
    // overlay above blurred palette). The proactive runtime itself doesn't
    // know how to blur the palette UI.

    const full: TriggerContext = { now: Date.now(), memory: this.memory, ...ctx };
    const eligible: PromptDefinition[] = [];
    for (const p of this.prompts.values()) {
      const st = this.state.get(p.id);
      if (!st) continue;
      if (st.dismissedInSession && fatigue.dismissPenalty?.sameId === 'session') continue;
      if (fatigue.dismissPenalty?.sameCategory && p.category) {
        const recentSame = [...this.state.values()].some(
          (s) => s.category === p.category && Date.now() - s.lastShownAt < (fatigue.dismissPenalty!.sameCategory ?? 0)
        );
        if (recentSame) continue;
      }
      const results = await Promise.all(p.triggers.map((t) => t.condition(full)));
      const ok = (p.triggerLogic ?? 'AND') === 'OR' ? results.some(Boolean) : results.every(Boolean);
      if (ok) eligible.push(p);
    }
    if (eligible.length === 0) return;
    eligible.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const p = eligible[0]!;
    await this.fire(p, full);
    return p.id;
  }

  async ask(opts: { text: string; yesLabel?: string; noLabel?: string }): Promise<'yes' | 'no' | 'dismiss'> {
    if (!this.opts.render) return 'dismiss';
    const oneOff: PromptDefinition = {
      id: `_oneoff_${Math.random().toString(36).slice(2, 8)}`,
      triggers: [],
      surface: {
        text: opts.text,
        yesLabel: opts.yesLabel ?? sdkString(this.opts.locale, 'proactive.yes'),
        noLabel: opts.noLabel ?? sdkString(this.opts.locale, 'proactive.no'),
        dismissable: true,
      },
    };
    return await this.opts.render(oneOff, oneOff.surface);
  }

  explain(id: string) {
    const p = this.prompts.get(id);
    const st = this.state.get(id);
    if (!p || !st) return undefined;
    return {
      promptId: id,
      lastShownAt: st.lastShownAt,
      dismissedInSession: st.dismissedInSession,
      variantStats: st.variantStats,
      fatigue: {
        sessionShown: this.sessionShown,
        sessionDismisses: this.sessionDismisses,
        timeSinceLastShown: Date.now() - this.lastShownAt,
      },
    };
  }

  private selectVariant(p: PromptDefinition): { variantId: string; surface: PromptSurface } {
    if (!p.variants || p.variants.length === 0) {
      return { variantId: '_default', surface: p.surface };
    }
    const st = this.state.get(p.id)!;
    const method = p.variantSelector ?? 'thompson_sampling';
    if (method === 'random') {
      const v = p.variants[Math.floor(Math.random() * p.variants.length)]!;
      return { variantId: v.id, surface: v.surface };
    }
    if (method === 'epsilon_greedy') {
      if (Math.random() < 0.1) {
        const v = p.variants[Math.floor(Math.random() * p.variants.length)]!;
        return { variantId: v.id, surface: v.surface };
      }
      let best = p.variants[0]!;
      let bestRate = -1;
      for (const v of p.variants) {
        const s = st.variantStats[v.id];
        const total = s ? s.yes + s.no : 0;
        const rate = total > 0 && s ? s.yes / total : 0;
        if (rate > bestRate) {
          bestRate = rate;
          best = v;
        }
      }
      return { variantId: best.id, surface: best.surface };
    }
    let best = p.variants[0]!;
    let bestSample = -Infinity;
    for (const v of p.variants) {
      const s = st.variantStats[v.id] ?? { yes: 0, no: 0, dismiss: 0 };
      const sample = betaSample(s.yes + 1, s.no + 1);
      if (sample > bestSample) {
        bestSample = sample;
        best = v;
      }
    }
    return { variantId: best.id, surface: best.surface };
  }

  private async fire(p: PromptDefinition, ctx: TriggerContext): Promise<void> {
    if (!this.opts.render) return;
    const { variantId, surface } = this.selectVariant(p);
    const st = this.state.get(p.id)!;
    st.lastShownAt = Date.now();
    this.lastShownAt = st.lastShownAt;
    this.sessionShown++;
    this.analytics?.track('proactive.shown', { promptId: p.id, variantId });
    const response = await this.opts.render(p, surface);
    if (response === 'dismiss') {
      st.dismissedInSession = true;
      this.sessionDismisses++;
    } else {
      this.sessionDismisses = 0;
    }
    if (!st.variantStats[variantId]) st.variantStats[variantId] = { yes: 0, no: 0, dismiss: 0 };
    st.variantStats[variantId][response]++;
    this.analytics?.track('proactive.response', { promptId: p.id, variantId, response });
    if (this.opened) {
      const dump: Record<string, PromptState> = {};
      for (const [id, s] of this.state) dump[id] = s;
      await this.storage.set('proactive:state', dump);
    }
    if (p.onResponse) await p.onResponse(response, ctx);
  }

  async dispose(): Promise<void> {
    if (this.opened) await this.storage.close();
    this.opened = false;
  }
}

// ── Built-in triggers ──

export const triggers = {
  dwell(opts: { ms: number; scope?: 'page' | 'session' }): Trigger {
    return {
      id: 'dwell',
      condition: (ctx) => (ctx.dwellMs ?? 0) >= opts.ms,
    };
  },
  idleTime(opts: { ms: number }): Trigger {
    return {
      id: 'idle',
      condition: (ctx) => (ctx.dwellMs ?? 0) >= opts.ms,
    };
  },
  scrollDepth(opts: { percent: number }): Trigger {
    return {
      id: 'scroll_depth',
      condition: (ctx) => (ctx.scrollDepth ?? 0) >= opts.percent,
    };
  },
  pageMatch(opts: { path: RegExp | string }): Trigger {
    return {
      id: 'page_match',
      condition: (ctx) => {
        if (!ctx.page) return false;
        return typeof opts.path === 'string' ? ctx.page.includes(opts.path) : opts.path.test(ctx.page);
      },
    };
  },
  exitIntent(): Trigger {
    return {
      id: 'exit_intent',
      condition: (ctx) => Boolean(ctx.customMeta?.exitIntent),
    };
  },
  schedule(opts: { everyN: number }): Trigger {
    let n = 0;
    return {
      id: 'schedule',
      condition: () => ++n % opts.everyN === 0,
    };
  },
};

export const builtin = { triggers };

export { createPieceRender } from './render-piece.js';
export type { PieceSurface, PieceNode, SurfaceMountFn } from './render-piece.js';

export function createProactive(opts: ProactiveOpts = {}): Proactive {
  return new Proactive(opts);
}
