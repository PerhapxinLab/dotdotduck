/** Touch-only helpers: tap-gesture binding (no Space key on phones)
 *  and the locale × bar-type hint table rendered below the text. */

import type { SubtitleShowOptions } from '../../types';
import { UI_ATTR } from '../../utils/dom';
import { sdkString } from '../../utils/sdk-i18n';
import type { Subtitle } from './index';

/** Requires BOTH touch capability AND coarse pointer, so a 2-in-1
 *  laptop in laptop mode still gets the keyboard hint. */
export function isTouchOnlyDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  if (!hasTouch) return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return hasTouch;
  }
}

/** Single click/tap → accept (= space), double click/tap → reject
 *  (= double space). v0.2.0: extended from touch-only to also handle
 *  mouse — users asked "clicking the subtitle should equal space".
 *  Interactive children (button / input / textarea / a / role="button"
 *  / close-×) still handle their own pointer events; the gesture only
 *  fires on the bare subtitle surface. */
export function bindTouchTapGestures(el: HTMLElement): void {
  let lastTapAt = 0;
  let singleTapTimer: ReturnType<typeof setTimeout> | null = null;
  const doubleTapMs = 320;
  el.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    // Interactive children handle themselves. The close × button is
    // matched via its data-dddk-ui="bar-close" attribute so the
    // selector doesn't have to know its tag.
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, a, [role="button"], [data-dddk-ui="bar-close"]')) return;
    const now = Date.now();
    if (now - lastTapAt < doubleTapMs) {
      if (singleTapTimer !== null) { clearTimeout(singleTapTimer); singleTapTimer = null; }
      lastTapAt = 0;
      document.dispatchEvent(new CustomEvent('dddk:bar-tap-reject'));
      return;
    }
    lastTapAt = now;
    singleTapTimer = setTimeout(() => {
      singleTapTimer = null;
      document.dispatchEvent(new CustomEvent('dddk:bar-tap-accept'));
    }, doubleTapMs);
  });
}

/** Hint line beneath the bar text. Explicit `opts.hints` wins, then a
 *  "press space to close" for decisionless info subtitles, then the
 *  locale × bar-type defaults table. Touch swaps keyboard hints for
 *  tap copy. Bundled `en` + `zh-TW`; other locales fall back to en. */
export function renderHints(host: Subtitle, opts: SubtitleShowOptions): string {
  if (opts.hints) return `<div ${UI_ATTR}="bar-hints">${opts.hints}</div>`;

  const isDecisionless = !opts.onAccept && !opts.onReject;
  if (isDecisionless && opts.type !== 'agent') {
    const text = sdkString(
      host._locale,
      isTouchOnlyDevice() ? 'agent.tap_to_dismiss' : 'agent.press_space_close',
    );
    return `<div ${UI_ATTR}="bar-hints">${text}</div>`;
  }

  const touch = isTouchOnlyDevice();
  const defaults: Record<string, Record<SubtitleShowOptions['type'], string>> = touch ? {
    'zh-TW': {
      voice: '點一下繼續 ｜ 雙擊結束',
      selection: '點一下接受 ｜ 雙擊拒絕',
      agent: '點一下繼續 ｜ 雙擊結束',
      post: '點一下接受 ｜ 雙擊拒絕',
      info: '點一下關閉',
    },
    en: {
      voice: 'tap to continue · double-tap to exit',
      selection: 'tap to accept · double-tap to reject',
      agent: 'tap to continue · double-tap to exit',
      post: 'tap to accept · double-tap to reject',
      info: 'tap to dismiss',
    },
  } : {
    'zh-TW': {
      voice: 'Tab 一行 ｜ space 同意 ｜ 兩下 space 拒絕',
      selection: 'space 接受 ｜ 兩下 space 拒絕',
      agent: 'space 下一步 ｜ 兩下 space 直接結束',
      post: 'space 接受 ｜ 兩下 space 拒絕',
      info: '按 space 關閉',
    },
    en: {
      voice: 'Tab line · space to accept · double space to reject',
      selection: 'space to accept · double space to reject',
      agent: 'space → next · double space → exit',
      post: 'space to accept · double space to reject',
      info: 'press space to close',
    },
  };
  const dict = defaults[host._locale] ?? defaults.en!;
  const text = dict[opts.type];
  return text ? `<div ${UI_ATTR}="bar-hints">${text}</div>` : '';
}
