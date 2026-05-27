/**
 * PanelRuntime — runtime support for `PanelSkill`.
 *
 * Renders a "top input + bottom panel" overlay separate from the regular
 * CommandPalette. Manages a navigation stack so Esc/Backspace pop frames
 * instead of closing entirely. Breadcrumbs at the top let users jump back
 * any level.
 *
 * This is a minimal DOM implementation — the goal is to make PanelSkill
 * executable end-to-end. Hosts wanting deep UI customization can replace it
 * by listening to `panel_enter` / `panel_input` / `panel_action` events.
 */

import type { PanelSkill, PanelSkillContext } from '../skills/types';
import { ensurePaletteStyles, UI_ATTR } from './command-palette/styles';

type StackFrame = {
  skill: PanelSkill;
  input: string;
  currentSurface: unknown | null;
};

export interface PanelRuntimeHost {
  /** Called when user submits an action — usually a button click in the rendered surface. */
  llm?: (prompt: string) => Promise<string>;
  navigate: (path: string) => void;
  /** Render a PieceSurface into a host-provided DOM container. */
  renderPiece?: (container: HTMLElement, surface: unknown, onAction: (action: string, data: unknown) => void) => void;
}

export interface PanelRuntimeOptions {
  host: PanelRuntimeHost;
  /** Debounce ms for onInput. Default 200ms. */
  inputDebounceMs?: number;
}

export class PanelRuntime {
  private stack: StackFrame[] = [];
  private overlay: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private breadcrumbEl: HTMLElement | null = null;
  private contentEl: HTMLDivElement | null = null;
  private inputTimer: ReturnType<typeof setTimeout> | null = null;
  private host: PanelRuntimeHost;
  private debounceMs: number;

  constructor(opts: PanelRuntimeOptions) {
    this.host = opts.host;
    this.debounceMs = opts.inputDebounceMs ?? 200;
  }

  /** Push a panel skill onto the stack and render. */
  async enter(skill: PanelSkill): Promise<void> {
    if (!this.overlay) this.mount();
    const frame: StackFrame = { skill, input: '', currentSurface: null };
    this.stack.push(frame);
    this.renderShell();
    if (skill.onEnter) {
      const ctx = this.makeContext(frame);
      await skill.onEnter(ctx);
    }
  }

  /** Pop the top frame. Closes the overlay if stack empties. */
  async back(): Promise<void> {
    const popped = this.stack.pop();
    if (popped?.skill.onLeave) await popped.skill.onLeave();
    if (this.stack.length === 0) {
      this.unmount();
    } else {
      this.renderShell();
    }
  }

  /** Close everything. */
  async close(): Promise<void> {
    while (this.stack.length > 0) {
      const popped = this.stack.pop()!;
      if (popped.skill.onLeave) await popped.skill.onLeave();
    }
    this.unmount();
  }

  isOpen(): boolean {
    return this.stack.length > 0;
  }

  stackDepth(): number {
    return this.stack.length;
  }

  // ── DOM management ─────────────────────────────────────────────

  private mount(): void {
    ensurePaletteStyles();

    // Visually identical to the CommandPalette — same overlay, card,
    // input row, result area, close button. The user perceives the
    // transition palette → panel skill as the same window changing
    // content, not a separate modal popping over with a different
    // shape. The single visual differentiator is the BACK button
    // tucked inside the input row when the panel stack is deeper
    // than one, which signals "you're in a sub-view, esc returns".
    const overlay = document.createElement('div');
    overlay.setAttribute(UI_ATTR, 'palette-backdrop');
    overlay.setAttribute('data-dddk-panel', 'true');

    const card = document.createElement('div');
    card.setAttribute(UI_ATTR, 'palette');

    // Input row — same as palette, with optional back arrow on the
    // left side AND the standard × close button on the right.
    const inputRow = document.createElement('div');
    inputRow.setAttribute(UI_ATTR, 'palette-input-row');

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.setAttribute(UI_ATTR, 'panel-back');
    backBtn.setAttribute('aria-label', 'Back');
    backBtn.innerHTML = '←';
    backBtn.addEventListener('click', () => { void this.back(); });
    this.breadcrumbEl = backBtn; // reusing the field as the back-button ref

    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute(UI_ATTR, 'palette-input');
    input.addEventListener('input', this.handleInput);
    input.addEventListener('keydown', this.handleKeyDown);
    this.inputEl = input;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute(UI_ATTR, 'panel-close');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => { void this.close(); });

    inputRow.appendChild(backBtn);
    inputRow.appendChild(input);
    inputRow.appendChild(closeBtn);

    // Content area — host's surface paints here. Uses `palette-result`
    // so the panel-surface utility classes (.dddk-panel-*) compose
    // naturally with zero extra padding wrappers.
    const content = document.createElement('div');
    content.setAttribute(UI_ATTR, 'palette-result');
    this.contentEl = content;

