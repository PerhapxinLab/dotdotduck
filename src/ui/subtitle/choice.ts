/**
 * Multi-choice subtitle bar — question + numbered options + optional
 * free-text input. Mirrors Claude Code's AskUserQuestion envelope into
 * the subtitle slot.
 */

import type { SubtitleChoiceOptions } from '../../types';
import { escapeHtml, UI_ATTR } from '../../utils/dom';
import { applyPlacement } from '../placement';
import type { Subtitle } from './index';
import { ensureStyles } from './styles';
import { renderInlineMarkdown } from './markdown';
import { bindTouchTapGestures } from './touch';
import { clearAutoHide, isImeComposing, isModifierKey } from './dismiss';

export function showChoice(host: Subtitle, opts: SubtitleChoiceOptions): void {
  if (typeof document === 'undefined') return;
  ensureStyles();
  clearAutoHide(host);

  const allowFreeText = opts.allowFreeText !== false;
  const freeTextLabel =
    opts.freeTextLabel ??
    (host._locale === 'zh-TW' ? '其他 (按 Enter 送出)' : 'Other (press Enter)');

  const wasVisible = host._el !== null;
  if (!host._el) {
    host._el = document.createElement('div');
    host._el.setAttribute(UI_ATTR, 'bar');
    applyPlacement(host._el, 'subtitle');
    document.body.appendChild(host._el);
    bindTouchTapGestures(host._el);
  }
  if (!wasVisible) host._onVisibilityChange?.(true);

  // Route every negative gesture (Esc, double-tap, single-tap Space)
  // to onCancel — a choice bar with nothing focused-by-default must
  // not auto-pick option 1 on bare Space tap.
  const cancelPath = (): void => {
    const cb = opts.onCancel;
    host.hide();
    cb?.();
  };
  host._currentOpts = {
    text: opts.question,
    type: 'agent',
    onCancel: cancelPath,
    onReject: cancelPath,
  };
  host._el.setAttribute('data-dddk-bar-type', 'agent');
  host._el.setAttribute('data-dddk-bar-mode', 'choice');

  const optionsHtml = opts.options
    .map((label, i) => {
      const safe = escapeHtml(label);
      return `<button ${UI_ATTR}="choice-row" data-dddk-action="choose" data-choice-index="${i}">
        <kbd ${UI_ATTR}="choice-key">${i + 1}</kbd>
        <span ${UI_ATTR}="choice-label">${safe}</span>
      </button>`;
    })
    .join('');

  const freeTextHtml = allowFreeText
    ? `<div ${UI_ATTR}="choice-freetext">
        <input type="text" ${UI_ATTR}="choice-input" placeholder="${escapeHtml(freeTextLabel)}" />
      </div>`
    : '';

  const hintText = host._locale === 'zh-TW'
    ? `按數字鍵選 ｜ 點擊也可以 ｜ esc 取消${allowFreeText ? ' ｜ Other 區可以直接打字' : ''}`
    : `digit to pick · click works too · esc cancels${allowFreeText ? ' · type into Other to free-text' : ''}`;

  host._el.innerHTML = host._wrapBarShell(`
    <div ${UI_ATTR}="bar-text">${renderInlineMarkdown(opts.question)}</div>
    <div ${UI_ATTR}="choice-list">${optionsHtml}</div>
    ${freeTextHtml}
    <div ${UI_ATTR}="bar-hints">${hintText}</div>
  `);

  wireChoice(host, opts, allowFreeText);
  host._wireClose();
  document.body.dataset.dddkActive = 'true';

  if (host._ttsProvider) {
    try { host._ttsProvider(opts.question, { locale: host._locale, type: 'agent' }); }
    catch { /* swallow */ }
  }

  const DEFAULT_AUTO_HIDE = 0;
  const autoHideMs = opts.autoHide ?? DEFAULT_AUTO_HIDE;
  if (autoHideMs > 0) {
    host._autoHideTimer = setTimeout(() => host.hide(), autoHideMs);
  }

  installChoiceDismiss(host, opts);
}

