// mountInlineDiff — present an AI edit as a diff (strikethrough old + new) with
// an action toolbar and optional chat composer for follow-up prompts. The host
// decides what to do with each user choice via the returned promise / callbacks.
//
// Designed for "user selected a span, AI edited it, before committing show
// what would happen" — works for plain text inputs (perhapxin's doc editor)
// and for richer surfaces (Tiptap leaves, contenteditable lines).

import { ensureInlineEffectsStyles } from './styles';
import { UI_ATTR } from '../../utils/dom';

export type InlineDiffOutcome =
  | { kind: 'accept'; text: string }
  | { kind: 'reject' }
  | { kind: 'insert-after'; text: string }
  | { kind: 'copy'; text: string }
  | { kind: 'follow-up'; prompt: string };

export interface InlineDiffLabels {
  /** Accept the AI edit and commit it. Default 'Accept'. */
  accept?: string;
  /** Reject the AI edit and restore the original. Default 'Reject'. */
  reject?: string;
  /** Insert AI result as new line AFTER the selection. Default 'Insert below'. */
  insertAfter?: string;
  /** Copy AI result. Default 'Copy'. */
  copy?: string;
  /** Prompt placeholder for follow-up. Default 'Make it shorter / formal / …'. */
  followUpPlaceholder?: string;
  /** Send follow-up button. Default 'Send'. */
  send?: string;
}

export interface InlineDiffOpts {
  /** Anchor rect — usually the selection bounding box. */
  rect: { left: number; top: number; bottom: number; width?: number };
  /** Element to mount into. Default `document.body`. */
  host?: HTMLElement;
  /** Extra px below the anchor's bottom edge. Default 6. */
  gap?: number;
  /** Show the "Insert below" button. Default false. */
  enableInsertAfter?: boolean;
  /** Show the follow-up composer. Default true. */
  enableFollowUp?: boolean;
  /** UI strings — defaults are English. */
  labels?: InlineDiffLabels;
  /** Called for each user choice that does NOT close the panel
   *  (`'follow-up'` while session is in chat mode). The panel waits for the
   *  caller to settle the new text via `.applyNewText(newText)`. */
  onFollowUp?: (prompt: string) => Promise<string | null>;
}

export interface InlineDiffHandle {
  /** Re-anchor on scroll / resize. */
  update(rect: { left: number; top: number; bottom: number }): void;
  /** Replace the "new" text — used after a follow-up returns. */
  applyNewText(newText: string): void;
  /** Programmatically reject + dispose. */
  dispose(): void;
  /** Promise that resolves with the user's final decision (accept / reject /
   *  insert-after / copy). Follow-up rounds keep the promise pending. */
  result: Promise<Exclude<InlineDiffOutcome, { kind: 'follow-up' }>>;
}

/**
 * Show a strikethrough-old → new-text diff panel anchored under `rect`.
 * The promise resolves when the user picks a terminal action. Follow-up
 * prompts (chat continuation) are surfaced via `opts.onFollowUp`.
 */
