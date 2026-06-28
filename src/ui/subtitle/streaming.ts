/**
 * Streaming bar — LLM tokens stream between tool calls into a live Text
 * node so the bar "types itself". Sentence-boundary TTS is auto-buffered
 * + flushed.
 */

import type { SubtitleShowOptions } from '../../types';
import { escapeHtml, UI_ATTR } from '../../utils/dom';
import { applyPlacement } from '../placement';
import { sdkString } from '../../utils/sdk-i18n';
import type { Subtitle } from './index';
import { ensureStyles } from './styles';
import { renderInlineMarkdown } from './markdown';
import { bindTouchTapGestures, isTouchOnlyDevice } from './touch';
import { installInteractionDismiss, clearAutoHide } from './dismiss';

export function appendStreamed(host: Subtitle, delta: string): void {
  if (typeof document === 'undefined' || !delta) return;
  ensureStreamingBar(host);
  // Strip `**bold**` markers — system prompt asks the LLM to skip
  // markdown, but smaller models still slip them in.
  const cleaned = delta.replace(/\*\*/g, '');
  if (host._streamingTextNode) {
    host._streamingTextNode.appendData(cleaned);
    host._streamingFullText += cleaned;
    autoScrollStream(host);
  }
  host._streamingTtsBuffer += cleaned;
  flushStreamingTts(host, false);
}

export function replaceStreamed(host: Subtitle, text: string): void {
  if (typeof document === 'undefined') return;
  flushStreamingTts(host, true);
  ensureStreamingBar(host);
  if (host._streamingTextNode) {
    host._streamingTextNode.data = text;
    host._streamingFullText = text;
  }
  host._streamingTtsBuffer = text;
  flushStreamingTts(host, false);
}

export function finalizeStreamed(host: Subtitle, opts?: { autoHide?: number }): void {
  flushStreamingTts(host, true);
  // Loop is done — drop queued indicator so a stale "Agent 執行中"
  // pip doesn't appear after the agent has ended.
  host._pendingIndicator = null;
  if (!host._el) return;
  // Empty stream → "press space to close" hint on an empty bar is noise.
  if (!host._streamingFullText.trim()) {
    host.hide();
    return;
  }
  host._el.setAttribute('data-dddk-bar-mode', 'streaming-done');
  if (host._streamingCursor) {
    host._streamingCursor.remove();
    host._streamingCursor = null;
  }
  // Run renderInlineMarkdown now (during streaming we used a raw Text
  // node — cheap, no parse per token) so lists / bold / inline code /
  // bare URLs all render properly on the finished message.
  const barText = host._el.querySelector<HTMLDivElement>(`[${UI_ATTR}="bar-text"]`);
  if (barText && host._streamingFullText) {
    barText.innerHTML = renderInlineMarkdown(host._streamingFullText);
  }
  const scroll = host._el.querySelector<HTMLDivElement>(`[${UI_ATTR}="bar-scroll"]`);
  if (scroll && !scroll.querySelector(`[${UI_ATTR}="bar-hints"]`)) {
    const hintEl = document.createElement('div');
    hintEl.setAttribute(UI_ATTR, 'bar-hints');
    hintEl.textContent = sdkString(host._locale, 'agent.press_space_close');
    scroll.appendChild(hintEl);
  }
  const dismissOpts: SubtitleShowOptions = { text: host._streamingFullText, type: 'agent' };
  host._currentOpts = dismissOpts;
  installInteractionDismiss(host, dismissOpts);
  const autoHideMs = opts?.autoHide;
  if (typeof autoHideMs === 'number' && autoHideMs > 0) {
    clearAutoHide(host);
    host._autoHideTimer = setTimeout(() => host.hide(), autoHideMs);
  }
}

export function clearStreamed(host: Subtitle): void {
  flushStreamingTts(host, true);
  host._streamingTextNode = null;
  host._streamingCursor = null;
  host._streamingFullText = '';
  host._streamingTtsBuffer = '';
  host.hide();
}

export function applyStreamingPauseHint(
  host: Subtitle,
  opts: { hint: string; rejectHint?: string; onAccept: () => void; onReject: () => void },
): void {
  if (!host._el) return;
  host.clearStreamingPauseHint();
  // Halt the cursor — agent paused, not "still typing".
  if (host._streamingCursor) {
    host._streamingCursor.style.opacity = '0.35';
    host._streamingCursor.style.animation = 'none';
  }
  const scroll = host._el.querySelector<HTMLDivElement>(`[${UI_ATTR}="bar-scroll"]`);
  if (!scroll) return;
  const hintEl = document.createElement('div');
  hintEl.setAttribute(UI_ATTR, 'streaming-pause');
  // Dedupe: many callers pass the gesture-hint string as `opts.hint`
  // (because that's what the agent's pauseHandler propagates), then
  // the rejectHint fallback resolves to the same i18n key — same
  // string rendered TWICE stacked. Skip the upper "text" div when it
  // matches the lower "hints" string.
  const rejectHint = opts.rejectHint ?? defaultPauseRejectHint(host);
  const showText = opts.hint && opts.hint.trim() !== rejectHint.trim();
  hintEl.innerHTML = `
    ${showText ? `<div ${UI_ATTR}="streaming-pause-text">${escapeHtml(opts.hint)}</div>` : ''}
    <div ${UI_ATTR}="streaming-pause-hints">${escapeHtml(rejectHint)}</div>
  `;
  scroll.appendChild(hintEl);
  autoScrollStream(host);
  host._streamingPauseAccept = opts.onAccept;
  host._streamingPauseReject = opts.onReject;
}