/** Choice-specific dismiss — Esc fires onCancel here (GestureManager's
 *  Esc handler doesn't know about the picker's onCancel); free-text
 *  input keys never dismiss. */
export function installChoiceDismiss(host: Subtitle, opts: SubtitleChoiceOptions): void {
  if (host._dismissTeardown) { host._dismissTeardown(); host._dismissTeardown = null; }
  const ac = new AbortController();
  setTimeout(() => {
    if (ac.signal.aborted) return;
    const cancelAndHide = (): void => {
      const cb = opts.onCancel;
      host.hide();
      cb?.();
      // Treat outside-dismiss as cancel — also stop the agent loop +
      // clear the thinking indicator. Same path as the × button.
      host._closeHandler?.();
    };
    const onClick = (e: Event): void => {
      const target = e.target as Element | null;
      if (target && host._el && host._el.contains(target)) return;
      cancelAndHide();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (isImeComposing(e)) return;
      if (isModifierKey(e)) return;
      // Space owned by the gesture manager — bailing keeps Chinese
      // typing in the input intact and lets double-tap land on
      // invokeReject → cancelPath.
      if (e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space') return;
      const target = e.target as Element | null;
      if (target && host._el && host._el.contains(target)) return;
      if (e.key === 'Escape') { e.preventDefault(); cancelAndHide(); return; }
      // 1-9 digits are wired in wireChoice for option selection.
      if (/^[1-9]$/.test(e.key)) return;
      cancelAndHide();
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    host._dismissTeardown = () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, 120);
  host._dismissTeardown = () => { ac.abort(); };
}

/** Wire 1-N digit keys + click rows + Enter-in-free-text. Document-
 *  level capture-phase keydown catches digits even when focus is
 *  elsewhere; removed via _choiceTeardown on hide(). */
export function wireChoice(
  host: Subtitle,
  opts: SubtitleChoiceOptions,
  allowFreeText: boolean,
): void {
  if (!host._el) return;
  if (host._delegatedHandler) {
    host._el.removeEventListener('click', host._delegatedHandler);
    host._delegatedHandler = null;
  }
  if (host._choiceTeardown) { host._choiceTeardown(); host._choiceTeardown = null; }

  const input = allowFreeText
    ? host._el.querySelector<HTMLInputElement>(`[${UI_ATTR}="choice-input"]`)
    : null;

  let resolved = false;
  const resolve = (value: string, index: number): void => {
    if (resolved) return;
    resolved = true;
    // hide() before delivering the answer — lets a consumer reopen a
    // new choice bar inside onChoose without racing our listeners.
    host.hide();
    opts.onChoose(value, index);
  };

  const onClick = (e: Event): void => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      'button[data-dddk-action="choose"]'
    );
    if (!btn) return;
    const idx = Number(btn.dataset.choiceIndex);
    if (Number.isNaN(idx)) return;
    resolve(opts.options[idx] ?? '', idx);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (isImeComposing(e)) return;
    if (e.target === input) {
      if (e.key === 'Enter' && input) {
        e.preventDefault();
        const v = input.value.trim();
        if (v) resolve(v, -1);
      }
      return;
    }
    // Focus on another interactive surface (palette, textarea,
    // contenteditable) — don't hijack the digit, or opening the
    // palette while the choice bar is up would steal "1" / "2".
    const active = document.activeElement;
    if (active && active !== document.body) {
      const tag = active.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if ((active as HTMLElement).isContentEditable) return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      if (idx < opts.options.length) {
        e.preventDefault();
        resolve(opts.options[idx] ?? '', idx);
      }
    }
  };

  host._el.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey, true);
  host._delegatedHandler = onClick;
  host._choiceTeardown = () => {
    document.removeEventListener('keydown', onKey, true);
  };
}
