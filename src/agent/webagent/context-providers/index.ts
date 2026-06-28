/**
 * Default context providers for the six `ContextRole` slots WebAgent
 * recognises. SDK installs these into `webagent.contextProviders`
 * lazily in the constructor; hosts replace any single slot via
 * `webagent.registerContextProvider(role, fn)` — the registration
 * automatically restores the SDK default on `handle.remove()`.
 *
 * v0.2.0 · Wave 2·D.
 */

import type { ContextProvider, ContextRole } from '../types';
import { defaultUrlProvider } from './url';
import { defaultPageSummaryProvider } from './page-summary';
import { defaultDomProvider } from './dom';
import { defaultScreenshotProvider } from './screenshot';
import { defaultHistoryProvider, recordNavigation } from './history';
import { defaultSelectionProvider } from './selection';

export {
  defaultUrlProvider,
  defaultPageSummaryProvider,
  defaultDomProvider,
  defaultScreenshotProvider,
  defaultHistoryProvider,
  defaultSelectionProvider,
  recordNavigation,
};

/**
 * Lookup table — `getDefaultContextProvider('url')` returns the
 * SDK default for that slot. Use this when you want to compose with
 * the default (e.g. wrap it with extra logging) rather than replace
 * it outright.
 */
export const DEFAULT_CONTEXT_PROVIDERS: Readonly<Record<ContextRole, ContextProvider>> = Object.freeze({
  url:           defaultUrlProvider,
  page_summary:  defaultPageSummaryProvider,
  dom:           defaultDomProvider,
  screenshot:    defaultScreenshotProvider,
  history:       defaultHistoryProvider,
  selection:     defaultSelectionProvider,
});

export function getDefaultContextProvider(role: ContextRole): ContextProvider {
  return DEFAULT_CONTEXT_PROVIDERS[role];
}
