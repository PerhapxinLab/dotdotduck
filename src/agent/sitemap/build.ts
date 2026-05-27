/**
 * Multilingual sitemap helper.
 *
 * Hosts that ship a multi-language UI (English + Chinese + Japanese, …)
 * usually want a user typing in any of those languages to find the same
 * page. The sitemap that powers the agent's navigation tool only carries
 * ONE `description` field per route, but it ALSO supports `aliases`.
 *
 * This helper takes a flat nav-target list plus an i18n dict, and
 * produces `SitemapEntry[]` where each entry's `description` is in the
 * host's primary locale and `aliases` carries every OTHER locale's label
 * for the same route. Result: the agent + palette match on any language
 * the host has translated for.
 *
 * Usage:
 *
 *   import { buildSitemap } from '@perhapxin/dddk/agent';
 *
 *   const NAV = [
 *     { path: '/',     i18nKey: 'nav.home',  aliases: ['landing'] },
 *     { path: '/docs', i18nKey: 'nav.docs' },
 *   ];
 *
 *   const sitemap = buildSitemap(NAV, {
 *     primaryLocale: 'zh-TW',
 *     allLocales: ['en', 'zh-TW', 'ja'],
 *     i18n: {
 *       en:      { 'nav.home': 'Home',     'nav.docs': 'Documentation' },
 *       'zh-TW': { 'nav.home': '首頁',     'nav.docs': '文件' },
 *       ja:      { 'nav.home': 'ホーム',   'nav.docs': 'ドキュメント' },
 *     },
 *   });
 *   //  [
 *   //    { path: '/',     description: '首頁',  aliases: ['Home', 'ホーム', 'landing'] },
 *   //    { path: '/docs', description: '文件',  aliases: ['Documentation', 'ドキュメント'] },
 *   //  ]
 *
 * Re-call on locale change to reshuffle which locale becomes the
 * primary description — `WebAgent` reads `sitemap` once per turn, so
 * the new sitemap takes effect on the next agent run.
 */

import type { SitemapEntry } from '../webagent/types.js';

export interface NavTarget {
  /** URL path or route id (forwarded to `SitemapEntry.path` verbatim). */
  path: string;
  /**
   * Lookup key into each locale dict. Resolves to the route's short
   * label in each locale (the same string the sidebar / palette show).
   */
  i18nKey: string;
  /**
   * Optional lookup key for the LLM-facing description — a longer
   * sentence that tells the agent what the page actually contains.
   * Without this, the agent only sees the nav label (e.g. "Commercial")
   * and can confuse it with same-named elements on other pages.
   *
   * Defaults to `${i18nKey}.desc` — hosts can just add that key to
   * their dict to opt in.
   */
  descI18nKey?: string;
  /** Extra aliases — domain synonyms, abbreviations, slang. Merged into
   *  the final `aliases` list regardless of locale. */
  aliases?: string[];
}

export interface BuildSitemapOpts {
  /**
   * Locale whose label becomes `SitemapEntry.description`. Pick the
   * locale you expect the user's first message to be in (usually `dddk`'s
   * current `locale` config). Other locales' labels go into `aliases`.
   */
  primaryLocale: string;
  /** Every locale to materialise — including `primaryLocale`. */
  allLocales: string[];
  /**
   * Locale-keyed i18n dict. Each inner dict maps `i18nKey` → translated
   * label. Missing translations are skipped (the alias just doesn't get
   * added for that locale) — no warning.
   */
  i18n: Record<string, Record<string, string>>;
}

export function buildSitemap(targets: NavTarget[], opts: BuildSitemapOpts): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const t of targets) {
    // Prefer the dedicated description key; fall back to the short label.
    // Either way, primary-locale wins; if missing, scan other locales.
    const descKey = t.descI18nKey ?? `${t.i18nKey}.desc`;
    const description =
      opts.i18n[opts.primaryLocale]?.[descKey]
      ?? opts.i18n[opts.primaryLocale]?.[t.i18nKey]
      ?? findAcrossLocales(opts, descKey)
      ?? findAcrossLocales(opts, t.i18nKey);
    if (!description) continue; // nothing usable — skip the entry
    out.push(buildOne(t, description, opts));
  }
  return out;
}

function findAcrossLocales(opts: BuildSitemapOpts, key: string): string | undefined {
  for (const loc of opts.allLocales) {
    const v = opts.i18n[loc]?.[key];
    if (v) return v;
  }
  return undefined;
}

function buildOne(target: NavTarget, description: string, opts: BuildSitemapOpts): SitemapEntry {
  // Aliases are SHORT label translations across locales (so a user
  // typing the nav label in any language matches). Long descriptions
  // are not used as aliases — they would bloat the prompt.
  const aliases = new Set<string>();
  for (const loc of opts.allLocales) {
    if (loc === opts.primaryLocale) continue;
    const v = opts.i18n[loc]?.[target.i18nKey];
    if (v && v !== description) aliases.add(v);
  }
  // The primary-locale short label is also worth including as an alias
  // when description came from the long-desc key — so the user typing
  // the nav label still matches.
  const primaryLabel = opts.i18n[opts.primaryLocale]?.[target.i18nKey];
  if (primaryLabel && primaryLabel !== description) aliases.add(primaryLabel);
  for (const a of target.aliases ?? []) aliases.add(a);
  const entry: SitemapEntry = { path: target.path, description };
  if (aliases.size > 0) entry.aliases = [...aliases];
  return entry;
}
