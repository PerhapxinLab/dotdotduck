/**
 * Bridge between `Proactive` and dddk's PieceSurface render system.
 *
 * Usage:
 *   const proactive = createProactive({
 *     render: createPieceRender({ mount: dddk.mountSurface, locale: 'zh-TW' }),
 *   });
 *
 * The host supplies a `mount` function — anything that takes a PieceSurface and resolves
 * the user's response ('yes' | 'no' | 'dismiss').
 */

import type { PromptDefinition, PromptSurface, TriggerContext } from './index.js';

export type PieceNode = {
  kind: string;
  text?: string;
  action?: string;
  shortcut?: string;
  children?: PieceNode[];
  [k: string]: unknown;
};

export type PieceSurface = {
  root: PieceNode;
  data?: Record<string, unknown>;
};

export type SurfaceMountFn = (
  surface: PieceSurface,
  opts: { placement?: 'inline' | 'dock' | 'modal'; timeoutMs?: number }
) => Promise<{ action: string; data?: Record<string, unknown> }>;

export function createPieceRender(opts: {
  mount: SurfaceMountFn;
  locale?: string;
  keys?: { yes?: string; no?: string; dismiss?: string };
}): (prompt: PromptDefinition, surface: PromptSurface, ctx?: TriggerContext) => Promise<'yes' | 'no' | 'dismiss'> {
  const keys = { yes: 'Space', no: 'Space:double', dismiss: 'Escape', ...(opts.keys ?? {}) };
  return async (_prompt, surface, ctx) => {
    const text = typeof surface.text === 'function' ? surface.text(ctx ?? { now: Date.now() }) : surface.text;
    const piece: PieceSurface = {
      root: {
        kind: 'Card',
        children: [
          { kind: 'Text', text },
          {
            kind: 'Row',
            children: [
              { kind: 'Button', text: surface.yesLabel ?? 'Yes', action: 'yes', shortcut: keys.yes },
              { kind: 'Button', text: surface.noLabel ?? 'No', action: 'no', shortcut: keys.no },
              ...(surface.dismissable !== false
                ? [{ kind: 'Button', text: '×', action: 'dismiss', shortcut: keys.dismiss }]
                : []),
            ],
          },
        ],
      },
    };
    try {
      const result = await opts.mount(piece, {
        placement: surface.placement ?? 'inline',
        timeoutMs: surface.autoTimeoutMs,
      });
      if (result.action === 'yes' || result.action === 'no' || result.action === 'dismiss') return result.action;
      return 'dismiss';
    } catch {
      return 'dismiss';
    }
  };
}
