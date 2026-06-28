/**
 * Default `page_summary` context provider.
 *
 * Emits `<title>` + `<meta name="description">` content, one line
 * each. The runtime uses this so the LLM knows what the page is
 * "for" without scanning the whole DOM.
 *
 * Hosts override when the page's real summary lives in app state
 * (e.g. a single-page editor where `<title>` is generic and the
 * actual document title is in a React store).
 */

import type { ContextProvider } from '../types';

export const defaultPageSummaryProvider: ContextProvider = () => {
  if (typeof document === 'undefined') return null;
  const title = document.title?.trim() || null;
  const metaDesc = document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content?.trim() || null;
  if (!title && !metaDesc) return null;
  const lines: string[] = [];
  if (title) lines.push(`TITLE: ${truncate(title, 200)}`);
  if (metaDesc) lines.push(`DESCRIPTION: ${truncate(metaDesc, 400)}`);
  return lines.join('\n');
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