    card.appendChild(inputRow);
    card.appendChild(content);
    overlay.appendChild(card);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) void this.close();
    });

    document.body.appendChild(overlay);
    this.overlay = overlay;
    setTimeout(() => input.focus(), 0);
  }

  private unmount(): void {
    if (this.inputTimer) clearTimeout(this.inputTimer);
    this.inputTimer = null;
    this.overlay?.remove();
    this.overlay = null;
    this.inputEl = null;
    this.breadcrumbEl = null;
    this.contentEl = null;
  }

  private renderShell(): void {
    if (!this.inputEl) return;
    // Show the back arrow only when there's somewhere to go back to.
    // For the top-level panel, hide it — the × button takes care of
    // dismissal. This keeps the input row chrome quiet when there's
    // no navigation history.
    if (this.breadcrumbEl) {
      (this.breadcrumbEl as HTMLElement).style.display = this.stack.length > 1 ? '' : 'none';
    }
    const top = this.stack[this.stack.length - 1];
    this.inputEl.placeholder = top?.skill.inputPlaceholder ?? '';
    this.inputEl.value = top?.input ?? '';
    this.inputEl.focus();
    if (top?.currentSurface) this.renderSurface(top.currentSurface);
    else this.clearContent();
  }

  private renderSurface(surface: unknown): void {
    if (!this.contentEl) return;
    this.contentEl.innerHTML = '';
    if (this.host.renderPiece) {
      this.host.renderPiece(this.contentEl, surface, (action, data) =>
        this.handleAction(action, data)
      );
      return;
    }
    // Fallback: render JSON-stringified preview if no host renderer.
    this.contentEl.appendChild(this.fallbackRender(surface));
  }

  private clearContent(): void {
    if (!this.contentEl) return;
    this.contentEl.innerHTML = '';
  }

  private fallbackRender(node: unknown): HTMLElement {
    const root = (node as { root?: unknown })?.root ?? node;
    return this.renderNode(root);
  }

  private renderNode(node: unknown): HTMLElement {
    const n = node as { kind?: string; text?: string; children?: unknown[]; action?: string; data?: unknown };
    const el = document.createElement('div');
    if (!n || typeof n !== 'object') {
      el.textContent = String(node);
      return el;
    }
    switch (n.kind) {
      case 'Stack':
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.gap = '8px';
        break;
      case 'Row':
        el.style.display = 'flex';
        el.style.flexDirection = 'row';
        el.style.gap = '8px';
        el.style.alignItems = 'center';
        break;
      case 'Card':
        el.style.border = '1px solid var(--dddk-border, rgba(0,0,0,0.08))';
        el.style.borderRadius = '8px';
        el.style.padding = '10px 12px';
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.gap = '6px';
        break;
      case 'Heading':
        el.style.fontWeight = '600';
        el.style.fontSize = '14px';
        el.textContent = n.text ?? '';
        break;
      case 'Text':
        el.textContent = n.text ?? '';
        el.style.fontSize = '13px';
        break;
      case 'Markdown':
        el.textContent = n.text ?? '';
        el.style.whiteSpace = 'pre-wrap';
        el.style.fontSize = '13px';
        break;
      case 'Tag':
        el.textContent = n.text ?? '';
        el.style.padding = '2px 8px';
        el.style.borderRadius = '10px';
        el.style.background = 'rgba(0,0,0,0.06)';
        el.style.fontSize = '11px';
        el.style.display = 'inline-block';
        break;
      case 'Button': {
        const btn = document.createElement('button');
        btn.textContent = n.text ?? '';
        Object.assign(btn.style, {
          padding: '4px 10px',
          fontSize: '12px',
          borderRadius: '6px',
          border: '1px solid var(--dddk-border, rgba(0,0,0,0.12))',
          background: 'transparent',
          cursor: 'pointer',
          color: 'inherit',
        });
        btn.addEventListener('click', () => {
          if (n.action) this.handleAction(n.action, n.data);
        });
        return btn;
      }
    }
    if (Array.isArray(n.children)) {
      for (const c of n.children) el.appendChild(this.renderNode(c));
    } else if (n.text) {
      el.textContent = n.text;
    }
    return el;
  }

  // ── Event handlers ─────────────────────────────────────────────

  private handleInput = (): void => {
    const top = this.stack[this.stack.length - 1];
    if (!top || !this.inputEl) return;
    top.input = this.inputEl.value;
    if (this.inputTimer) clearTimeout(this.inputTimer);
    this.inputTimer = setTimeout(async () => {
      const ctx = this.makeContext(top);
      await top.skill.onInput(top.input, ctx);
    }, this.debounceMs);
  };

  private handleKeyDown = async (e: KeyboardEvent): Promise<void> => {
    const top = this.stack[this.stack.length - 1];
    if (!top || !this.inputEl) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      await this.back();
      return;
    }
    if (e.key === 'Backspace' && this.inputEl.value === '') {
      e.preventDefault();
      await this.back();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (top.skill.onSubmit) {
        const ctx = this.makeContext(top);
        await top.skill.onSubmit(this.inputEl.value, ctx);
      }
    }
  };

  private async handleAction(action: string, data: unknown): Promise<void> {
    const top = this.stack[this.stack.length - 1];
    if (!top || !top.skill.onAction) return;
    const ctx = this.makeContext(top);
    await top.skill.onAction(action, data, ctx);
  }

  private makeContext(frame: StackFrame): PanelSkillContext {
    return {
      palette: { close: () => this.close(), replace: () => {} },
      subtitle: { show: () => {}, hide: () => {} },
      storage: { get: () => null, set: () => {} },
      getPreferences: () => ({}) as never,
      llm: this.host.llm,
      navigate: (path: string) => this.host.navigate(path),
      render: (surface: unknown) => {
        frame.currentSurface = surface;
        this.renderSurface(surface);
      },
      back: () => void this.back(),
      setPlaceholder: (text: string) => {
        if (this.inputEl) this.inputEl.placeholder = text;
      },
    };
  }
}
