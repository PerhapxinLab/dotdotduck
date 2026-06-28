/**
 * Default `history` context provider.
 *
 * Pulls recent paths from `window.history` — best-effort only. The
 * History API doesn't expose the actual stack to JS, so this
 * provider returns the current entry plus whatever sessionStorage
 * trail the SDK may have stamped during earlier navigations.
 *
 * Hosts with a real router (React Router, Vue Router, SvelteKit)
 * override to surface the actual app-level route history, including
 * route NAMES (not just paths) — `webagent.registerContextProvider('history', fn)`.
 */

import type { ContextProvider } from '../types';

const TRAIL_KEY = 'dddk.history.trail';
const TRAIL_MAX = 10;

/**
 * Default trail tracker: hosts that don't push to the trail get an
 * empty list. The orchestrator's navigation handler can wire calls
 * to `recordNavigation(path)` to keep the trail filled.
 */
export function recordNavigation(path: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(TRAIL_KEY);
    const trail: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (trail[trail.length - 1] === path) return; // dedupe consecutive duplicates
    trail.push(path);
    while (trail.length > TRAIL_MAX) trail.shift();
    sessionStorage.setItem(TRAIL_KEY, JSON.stringify(trail));
  } catch {
    /* quota / disabled */
  }
}

export const defaultHistoryProvider: ContextProvider = () => {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(TRAIL_KEY);
    if (!raw) return null;
    const trail = JSON.parse(raw) as string[];
    if (!Array.isArray(trail) || trail.length === 0) return null;
    return `RECENT_PATHS:\n${trail.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`;
  } catch {
    return null;
  }
};
