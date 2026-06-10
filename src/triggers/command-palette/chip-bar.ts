/**
 * Chip-bar rendering + pinned-context bookkeeping. The CommandPalette class
 * owns the state slots (`contextSelectionText`, `contextAttachments`,
 * `pinnedContextEl` …) and forwards to these helpers via a small host
 * adapter so this file can stay state-free (modulo the host it operates on).
 *
 * Why an adapter instead of importing CommandPalette directly: avoids a
 * circular import (CommandPalette imports this file) and keeps the helper's
 * surface explicit.
 */

import { genId } from '../../utils/id';
import { formatElementSignature } from '../../utils/dom';
import { inferSelector } from '../../utils/selector';
import type { PaletteAttachment } from './types';
import { truncate } from './fuzzy';
import { UI_ATTR } from './styles';

export type SelectionKind = 'dom' | 'text';

/**
 * State slots the chip-bar helpers read / mutate on the palette.
 * Implemented as accessor pairs so the CommandPalette class can keep the
 * private fields where they live today without exposing them.
 */
export interface ChipBarHost {
  /** Backing DOM node of the chip strip (between input row and list). */
  getChipBarHost(): HTMLDivElement | null;

  /** Live text-selection state. */
  getSelectionText(): string;
  setSelectionText(value: string): void;
  getSelectionElement(): string | undefined;
  setSelectionElement(value: string | undefined): void;
  getSelectionKind(): SelectionKind;
  setSelectionKind(value: SelectionKind): void;

  /** Image attachments queued in the palette context. */
  getAttachments(): PaletteAttachment[];
  setAttachments(value: PaletteAttachment[]): void;

  /** Sticky pinned-context state — survives palette open/close cycles. */
  getPinnedEl(): Element | null;
  setPinnedEl(el: Element | null): void;
  getPinnedText(): string;
  setPinnedText(text: string): void;
  getPinnedKind(): SelectionKind;
  setPinnedKind(kind: SelectionKind): void;

  /** Render orchestration. Helper calls these whenever its mutations
   *  could change the chip-bar / list. */
  isOpen(): boolean;
  renderChipBar(): void;
  refilter(): void;
}

/**
 * Render or refresh the chip-bar above the palette input. Shows a context
 * chip (text or DOM selection) when one is captured, then one preview chip
 * per image attachment.
 */
export function renderChipBar(host: ChipBarHost): void {
  const el = host.getChipBarHost();
  if (!el) return;
  const selectionText = host.getSelectionText();
  const attachments = host.getAttachments();
  const hasSel = !!selectionText;
  const hasAtt = attachments.length > 0;
  if (!hasSel && !hasAtt) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = 'flex';
  el.innerHTML = '';

  if (hasSel) {
    const chip = document.createElement('div');
    const isDom = host.getSelectionKind() === 'dom';
    chip.className = isDom ? 'pal-chip pal-chip-sel pal-chip-dom' : 'pal-chip pal-chip-sel';
    chip.innerHTML = `
      <span class="pal-chip-label">${isDom ? 'DOM' : 'CONTEXT'}</span>
      <span class="pal-chip-text"></span>
      <button type="button" class="pal-chip-x" aria-label="Clear selection">✕</button>
    `;
    const textEl = chip.querySelector('.pal-chip-text');
    // DOM chips are usually short (`<tag#id.class> inner`); 80 chars keeps
    // the chip compact. Text chips can show more (120) since longer prose
    // selections benefit from extra preview.
    if (textEl) textEl.textContent = truncate(selectionText, isDom ? 80 : 120);
    const xBtn = chip.querySelector<HTMLButtonElement>('.pal-chip-x');
    if (xBtn) xBtn.onclick = () => {
      host.setSelectionText('');
      host.setSelectionElement(undefined);
      host.setSelectionKind('text');
      renderChipBar(host);
    };
    el.appendChild(chip);
  }

  for (const att of attachments) {
    const chip = document.createElement('div');
    chip.className = 'pal-chip pal-chip-att';
    // Image chips show the actual preview (no filename clutter).
    chip.innerHTML = `
      <img class="pal-chip-img" alt="" />
      <button type="button" class="pal-chip-x" aria-label="Remove">✕</button>
    `;
    const img = chip.querySelector<HTMLImageElement>('.pal-chip-img');
    if (img) img.src = att.thumbnailUrl;
    const xBtn = chip.querySelector<HTMLButtonElement>('.pal-chip-x');
    if (xBtn) xBtn.onclick = () => removeAttachment(host, att.id);
    el.appendChild(chip);
  }
}

/**
 * Read the current text of the pinned element AT THIS MOMENT. Returns
 * '' if the pinned element has been unmounted (SPA route change, list
 * virtualised, etc.) — no caching, no selector re-matching across
 * pages, just "is this exact element still in the document".
 *
 * `withSignature: true` prepends a human-readable `<tag#id.classes>`
 * tag — used by the chip bar so the user sees WHICH element is pinned.
 * The agent path must use `withSignature: false` so the LLM gets clean
 * prose to operate on.
 */
export function readPinnedTextLive(
  host: ChipBarHost,
  opts: { withSignature?: boolean } = {},
): string {
  const el = host.getPinnedEl();
  if (!el) return host.getPinnedText();
  if (typeof document === 'undefined') return host.getPinnedText();
  if (!el.isConnected || !document.contains(el)) return '';
  const inner = ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().slice(0, 1000);
  if (host.getPinnedKind() === 'dom' && opts.withSignature) {
    return formatElementSignature(el as HTMLElement);
  }
  return inner || (el.textContent ?? host.getPinnedText()).trim();
}

