/**
 * Default `selection` context provider.
 *
 * Returns the live `window.getSelection()` text (if any) so the
 * agent can ground its next action on what the user just
 * highlighted. The runtime independently captures Dwell-anchored
 * selections; this provider is the OS-level selection fallback.
 *
 * Hosts override when the editable layer is non-standard — e.g. a
 * canvas-based editor that maintains its own selection model.
 */

import type { ContextProvider } from '../types';

export const defaultSelectionProvider: ContextProvider = () => {
  if (typeof window === 'undefined') return null;
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  return `SELECTION: ${text.length > 500 ? text.slice(0, 499) + '…' : text}`;
};
