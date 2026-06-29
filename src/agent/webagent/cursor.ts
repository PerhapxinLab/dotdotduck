/**
 * Synthetic cursor overlay.
 *
 * When the agent runs `click`, it normally calls `el.click()` instantly —
 * which from the user's POV looks like the button just got pressed by a
 * ghost. The synthetic cursor smooths this over:
 *
 *   1. A small arrow overlay is rendered above the page chrome.
 *   2. It slides from its last position (or window centre on first use)
 *      to the target element's centre — CSS transition, ~350ms ease-in-out.
 *   3. A short "press" tap animation runs (scale down/up).
 *   4. THEN we call `el.click()`.
 *
 * The cursor is purely visual — DOM events are still synthesised by
 * `el.click()`, not by simulating mousedown / mouseup at coordinates.
 * The point is human-paced visual feedback, not bypassing event handlers.
 *
 * Off by default. Host opts in via `new WebAgent({ cursorTrail: true })`.
 * Respects `prefers-reduced-motion` (skip the slide, still flashes briefly
 * so users know SOMETHING happened).
 */

const CURSOR_ID = 'webagent-cursor';
const CURSOR_STYLE_ID = 'webagent-cursor-style';

const CURSOR_CSS = `
  #${CURSOR_ID} {
    position: fixed;
    top: 0; left: 0;
    z-index: var(--webagent-z-overlay, 9100);
    pointer-events: none;
    transition:
      transform var(--webagent-cursor-glide-ms, 360ms) cubic-bezier(0.4, 0, 0.2, 1),
      opacity 160ms ease;
    will-change: transform;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.25));
  }
  #${CURSOR_ID}.tapping {
    transition: transform 90ms ease-in;
    transform-origin: top left;
  }
  #${CURSOR_ID}.pulsing::after {
    content: '';
    position: absolute;
    top: 0; left: 0;
    width: 18px; height: 18px;
    border-radius: 50%;
    border: 2px solid var(--webagent-cursor-fill, #111);
    opacity: 0.55;
    pointer-events: none;
    animation: ${CURSOR_ID}-pulse 600ms ease-out forwards;
  }
  @keyframes ${CURSOR_ID}-pulse {
    0%   { transform: scale(0.4); opacity: 0.6; }
    100% { transform: scale(2.2); opacity: 0; }
  }
  #${CURSOR_ID}.hidden { opacity: 0; }
  @media (prefers-reduced-motion: reduce) {
    #${CURSOR_ID} { transition: opacity 80ms linear; }
    #${CURSOR_ID}.pulsing::after { animation: none; opacity: 0; }
  }
`;

/** Visual mode of the cursor. v0.2.0 — broader UX coverage. */
export type CursorMode = 'pointer' | 'scroll' | 'reading';

const CURSOR_SVG_BY_MODE: Record<CursorMode, string> = {
  pointer: `
    <svg width="18" height="22" viewBox="0 0 16 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 1 L1 16 L5 12 L8 19 L11 17.5 L8 11 L14 11 Z"
        fill="var(--webagent-cursor-fill, #111)"
        stroke="var(--webagent-cursor-stroke, #fff)"
        stroke-width="1" stroke-linejoin="round" />
    </svg>
  `,
  scroll: `
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="2" width="8" height="14" rx="4"
        fill="var(--webagent-cursor-fill, #111)"
        stroke="var(--webagent-cursor-stroke, #fff)" stroke-width="1" />
      <line x1="10" y1="5" x2="10" y2="9"
        stroke="var(--webagent-cursor-stroke, #fff)" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  `,
  reading: `
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="7"
        fill="none"
        stroke="var(--webagent-cursor-fill, #111)" stroke-width="1.8" />
      <circle cx="10" cy="10" r="2.2"
        fill="var(--webagent-cursor-fill, #111)" />
    </svg>
  `,
};

let cursorEl: HTMLDivElement | null = null;
let lastX = -1;
let lastY = -1;
let currentMode: CursorMode = 'pointer';

/**
 * Anchored target. Once a move call lands on this element, a RAF
 * loop keeps the cursor's viewport position in sync with the
 * element's `getBoundingClientRect()` on every frame — so the
 * cursor follows the element when the user scrolls, the page
 * relayouts, or content reflows. Calling `hideCursor` /
 * `setCursorAnchor(null)` releases the lock.
 */
let anchorEl: Element | null = null;
let anchorRafId: number | null = null;

