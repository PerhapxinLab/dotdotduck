/** Click-anywhere / any-key dismiss for info subtitles. Action bars
 *  (have onAccept/onReject), streaming bars, persistent bars opt out
 *  — those need explicit accept/reject/× gestures. */

import type { SubtitleShowOptions } from '../../types';
import type { Subtitle } from './index';

/** IME guard. `keyCode === 229` is the spec value browsers fire for
 *  every keystroke during CJK candidate composition; combined with
 *  `isComposing` it stops space/esc/digit from being misrouted as
 *  bar dismissal. */
export function isImeComposing(e: KeyboardEvent): boolean {
  return e.isComposing || (e as KeyboardEvent & { keyCode?: number }).keyCode === 229;
}

export function isModifierKey(e: KeyboardEvent): boolean {
  return ['Control', 'Shift', 'Alt', 'Meta', 'Tab'].includes(e.key);
}

export function clearAutoHide(host: Subtitle): void {
  if (host._autoHideTimer) {
    clearTimeout(host._autoHideTimer);
    host._autoHideTimer = null;
  }
}

/** Click-outside / any-key dismiss. Action + streaming bars stay open
 *  on outside click so incidental clicks while the agent runs don't
 *  feel fragile. Space/Esc skip here — GestureManager owns them.
 *  120ms attach delay so the click that OPENED the bar doesn't
 *  immediately dismiss it. */
export function installInteractionDismiss(host: Subtitle, opts: SubtitleShowOptions): void {
  if (host._dismissTeardown) { host._dismissTeardown(); host._dismissTeardown = null; }
  // Persistent bars opt out of every passive dismiss — host has
  // declared the user MUST answer via accept/reject before closing.
  if (opts.persistent) return;
  const ac = new AbortController();
  setTimeout(() => {
    if (ac.signal.aborted) return;
    const onClick = (e: Event): void => {
      const target = e.target as Element | null;
      if (target && host._el && host._el.contains(target)) return;
      const hasAction = !!(host._currentOpts?.onAccept || host._currentOpts?.onReject);
      const isStreaming = host._el?.getAttribute('data-dddk-bar-mode') === 'streaming';
      if (hasAction || isStreaming) return;
      host._handleCloseClick();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (isModifierKey(e)) return;
      if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Escape') return;
      // Paged + action subtitles must NOT dismiss on arbitrary keys —
      // would close a multi-page translation mid-read.
      const isPaged = host._pages !== null && host._pages.length > 1;
      const hasAction = !!(host._currentOpts?.onAccept || host._currentOpts?.onReject);
      if (isPaged || hasAction) return;
      host.hide();
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    host._dismissTeardown = () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, 120);
  // hide() before listeners attach → abort the setTimeout so we don't leak.
  host._dismissTeardown = () => { ac.abort(); };
}
