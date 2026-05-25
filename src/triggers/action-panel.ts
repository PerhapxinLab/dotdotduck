/**
 * ActionPanel — typed action system for palette items.
 *
 * Each palette result can carry multiple actions:
 *  - primary (⏎)         — the first action, runs on Enter
 *  - secondary (Ctrl+⏎)  — the second action
 *  - others (Ctrl+K)     — opens a sub-panel listing the rest
 *
 * Actions are typed so the palette renders the right icon and handles the
 * right side-effect (copy, open URL, navigate, run skill, …) without each
 * command author re-implementing them.
 */

export type PaletteAction =
  | CopyAction
  | InsertAction
  | OpenUrlAction
  | NavigateAction
  | AgentTaskAction
  | RenderSurfaceAction
  | RunSkillAction
  | CustomAction;

interface ActionShared {
  /** Display title shown in the panel. */
  title: string;
  /** Optional icon (emoji or icon name). */
  icon?: string;
  /** Keyboard shortcut hint — display only, doesn't bind. */
  shortcut?: string;
  /** Mark as destructive — renders red, requires confirmation by default. */
  destructive?: boolean;
}

export interface CopyAction extends ActionShared {
  kind: 'copy';
  content: string;
  /** True to redact from clipboard history hooks. Default false. */
  concealed?: boolean;
}

export interface InsertAction extends ActionShared {
  kind: 'insert';
  /** Text to insert into the active input / contenteditable on the page. */
  text: string;
}

export interface OpenUrlAction extends ActionShared {
  kind: 'open-url';
  url: string;
  /** Open in same tab vs new (default 'new'). */
  target?: 'self' | 'new';
}

export interface NavigateAction extends ActionShared {
  kind: 'navigate';
  /** SPA path — host's `onNavigate` is invoked. */
  path: string;
}

export interface AgentTaskAction extends ActionShared {
  kind: 'agent-task';
  task: string;
}

export interface RenderSurfaceAction extends ActionShared {
  kind: 'render-surface';
  surface: unknown; // PieceSurface
  placement?: import('../skills/types').SurfacePlacement;
}

export interface RunSkillAction extends ActionShared {
  kind: 'run-skill';
  skillId: string;
  vars?: Record<string, string>;
}

export interface CustomAction extends ActionShared {
  kind: 'custom';
  /** Arbitrary handler — escape hatch for things outside the typed kinds. */
  onActivate: (ctx: ActionRunContext) => void | Promise<void>;
}

export interface ActionRunContext {
  navigate(path: string): void;
  startAgent(task: string): void;
  runSkill(skillId: string, vars?: Record<string, string>): void;
  emitSurface(surface: unknown, placement?: import('../skills/types').SurfacePlacement): void;
}

// ─── runner ────────────────────────────────────────────────────────

export async function runAction(
  action: PaletteAction,
  ctx: ActionRunContext
): Promise<void> {
  switch (action.kind) {
    case 'copy':
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(action.content);
      }
      break;
    case 'insert': {
      const el = document.activeElement as HTMLElement | null;
      if (!el) break;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        const input = el as HTMLInputElement | HTMLTextAreaElement;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.value = input.value.slice(0, start) + action.text + input.value.slice(end);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (el.isContentEditable) {
        document.execCommand('insertText', false, action.text);
      }
      break;
    }
    case 'open-url':
      if (typeof window !== 'undefined') {
        window.open(action.url, action.target === 'self' ? '_self' : '_blank');
      }
      break;
    case 'navigate':
      ctx.navigate(action.path);
      break;
    case 'agent-task':
      ctx.startAgent(action.task);
      break;
    case 'render-surface':
      ctx.emitSurface(action.surface, action.placement);
      break;
    case 'run-skill':
      ctx.runSkill(action.skillId, action.vars);
      break;
    case 'custom':
      await action.onActivate(ctx);
      break;
  }
}

export function defaultIconFor(kind: PaletteAction['kind']): string {
  // Monochrome Unicode glyphs only — never multi-color emoji (per user UI
  // memo). These map cleanly to the dddk icon style across both themes.
  switch (kind) {
    case 'copy': return '⎘';
    case 'insert': return '↩︎';
    case 'open-url': return '⇗';
    case 'navigate': return '→';
    case 'agent-task': return '✦';
    case 'render-surface': return '⊟';
    case 'run-skill': return '▸';
    case 'custom': return '·';
  }
}
