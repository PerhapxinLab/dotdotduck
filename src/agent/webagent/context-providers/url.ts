/**
 * Default `url` context provider.
 *
 * Emits the current path + query + hash, one line. The runtime
 * splices this into the per-turn prompt's location context.
 *
 * Hosts override via `webagent.registerContextProvider('url', fn)` —
 * useful when a SPA represents routes outside `location.pathname`
 * (e.g. fragment-only routing, query-encoded view state).
 */

import type { ContextProvider } from '../types';

export const defaultUrlProvider: ContextProvider = () => {
  if (typeof location === 'undefined') return null;
  return location.pathname + location.search + location.hash;
};
