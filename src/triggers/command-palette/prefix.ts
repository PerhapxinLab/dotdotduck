/**
 * Prefix routing helpers — pure functions that operate on `PaletteItem.prefix`
 * specs and the current input string. No class state, no DOM.
 */

import type { PaletteItem, PaletteItemPrefix } from './types';

/** Normalize PrefixSpec to a list of matchable strings. */
export function listPrefixMatches(spec: PaletteItemPrefix | undefined): string[] {
  if (!spec) return [];
  if (typeof spec === 'string') return [spec];
  if (Array.isArray(spec)) return spec;
  if (typeof spec === 'object') {
    return Array.isArray(spec.match) ? spec.match : [spec.match];
  }
  return [];
}

/** What to render in the prefix slot for an item. */
export function displayPrefix(spec: PaletteItemPrefix | undefined): string | undefined {
  if (!spec) return undefined;
  if (typeof spec === 'string') return spec;
  if (Array.isArray(spec)) return spec[0];
  if (typeof spec === 'object') {
    return spec.label ?? (Array.isArray(spec.match) ? spec.match[0] : spec.match);
  }
  return undefined;
}

/**
 * Find the item whose prefix matches the input.
 *   - Longest prefix wins (so `ask ai:` beats a hypothetical `ask:`).
 *   - Non-Tips items beat Tips items at the same length (a Tip is a hint
 *     row that lives in section `'Tips'`; the real command in another
 *     section is what should actually fire when the user types the prefix).
 */
export function matchPrefix(
  items: PaletteItem[],
  input: string,
): { item: PaletteItem; arg: string } | null {
  // Case-insensitive: `Docs:`, `DOCS:`, `docs:` all route to the same item.
  const loweredInput = input.toLowerCase();
  let best: { item: PaletteItem; arg: string; prefixLen: number; isTip: boolean } | null = null;
  for (const item of items) {
    const isTip = item.section === 'Tips';
    const matches = listPrefixMatches(item.prefix);
    for (const m of matches) {
      if (loweredInput.startsWith(m.toLowerCase())) {
        const len = m.length;
        const better =
          !best ||
          (best.isTip && !isTip) ||
          (best.isTip === isTip && len > best.prefixLen);
        if (better) {
          best = { item, arg: input.slice(len).trim(), prefixLen: len, isTip };
        }
      }
    }
  }
  return best ? { item: best.item, arg: best.arg } : null;
}

/**
 * True when the user has typed the START of a registered prefix but not
 * the whole thing — e.g. `/`, `/t`, `nav`, `ask`. In that state we want
 * to filter the palette to commands whose prefix begins with the input,
 * NOT run a fuzzy / page-text search.
 */
export function looksLikePrefixAttempt(items: PaletteItem[], input: string): boolean {
  if (input.length === 0) return false;
  const lowered = input.toLowerCase();
  for (const item of items) {
    for (const p of listPrefixMatches(item.prefix)) {
      const pl = p.toLowerCase();
      if (pl === lowered) return false; // exact match already routes via matchPrefix
      if (pl.startsWith(lowered) && p.length > input.length) return true;
    }
  }
  return false;
}
