/**
 * Fuzzy filter + match-highlight helpers — pure, item-shape-agnostic.
 * The hay-cache mutates the item in place (lazy `__searchHay` /
 * `__searchNameLower`); setItems() invalidates by replacing the array.
 */

import { escapeHtml } from '../../utils/dom';
import type { PaletteItem } from './types';

/**
 * Lazy hay-cache for fuzzy lookup. Concatenating name + description +
 * keywords on every keystroke for every item is O(N * L) per char with
 * non-trivial constants on hundreds of items, so we stash the lowercased
 * haystack on the item once and reuse it. setItems() invalidates by
 * replacing the item array entirely.
 */
export interface PaletteItemWithHay extends PaletteItem {
  __searchHay?: string;
  __searchNameLower?: string;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/**
 * Wrap EVERY contiguous occurrence of `query` in `text` with a
 * `<mark data-dddk-ui="palette-match">` so it renders with the highlight
 * style (warm yellow / themed). Case-insensitive, non-overlapping. Falls
 * back to plain escaped text when the query is empty or has no match.
 *
 * Only contiguous substring matches highlight — fuzzy character matches
 * don't, because per-char highlights read as visual noise.
 */
export function highlightMatch(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const segments: string[] = [];
  let cursor = 0;
  let hit = haystack.indexOf(needle, cursor);
  if (hit < 0) return escapeHtml(text);
  while (hit >= 0) {
    if (hit > cursor) segments.push(escapeHtml(text.slice(cursor, hit)));
    segments.push(
      `<mark data-dddk-ui="palette-match">${escapeHtml(text.slice(hit, hit + needle.length))}</mark>`,
    );
    cursor = hit + needle.length;
    hit = haystack.indexOf(needle, cursor);
  }
  if (cursor < text.length) segments.push(escapeHtml(text.slice(cursor)));
  return segments.join('');
}

export function fuzzyScore(item: PaletteItem, query: string): number {
  // Substring-only — require a contiguous match. Hosts that want
  // typo tolerance should add alternate keywords on the item itself.
  const it = item as PaletteItemWithHay;
  let hay = it.__searchHay;
  if (hay == null) {
    hay = `${item.name} ${item.description ?? ''} ${(item.keywords ?? []).join(' ')}`.toLowerCase();
    it.__searchHay = hay;
  }
  if (!hay.includes(query)) return 0;
  // Boost for prefix match on name — also tolerate a leading symbol
  // (`/`, `#`, `>`) so `/language` ranks high on query `lan` / `language`.
  let nameLower = it.__searchNameLower;
  if (nameLower == null) {
    nameLower = item.name.toLowerCase();
    it.__searchNameLower = nameLower;
  }
  if (nameLower.startsWith(query)) return 10;
  // Strip a single leading non-alphanumeric character and retry — handles
  // skill-style names like `/language` against bare-word queries.
  if (/^[^a-z0-9]/.test(nameLower) && nameLower.slice(1).startsWith(query)) return 9;
  return 5;
}

/**
 * Shared "fuzzy-score + sort desc + slice" helper. Three call sites in
 * the refilter pipeline (browse-mode, prefixAcceptsAnyArg secondary
 * results, free-text search) all do the same thing — keep them in lockstep.
 */
export function fuzzyTopN(items: PaletteItem[], query: string, limit: number): PaletteItem[] {
  const q = query.toLowerCase();
  return items
    .map((i) => ({ i, score: fuzzyScore(i, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.i)
    .slice(0, limit);
}