function ensureCursor(): HTMLDivElement {
  if (cursorEl && document.body.contains(cursorEl)) return cursorEl;
  if (!document.getElementById(CURSOR_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = CURSOR_STYLE_ID;
    style.textContent = CURSOR_CSS;
    document.head.appendChild(style);
  }
  const wrap = document.createElement('div');
  wrap.id = CURSOR_ID;
  wrap.className = 'hidden';
  wrap.setAttribute('aria-hidden', 'true');
  // Initial SVG = pointer; setCursorMode swaps it at runtime.
  wrap.innerHTML = CURSOR_SVG_BY_MODE.pointer;
  document.body.appendChild(wrap);
  cursorEl = wrap;
  return wrap;
}

function setPosition(el: HTMLDivElement, x: number, y: number): void {
  el.style.transform = `translate(${x}px, ${y}px)`;
  lastX = x;
  lastY = y;
}

function getStartPoint(): { x: number; y: number } {
  if (lastX >= 0 && lastY >= 0) return { x: lastX, y: lastY };
  // First use — start from off-screen-left so the entrance slide is visible.
  return {
    x: -32,
    y: Math.max(40, window.innerHeight / 2),
  };
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Glide the synthetic cursor to `target` and play a tap animation.
 * Returns when the tap animation has finished (so the caller can fire
 * the real `el.click()` immediately after).
 *
 * `targetEl` is the DOM element you're about to click. We sample its
 * centre as the destination point. If the target is offscreen, the cursor
 * still slides — pair with a `scrollTo` action first if you want the
 * user to see the click happen.
 */
export async function moveCursorAndTap(targetEl: Element): Promise<void> {
  if (typeof document === 'undefined' || !document.body) return;

  // Release any prior anchor BEFORE the glide animation — otherwise
  // the RAF loop keeps pulling the cursor back to the old target
  // mid-transition.
  setCursorAnchor(null);

  const wrap = ensureCursor();
  await ensureInView(targetEl);
  const { destX, destY } = cursorAnchor(targetEl);

  const reduced = reducedMotion();
  const glideMs = reduced ? 0 : 360;

  // Place at start point (or last point) BEFORE setting transition target.
  const start = getStartPoint();
  if (wrap.classList.contains('hidden')) {
    // Reflow trick: assign start with transition disabled, then enable
    // and assign destination so the browser interpolates between them.
    wrap.style.transition = 'none';
    setPosition(wrap, start.x, start.y);
    // Force a reflow so the next transform change tweens.
    void wrap.offsetWidth;
    wrap.style.transition = '';
    wrap.classList.remove('hidden');
  }

  setPosition(wrap, destX, destY);
  await sleep(glideMs);

  // Tap: scale down + scale back up.
  wrap.classList.add('tapping');
  wrap.style.transform = `translate(${destX}px, ${destY}px) scale(0.78)`;
  await sleep(reduced ? 0 : 90);
  wrap.style.transform = `translate(${destX}px, ${destY}px) scale(1)`;
  await sleep(reduced ? 0 : 90);
  wrap.classList.remove('tapping');

  // Glide done — anchor the cursor TO the element. From now on the
  // RAF loop keeps the cursor's viewport coords aligned with the
  // element's rect so scrolls / layout shifts don't desync it.
  setCursorAnchor(targetEl);
}

/**
 * Center of the target's current viewport rect. No heuristics — the
 * cursor anchor mechanism below keeps recomputing this every frame
 * so layout shifts / scrolls follow naturally. If the model picked a
 * giant element as the target, that's a model-side problem
 * (`narrate.about` should be the specific element it's referring to,
 * not the section wrapper), not something for this function to
 * smooth over.
 */
function cursorAnchor(targetEl: Element): { destX: number; destY: number } {
  const rect = targetEl.getBoundingClientRect();
  const destX = rect.left + rect.width  / 2;
  const destY = rect.top  + rect.height / 2;
  return { destX, destY };
}

/**
 * Anchor the cursor to `el` and start a RAF loop that keeps the
 * cursor's viewport position in sync with `el`'s rect every frame.
 * Stops automatically when `setCursorAnchor(null)` is called, when
 * a new anchor replaces it, or when the cursor hides.
 *
 * Without this, the cursor's position was a snapshot taken at the
 * moment of `moveCursorAndTap` — page scrolls AFTER the move left
 * the cursor pointing at whatever happened to be at that viewport
 * coordinate, totally disconnected from the element the agent had
 * gestured at.
 */
function setCursorAnchor(el: Element | null): void {
  anchorEl = el;
  if (anchorRafId !== null) {
    cancelAnimationFrame(anchorRafId);
    anchorRafId = null;
  }
  if (!el) return;
  const tick = (): void => {
    if (!anchorEl || anchorEl !== el || !cursorEl) {
      anchorRafId = null;
      return;
    }
    // Element disconnected (removed from DOM) — release the anchor.
    if (!el.isConnected) {
      anchorEl = null;
      anchorRafId = null;
      return;
    }
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width  / 2;
    const y = rect.top  + rect.height / 2;
    // Skip transform update if nothing changed — avoids triggering
    // unnecessary repaints and lets the existing CSS transition
    // (used during the initial glide) play out.
    if (x !== lastX || y !== lastY) {
      // Direct write WITHOUT animation — keeps cursor stuck to
      // the moving target instead of trailing behind on scroll.
      cursorEl.style.transition = 'none';
      cursorEl.style.transform = `translate(${x}px, ${y}px)`;
      lastX = x;
      lastY = y;
    }
    anchorRafId = requestAnimationFrame(tick);
  };
  anchorRafId = requestAnimationFrame(tick);
}

/**
 * If the target is meaningfully off-screen, smooth-scroll it into
 * view BEFORE moving the cursor. Without this the cursor "lands"
 * at a viewport coordinate that no longer corresponds to where the
 * user sees the element after a layout shift.
 */
async function ensureInView(targetEl: Element): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const rect = targetEl.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    // Offscreen vertically (top above viewport or bottom below + a
    // 40px buffer) OR offscreen horizontally → scroll center.
    const offY = rect.bottom < 40 || rect.top > vh - 40;
    const offX = rect.right  < 40 || rect.left > vw - 40;
    if (offY || offX) {
      (targetEl as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      // Wait for the smooth-scroll to settle. ~360ms covers typical
      // browser smooth-scroll timing.
      await sleep(reducedMotion() ? 0 : 380);
    }
  } catch { /* nicety; positioning will fall back to whatever rect we get */ }
}

/**
 * Glide the cursor onto `targetEl` WITHOUT tapping — used by actions
 * that visualize attention (border / highlight / scrollTo / narrate-
 * about) but don't synthesize a click. A short pulse plays on
 * arrival so the user gets a clear "I'm focused HERE now" beat.
 *
 * Same gating + reduced-motion semantics as `moveCursorAndTap`.
 */
export async function moveCursorTo(targetEl: Element): Promise<void> {
  if (typeof document === 'undefined' || !document.body) return;
  setCursorAnchor(null);
  const wrap = ensureCursor();
  await ensureInView(targetEl);
  const { destX, destY } = cursorAnchor(targetEl);
  const reduced = reducedMotion();
  const glideMs = reduced ? 0 : 360;

  const start = getStartPoint();
  if (wrap.classList.contains('hidden')) {
    wrap.style.transition = 'none';
    setPosition(wrap, start.x, start.y);
    void wrap.offsetWidth;
    wrap.style.transition = '';
    wrap.classList.remove('hidden');
  }

  setPosition(wrap, destX, destY);
  await sleep(glideMs);
  cursorPulse();

  // Anchor the cursor to the element so scrolls / layout shifts
  // keep it visually attached.
  setCursorAnchor(targetEl);
}

/**
 * Trigger the arrival-pulse animation independent of arrival —
 * useful for the moment a narration starts or a highlight lands.
 */
export function cursorPulse(): void {
  if (!cursorEl) return;
  cursorEl.classList.remove('pulsing');
  // Reflow to restart the CSS animation.
  void cursorEl.offsetWidth;
  cursorEl.classList.add('pulsing');
  setTimeout(() => cursorEl?.classList.remove('pulsing'), 700);
}

/**
 * Swap the cursor glyph between visual modes.
 *   - `pointer` (default): OS-style arrow, for clicks / general use.
 *   - `scroll`: mouse-wheel icon, for `scroll_to` action.
 *   - `reading`: target reticle, for `narrate`-with-`about` beats.
 *
 * Idempotent — calling with the current mode is a no-op.
 */
export function setCursorMode(mode: CursorMode): void {
  if (mode === currentMode) return;
  currentMode = mode;
  const wrap = ensureCursor();
  wrap.innerHTML = CURSOR_SVG_BY_MODE[mode];
}

/**
 * Hide the cursor (e.g. when the agent run ends). Does not destroy the
 * element — next call to `moveCursorAndTap` re-shows it.
 *
 * Resets `lastX / lastY` to the "first use" sentinel so the NEXT
 * agent run starts the entrance glide from off-screen-left, not from
 * wherever the previous run's last action happened to land. Without
 * this, the cursor would visibly fly across the page from a stale
 * position before reaching the new target.
 */
export function hideCursor(): void {
  setCursorAnchor(null);
  if (cursorEl) cursorEl.classList.add('hidden');
  lastX = -1;
  lastY = -1;
}

/** Remove the cursor DOM entirely. Call on `dddk.destroy()`. */
export function destroyCursor(): void {
  setCursorAnchor(null);
  if (cursorEl && cursorEl.parentElement) cursorEl.parentElement.removeChild(cursorEl);
  cursorEl = null;
  lastX = -1;
  lastY = -1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