/**
 * Host pins a context (typically the DOM region the user just selected via
 * Dwell / Spotter / a manual selection) for the next palette open. Cleared
 * automatically after the palette opens once.
 */
export function setPinnedContext(
  host: ChipBarHost,
  text: string,
  elementOrSelector?: Element | string | null,
  opts?: { kind?: SelectionKind },
): void {
  const kind: SelectionKind = opts?.kind ?? 'text';
  host.setPinnedKind(kind);

  // Resolve to an element REFERENCE. If host passes an Element we
  // store it directly (no selector indirection). If they pass a
  // selector string, resolve it NOW — the selector is only a
  // bootstrapping hint, not stored. Anything else → no element pin.
  if (elementOrSelector instanceof Element) {
    host.setPinnedEl(elementOrSelector);
  } else if (typeof elementOrSelector === 'string' && elementOrSelector.length > 0) {
    try { host.setPinnedEl(document.querySelector(elementOrSelector)); }
    catch { host.setPinnedEl(null); }
  } else {
    host.setPinnedEl(null);
  }

  // Text fallback only for non-DOM pins. DOM pins always re-read from
  // the live element at open time so navigation auto-invalidates them.
  host.setPinnedText(kind === 'dom' ? '' : text);

  // Pinning is a deliberate "this is the context now" — clear any
  // earlier text selection so the two don't coexist.
  if (typeof window !== 'undefined') {
    try { window.getSelection?.()?.removeAllRanges(); } catch { /* cross-origin / SSR */ }
  }
}

/**
 * Capture selection / dwell context at palette-open time. Pure live scan —
 * NO trust in any cached state. Every open re-queries the document for
 * "what is selected RIGHT NOW" and "what element carries the Dwell marker
 * RIGHT NOW". Stored vars are only consulted as a last-resort legacy
 * fallback for hosts that pin programmatically without using Dwell.
 */
export function captureContextOnOpen(host: ChipBarHost, seed: string | undefined): void {
  let text = (seed ?? '').trim();
  let elementSel: string | undefined;
  // Kind defaults to 'text' for live window selections; the dwell
  // pathway carries 'dom'.
  let kind: SelectionKind = 'text';

  // 1) LIVE window text selection.
  if (!text && typeof window !== 'undefined') {
    const sel = window.getSelection?.();
    const fromBrowser = sel?.toString().trim() ?? '';
    if (fromBrowser && sel && sel.rangeCount > 0) {
      const node = sel.getRangeAt(0).startContainer;
      const anchor = node instanceof Element ? node : node.parentElement;
      if (anchor && anchor.isConnected && document.contains(anchor)) {
        text = fromBrowser;
        elementSel = inferSelector(anchor) || undefined;
      }
    }
  }

  // 2) LIVE dwell marker — query the DOM for the element currently
  //    carrying `[data-dddk-dwell-target]`. No stored Element ref to
  //    go stale; if the marked element was unmounted by an SPA route
  //    change, `querySelector` simply doesn't find it on the new
  //    page and there is no pin to mis-attribute. This is the
  //    canonical path for Dwell pins.
  if (!text && typeof document !== 'undefined') {
    const marked = document.querySelector<HTMLElement>('[data-dddk-dwell-target]');
    if (marked) {
      const inner = (marked.innerText ?? marked.textContent ?? '').trim().slice(0, 1000);
      if (inner) {
        text = formatElementSignature(marked);
        elementSel = inferSelector(marked) || undefined;
        kind = 'dom';
      }
    }
  }

  // 3) LEGACY programmatic pin via setPinnedContext (rare; only hosts
  //    that pin outside of the Dwell module). Kept for back-compat
  //    but cleared aggressively if its element has detached.
  if (!text && host.getPinnedEl()) {
    const liveText = readPinnedTextLive(host, { withSignature: true });
    if (liveText) {
      text = liveText;
      elementSel = inferSelector(host.getPinnedEl() as Element) || undefined;
      kind = host.getPinnedKind();
    } else {
      host.setPinnedEl(null);
      host.setPinnedText('');
      host.setPinnedKind('text');
    }
  }
  if (!text && host.getPinnedText() && !host.getPinnedEl()) {
    text = host.getPinnedText();
    kind = host.getPinnedKind();
  }

  host.setSelectionText(text);
  host.setSelectionElement(elementSel);
  host.setSelectionKind(kind);
  // Image attachments persist across palette opens until user removes /
  // activates. Cleared from the orchestrator after webagent consumes them.
}

/** Public: add an image attachment to the palette context. */
export function addAttachment(
  host: ChipBarHost,
  att: Omit<PaletteAttachment, 'id'>,
): PaletteAttachment {
  const full: PaletteAttachment = { id: genId('att'), ...att };
  host.setAttachments([...host.getAttachments(), full]);
  if (host.isOpen()) {
    host.renderChipBar();
    // Re-filter so contextPromotesFallback (default ON) pulls the Ask AI
    // row to the top now that there's something attached.
    host.refilter();
  }
  return full;
}

export function removeAttachment(host: ChipBarHost, id: string): void {
  host.setAttachments(host.getAttachments().filter((a) => a.id !== id));
  if (host.isOpen()) {
    host.renderChipBar();
    host.refilter();
  }
}

export function clearAttachments(host: ChipBarHost): void {
  host.setAttachments([]);
  if (host.isOpen()) {
    host.renderChipBar();
    host.refilter();
  }
}