export function mountInlineDiff(
  oldText: string,
  newText: string,
  opts: InlineDiffOpts,
): InlineDiffHandle {
  ensureInlineEffectsStyles();
  const host = opts.host ?? document.body;
  const gap = opts.gap ?? 6;
  const labels: Required<InlineDiffLabels> = {
    accept: opts.labels?.accept ?? 'Accept',
    reject: opts.labels?.reject ?? 'Reject',
    insertAfter: opts.labels?.insertAfter ?? 'Insert below',
    copy: opts.labels?.copy ?? 'Copy',
    followUpPlaceholder: opts.labels?.followUpPlaceholder ?? 'Make it shorter / formal / …',
    send: opts.labels?.send ?? 'Send',
  };

  const el = document.createElement('div');
  el.setAttribute(UI_ATTR, 'inline-diff');

  const diff = document.createElement('div');
  diff.className = 'id-diff';
  const oldSpan = document.createElement('span');
  oldSpan.className = 'id-old';
  oldSpan.textContent = oldText;
  const arrow = document.createElement('span');
  arrow.className = 'id-arrow';
  arrow.textContent = '→';
  const newSpan = document.createElement('span');
  newSpan.className = 'id-new';
  newSpan.textContent = newText;
  diff.appendChild(oldSpan);
  diff.appendChild(arrow);
  diff.appendChild(newSpan);
  el.appendChild(diff);

  const actions = document.createElement('div');
  actions.className = 'id-actions';
  const acceptBtn = mkBtn(labels.accept, true);
  const rejectBtn = mkBtn(labels.reject);
  const insertBtn = opts.enableInsertAfter ? mkBtn(labels.insertAfter) : null;
  const copyBtn = mkBtn(labels.copy);
  actions.appendChild(acceptBtn);
  actions.appendChild(rejectBtn);
  if (insertBtn) actions.appendChild(insertBtn);
  actions.appendChild(copyBtn);
  el.appendChild(actions);

  let composer: HTMLDivElement | null = null;
  let input: HTMLInputElement | null = null;
  let sendBtn: HTMLButtonElement | null = null;
  let spinner: HTMLSpanElement | null = null;
  if (opts.enableFollowUp !== false && opts.onFollowUp) {
    composer = document.createElement('div');
    composer.className = 'id-composer';
    input = document.createElement('input');
    input.className = 'id-input';
    input.type = 'text';
    input.placeholder = labels.followUpPlaceholder;
    sendBtn = mkBtn(labels.send);
    spinner = document.createElement('span');
    spinner.className = 'id-spinner';
    spinner.style.display = 'none';
    composer.appendChild(input);
    composer.appendChild(spinner);
    composer.appendChild(sendBtn);
    el.appendChild(composer);
  }

  host.appendChild(el);

  const place = (r: { left: number; top: number; bottom: number }) => {
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    el.style.left = `${r.left + scrollX}px`;
    el.style.top = `${r.bottom + scrollY + gap}px`;
    // Clamp inside viewport on the right edge.
    const rect = el.getBoundingClientRect();
    const overflowR = rect.right - window.innerWidth + 8;
    if (overflowR > 0) el.style.left = `${r.left + scrollX - overflowR}px`;
  };
  place(opts.rect);

  let disposed = false;
  let resolveOuter: (v: Exclude<InlineDiffOutcome, { kind: 'follow-up' }>) => void = () => {};
  const result = new Promise<Exclude<InlineDiffOutcome, { kind: 'follow-up' }>>((res) => { resolveOuter = res; });

  let currentNew = newText;
  const finish = (out: Exclude<InlineDiffOutcome, { kind: 'follow-up' }>) => {
    if (disposed) return;
    disposed = true;
    el.remove();
    resolveOuter(out);
  };

  acceptBtn.addEventListener('click', () => finish({ kind: 'accept', text: currentNew }));
  rejectBtn.addEventListener('click', () => finish({ kind: 'reject' }));
  if (insertBtn) insertBtn.addEventListener('click', () => finish({ kind: 'insert-after', text: currentNew }));
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(currentNew); } catch { /* ignore */ }
    finish({ kind: 'copy', text: currentNew });
  });

  const sendFollowUp = async () => {
    if (!input || !sendBtn || !spinner) return;
    const prompt = input.value.trim();
    if (!prompt) return;
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;
    acceptBtn.disabled = true;
    rejectBtn.disabled = true;
    if (insertBtn) insertBtn.disabled = true;
    copyBtn.disabled = true;
    spinner.style.display = '';
    try {
      const next = await opts.onFollowUp!(prompt);
      if (disposed) return;
      if (next != null) {
        currentNew = next;
        newSpan.textContent = next;
      }
    } finally {
      if (!disposed) {
        input.disabled = false;
        sendBtn.disabled = false;
        acceptBtn.disabled = false;
        rejectBtn.disabled = false;
        if (insertBtn) insertBtn.disabled = false;
        copyBtn.disabled = false;
        spinner.style.display = 'none';
        input.focus();
      }
    }
  };
  if (input && sendBtn) {
    sendBtn.addEventListener('click', () => { void sendFollowUp(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        void sendFollowUp();
      }
      if (e.key === 'Escape') finish({ kind: 'reject' });
    });
  }

  return {
    update(nextRect) { if (!disposed) place(nextRect); },
    applyNewText(text) {
      if (disposed) return;
      currentNew = text;
      newSpan.textContent = text;
    },
    dispose() { finish({ kind: 'reject' }); },
    result,
  };
}

function mkBtn(label: string, primary?: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'id-btn';
  if (primary) b.setAttribute('data-primary', '');
  b.textContent = label;
  return b;
}
