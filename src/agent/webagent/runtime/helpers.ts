/**
 * Module-level pure helpers shared across the WebAgent runtime.
 * No reference to the WebAgent instance — anything that needs `this`
 * lives in loops.ts / messages.ts.
 */

import type { LLMMessage } from '../../llm/types';
import type { AgentEvent, AgentTurn } from '../types';
import { sdkString } from '../../../utils/sdk-i18n';

/** Coarse chars-per-token approximation across mixed CJK + English.
 *  Used only to decide which turn to drop in the budget walk. */
export const CHARS_PER_TOKEN = 3.5;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function* emptyStream(): AsyncIterable<AgentEvent> {
  return;
}

export function extractTargetSelector(params: Record<string, unknown>): string | undefined {
  for (const key of ['selector', 'target', 'element']) {
    const v = params[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

export function composeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  const onA = (): void => ctrl.abort(a.reason);
  const onB = (): void => ctrl.abort(b.reason);
  if (a.aborted) ctrl.abort(a.reason);
  else a.addEventListener('abort', onA, { once: true });
  if (b.aborted) ctrl.abort(b.reason);
  else b.addEventListener('abort', onB, { once: true });
  return ctrl.signal;
}

/** Scan the message array for any image content part — used to route to
 *  the `vision` provider. */
export function messageContentHasImage(messages: LLMMessage[]): boolean {
  for (const m of messages) {
    if (typeof m.content === 'string') continue;
    for (const part of m.content) {
      if (part.type === 'image') return true;
    }
  }
  return false;
}

/** Cost estimate for one session turn, used by the token-budget
 *  truncation in buildMessages. Image content parts get a flat
 *  ~3500 char (≈1000 token) charge as a safe upper bound. */
export function estimateTurnChars(t: AgentTurn): number {
  if (t.kind === 'user') {
    let n = t.text.length;
    if (t.selection?.text) n += t.selection.text.length;
    if (t.selection?.elements) n += t.selection.elements.join(' ').length;
    if (t.selection?.images) n += t.selection.images.length * 3500;
    return n + 50;
  }
  if (t.kind === 'agent_step') {
    return (t.preText?.length ?? 0)
      + JSON.stringify(t.toolCall.arguments).length
      + JSON.stringify(t.result).length
      + 200;
  }
  if (t.kind === 'agent_final') return t.text.length + 20;
  return 0;
}

/** `true` when the user currently has focus on an editable surface inside
 *  the open command palette. CoT auto-pause skips the Space gate here
 *  because the space-gesture handler treats Space inside palette inputs
 *  as literal typing — the pause watcher would never resolve. Scope is
 *  palette-only; page-level form fields still gate normally. */
export function isUserEditingInPalette(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
  if (!isEditable) return false;
  return !!el.closest('[data-dddk-ui="palette"]');
}

/**
 * Wait for an SPA navigation to "settle" — both the URL has changed AND
 * the DOM has stopped mutating for a short idle window. Required because
 * `readDOM` on the next turn often reads the OLD page or a half-rendered
 * new page (just the route shell) — surfaces as "I only see the title,
 * no content".
 */
export async function awaitNavSettle(maxMs: number): Promise<void> {
  if (typeof window === 'undefined') return;
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    await new Promise<void>((r) => setTimeout(r, Math.min(maxMs, 1200)));
    return;
  }
  const idleMs = 250;
  await new Promise<void>((resolve) => {
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (idleTimer !== null) clearTimeout(idleTimer);
      clearTimeout(hardCap);
      resolve();
    };
    const resetIdle = (): void => {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, idleMs);
    };
    const observer = new MutationObserver(resetIdle);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const hardCap = setTimeout(finish, maxMs);
    resetIdle();
  });
  await new Promise<void>((r) => {
    if (typeof requestAnimationFrame === 'undefined') return r();
    requestAnimationFrame(() => r());
  });
}

/**
 * SDK-default confirmation copy for built-in actions. Bundled in
 * en + zh-TW; other locales fall back to en. Hosts override at the
 * config level via `buildConfirmMessage` or per-action via
 * `ActionDefinition.confirmationMessage`.
 */
export function narrateAction(
  actionName: string,
  params: Record<string, unknown>,
  locale: string,
): string {
  const str = (k: string): string => (typeof params[k] === 'string' ? (params[k] as string) : '');
  const trim = (s: string, n = 40): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const path = trim(str('path'), 50);
  const target = trim(str('selector') || str('target') || str('element'), 50);
  const suffix = ` ${sdkString(locale, 'agent.confirm.suffix')}`;
  switch (actionName) {
    case 'navigate':
      return (path
        ? sdkString(locale, 'agent.confirm.navigate.with_path', { path })
        : sdkString(locale, 'agent.confirm.navigate.no_path')) + suffix;
    case 'click':
      return (target
        ? sdkString(locale, 'agent.confirm.click.with_target', { target })
        : sdkString(locale, 'agent.confirm.click.no_target')) + suffix;
    case 'fill_input':
      return (target
        ? sdkString(locale, 'agent.confirm.fill_input.with_target', { target })
        : sdkString(locale, 'agent.confirm.fill_input.no_target')) + suffix;
    case 'delete':
      return (target
        ? sdkString(locale, 'agent.confirm.delete.with_target', { target })
        : sdkString(locale, 'agent.confirm.delete.no_target')) + suffix;
    default:
      return (target
        ? sdkString(locale, 'agent.confirm.generic.with_target', { action: actionName, target })
        : sdkString(locale, 'agent.confirm.generic.no_target', { action: actionName })) + suffix;
  }
}
