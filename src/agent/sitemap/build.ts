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
   * Lookup key into each locale dict. Resolves to the route's label in
   * each locale.
   */
  i18nKey: string;
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
    const primaryLabel = opts.i18n[opts.primaryLocale]?.[t.i18nKey];
    if (!primaryLabel) {
      // No translation in the primary locale — fall back to the first
      // locale that DOES have one, so the entry still shows up.
      let fallback: string | undefined;
      for (const loc of opts.allLocales) {
        const v = opts.i18n[loc]?.[t.i18nKey];
        if (v) { fallback = v; break; }
      }
      if (!fallback) continue; // nothing to show — skip the entry entirely
      out.push(buildOne(t, fallback, opts));
      continue;
    }
    out.push(buildOne(t, primaryLabel, opts));
  }
  return out;
}

function buildOne(target: NavTarget, description: string, opts: BuildSitemapOpts): SitemapEntry {
  const aliases = new Set<string>();
  for (const loc of opts.allLocales) {
    if (loc === opts.primaryLocale) continue;
    const v = opts.i18n[loc]?.[target.i18nKey];
    if (v && v !== description) aliases.add(v);
  }
  for (const a of target.aliases ?? []) aliases.add(a);
  const entry: SitemapEntry = { path: target.path, description };
  if (aliases.size > 0) entry.aliases = [...aliases];
  return entry;
}
