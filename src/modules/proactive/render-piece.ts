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
    let piece: PieceSurface;
    if (surface.pieces) {
      // Host supplied a rich tree — pass it through unchanged. The
      // surface decides its own interaction shape (OptionGroup of
      // MediaCards, a confirm card, whatever). Non-`yes`/`no` actions
      // map to `dismiss` for the standard 3-way response; the host
      // captures the actual pick via analytics on the piece's data
      // model or by listening for the `choose` intent separately.
      piece = surface.pieces as PieceSurface;
    } else {
      // Default yes/no card. Was previously using a non-existent `Row`
      // piece; switched to `Stack { direction: 'horizontal' }` which IS
      // in the builtin catalog. Card stays as the visible envelope.
      const text = typeof surface.text === 'function' ? surface.text(ctx ?? { now: Date.now() }) : surface.text;
      piece = {
        root: {
          kind: 'Card',
          children: [
            { kind: 'Text', text },
            {
              kind: 'Stack',
              direction: 'horizontal',
              gap: 8,
              children: [
                { kind: 'Button', text: surface.yesLabel ?? 'Yes', action: 'yes', shortcut: keys.yes },
                { kind: 'Button', text: surface.noLabel ?? 'No', action: 'no', shortcut: keys.no, variant: 'secondary' },
                ...(surface.dismissable !== false
                  ? [{ kind: 'Button', text: '×', action: 'dismiss', shortcut: keys.dismiss, variant: 'secondary' }]
                  : []),
              ],
            },
          ],
        },
      };
    }
    try {
      const result = await opts.mount(piece, {
        placement: surface.placement ?? 'inline',
        timeoutMs: surface.autoTimeoutMs,
      });
      if (result.action === 'yes' || result.action === 'no' || result.action === 'dismiss') return result.action;
      // Any other action (e.g. `choose` from OptionGroup) — treat as a
      // positive engagement (the user picked something), distinct from
      // dismiss/no. Map to `yes` so the prompt's onResponse hook fires
      // with a positive signal; host inspects `result.data` for the
      // actual pick.
      return 'yes';
    } catch {
      return 'dismiss';
    }
  };
}
