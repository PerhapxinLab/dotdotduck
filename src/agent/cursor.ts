/**
 * AgentCursor — visible big cursor that shows what the agent is about to do.
 *
 * When the agent is about to click / type / scroll, a large floating cursor
 * smoothly travels to the target element and pauses for `preClickPauseMs`
 * before the action fires. The user sees what's about to happen in time to
 * cancel.
 *
 * This is purely a visualization layer — it does not drive actions. It
 * subscribes to the `before_action` event webagent emits before every
 * action handler runs.
 *
 * Usage:
 *   const cursor = new AgentCursor({ preClickPauseMs: 250 });
 *   cursor.attachTo(dddk);
 *
 * To disable mid-run:
 *   cursor.setEnabled(false);
 */

import type { DotDotDuck } from '../orchestrator';
import { injectScopedStyle } from '../utils/dom';

export interface AgentCursorConfig {
  /** Pause (ms) between cursor arriving on target and action firing. Default 250. */
  preClickPauseMs?: number;
  /** Cursor size in px. Default 32. */
  size?: number;
  /** Tint of the cursor stroke. Default uses CSS var or accent fallback. */
  color?: string;
  /** Travel duration (ms) between targets. Default 350. */
  travelMs?: number;
  /** Disabled by default? Default false (enabled). */
  enabled?: boolean;
}

import { UI_ATTR } from '../utils/dom';
const STYLE_ID = 'dddk-agent-cursor-style';

type Resolver = () => void;

export class AgentCursor {
  private cfg: Required<AgentCursorConfig>;
  private cursorEl: HTMLDivElement | null = null;
  private cleanups: Array<() => void> = [];
  private enabled: boolean;
  /** Resolves the pause promise — webagent's action handler awaits this gate. */
  private pendingPause: Resolver | null = null;

  constructor(config: AgentCursorConfig = {}) {
    this.cfg = {
      preClickPauseMs: config.preClickPauseMs ?? 250,
      size: config.size ?? 32,
      color: config.color ?? 'var(--dddk-accent, #ec4899)',
      travelMs: config.travelMs ?? 350,
      enabled: config.enabled ?? true,
    };
    this.enabled = this.cfg.enabled;
  }

  attachTo(dddk: DotDotDuck): void {
    if (typeof document === 'undefined') return;
    ensureStyles();
    this.mount();

    // agent_tool_start: travel to target, hold for preClickPauseMs.
    const onToolStart = async (payload: { name: string; args: Record<string, unknown>; targetSelector?: string }) => {
      if (!this.enabled) return;
      if (!payload.targetSelector) return;
      const el = document.querySelector<HTMLElement>(payload.targetSelector);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2 + window.scrollX;
      const cy = rect.top + rect.height / 2 + window.scrollY;
      this.moveTo(cx, cy);
      this.flashTarget(el);
      await this.wait(this.cfg.preClickPauseMs);
    };

    // agent_tool_end: brief click pulse animation.
    const onToolEnd = (): void => {
      if (!this.enabled || !this.cursorEl) return;
      this.cursorEl.classList.remove('clicking');
      void this.cursorEl.offsetHeight;
      this.cursorEl.classList.add('clicking');
    };

    const onFinal = (): void => this.hide();
    const onError = (): void => this.hide();

    dddk.on('agent_tool_start', onToolStart);
    dddk.on('agent_tool_end', onToolEnd);
    dddk.on('agent_final', onFinal);
    dddk.on('agent_error', onError);
    this.cleanups.push(
      () => dddk.off('agent_tool_start', onToolStart),
      () => dddk.off('agent_tool_end', onToolEnd),
      () => dddk.off('agent_final', onFinal),
      () => dddk.off('agent_error', onError),
    );
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.hide();
  }

  destroy(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.cursorEl?.remove();
    this.cursorEl = null;
  }

  // ─── private ────────────────────────────────────────────────────

  private mount(): void {
    if (this.cursorEl) return;
    const el = document.createElement('div');
    el.setAttribute(UI_ATTR, 'agent-cursor');
    el.style.setProperty('--ac-size', `${this.cfg.size}px`);
    el.style.setProperty('--ac-color', this.cfg.color);
    el.style.setProperty('--ac-travel', `${this.cfg.travelMs}ms`);
    el.innerHTML = `
      <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 3l13 9-6 1.5L9.5 19z" fill="currentColor" fill-opacity="0.15" />
      </svg>
      <div class="ac-ring"></div>
    `;
    document.body.appendChild(el);
    this.cursorEl = el;
  }

  private moveTo(x: number, y: number): void {
    if (!this.cursorEl) this.mount();
    if (!this.cursorEl) return;
    this.cursorEl.style.left = `${x}px`;
    this.cursorEl.style.top = `${y}px`;
    this.cursorEl.style.opacity = '1';
  }

  private hide(): void {
    if (!this.cursorEl) return;
    this.cursorEl.style.opacity = '0';
  }

  private flashTarget(el: HTMLElement): void {
    el.setAttribute('data-dddk-agent-target', '');
    setTimeout(() => el.removeAttribute('data-dddk-agent-target'), 600);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      // If a previous wait() is still pending (e.g. before_action fired twice
      // back-to-back before the first pause elapsed), resolve the old resolver
      // first so its Promise doesn't dangle forever and stall the agent loop.
      if (this.pendingPause && this.pendingPause !== resolve) {
        const prev = this.pendingPause;
        this.pendingPause = null;
        prev();
      }
      this.pendingPause = resolve;
      setTimeout(() => {
        if (this.pendingPause === resolve) {
          this.pendingPause = null;
          resolve();
        }
      }, ms);
    });
  }
}

function ensureStyles(): void {
  injectScopedStyle(STYLE_ID, `
    [${UI_ATTR}="agent-cursor"] {
      position: absolute;
      width: var(--ac-size);
      height: var(--ac-size);
      pointer-events: none;
      transform: translate(-25%, -25%);
      transition: left var(--ac-travel) cubic-bezier(0.25, 0.8, 0.25, 1),
                  top  var(--ac-travel) cubic-bezier(0.25, 0.8, 0.25, 1),
                  opacity 0.25s;
      color: var(--ac-color);
      z-index: var(--dddk-z-cursor, 9800);
      opacity: 0;
      filter: drop-shadow(0 2px 6px rgba(0,0,0,0.25));
    }
    [${UI_ATTR}="agent-cursor"] svg { display: block; }
    [${UI_ATTR}="agent-cursor"] .ac-ring {
      position: absolute; inset: -8px;
      border: 2px solid var(--ac-color);
      border-radius: 50%;
      opacity: 0;
    }
    [${UI_ATTR}="agent-cursor"].clicking .ac-ring {
      animation: dddkAcClick 380ms ease-out;
    }
    @keyframes dddkAcClick {
      0%   { opacity: 0.8; transform: scale(0.4); }
      100% { opacity: 0;   transform: scale(1.5); }
    }
    [data-dddk-agent-target] {
      outline: 2px dashed var(--dddk-accent, #ec4899);
      outline-offset: 2px;
      transition: outline-color 0.2s;
    }
  `);
}