export function clearStreamingPauseHint(host: Subtitle): void {
  if (!host._el) return;
  const hintEl = host._el.querySelector(`[${UI_ATTR}="streaming-pause"]`);
  if (hintEl) hintEl.remove();
  host._streamingPauseAccept = null;
  host._streamingPauseReject = null;
  if (host._streamingCursor) {
    host._streamingCursor.style.opacity = '';
    host._streamingCursor.style.animation = '';
  }
}

function defaultPauseRejectHint(host: Subtitle): string {
  return sdkString(
    host._locale,
    isTouchOnlyDevice() ? 'agent.tap_to_continue' : 'agent.space_continue_reject',
  );
}

/** Pin scroll to bottom as text streams in — unless the user has
 *  scrolled up to re-read; leave them where they are then. */
export function autoScrollStream(host: Subtitle): void {
  if (!host._el) return;
  const scroll = host._el.querySelector<HTMLDivElement>(`[${UI_ATTR}="bar-scroll"]`);
  if (!scroll) return;
  const distFromBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
  if (distFromBottom < 80) scroll.scrollTop = scroll.scrollHeight;
}

export function ensureStreamingBar(host: Subtitle): void {
  if (host._streamingTextNode && host._el?.getAttribute('data-dddk-bar-mode') === 'streaming') return;

  ensureStyles();

  if (host._indicator) {
    host._indicator.remove();
    host._indicator = null;
    host._pendingIndicator = null;
  }
  if (host._dismissTeardown) { host._dismissTeardown(); host._dismissTeardown = null; }
  clearAutoHide(host);

  const wasVisible = host._el !== null;
  if (!host._el) {
    host._el = document.createElement('div');
    host._el.setAttribute(UI_ATTR, 'bar');
    applyPlacement(host._el, 'subtitle');
    document.body.appendChild(host._el);
    bindTouchTapGestures(host._el);
  }
  host._el.setAttribute('data-dddk-bar-type', 'agent');
  host._el.setAttribute('data-dddk-bar-mode', 'streaming');

  host._el.innerHTML = host._wrapBarShell(`<div ${UI_ATTR}="bar-text"></div>`);
  host._wireClose();

  const textWrap = host._el.querySelector<HTMLDivElement>(`[${UI_ATTR}="bar-text"]`);
  if (!textWrap) return;
  const textNode = document.createTextNode('');
  const cursor = document.createElement('span');
  cursor.setAttribute(UI_ATTR, 'streaming-cursor');
  cursor.textContent = '▍';
  textWrap.appendChild(textNode);
  textWrap.appendChild(cursor);

  host._streamingTextNode = textNode;
  host._streamingCursor = cursor;
  host._streamingFullText = '';
  host._streamingTtsBuffer = '';
  host._currentOpts = null;
  document.body.dataset.dddkActive = 'true';
  if (!wasVisible) host._onVisibilityChange?.(true);
}

/** Flush buffered text through TTS at sentence boundaries
 *  (`。 . ！ ! ？ ? \n`). `force = true` flushes whatever's left
 *  regardless. Non-forced mode requires buffer length ≥ 80 to avoid
 *  choppy mid-clause reads. */
export function flushStreamingTts(host: Subtitle, force: boolean): void {
  if (!host._ttsProvider) {
    host._streamingTtsBuffer = '';
    return;
  }
  const buf = host._streamingTtsBuffer;
  if (!buf) return;

  if (force) {
    try { host._ttsProvider(buf, { locale: host._locale, type: 'agent' }); } catch { /* swallow */ }
    host._streamingTtsBuffer = '';
    return;
  }

  const SENTENCE_END = /[。．.！!？?\n]/g;
  let lastIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END.exec(buf)) !== null) lastIdx = m.index;
  if (lastIdx < 0) {
    if (buf.length < 80) return;
    // No punctuation but buffer is long — cut at closest whitespace
    // (less likely to break a word) or flush whole.
    const ws = buf.lastIndexOf(' ');
    const cut = ws > 30 ? ws + 1 : buf.length;
    const head = buf.slice(0, cut);
    host._streamingTtsBuffer = buf.slice(cut);
    try { host._ttsProvider(head, { locale: host._locale, type: 'agent' }); } catch { /* swallow */ }
    return;
  }
  const head = buf.slice(0, lastIdx + 1);
  host._streamingTtsBuffer = buf.slice(lastIdx + 1);
  try { host._ttsProvider(head, { locale: host._locale, type: 'agent' }); } catch { /* swallow */ }
}
