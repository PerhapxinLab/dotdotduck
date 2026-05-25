/**
 * Toolbox — two host-facing data tools that are still being tuned:
 * search and recommend. Each accepts host data + can sync with the
 * host's database (`bootstrap` / `subscribe` / `fetchDelta`), and the
 * algorithms consume dddk-collected telemetry to update ranking over
 * time (`learnRankingWeights` on search; preference store on recommend).
 *
 * Things that used to live here moved to where they actually belong:
 *   - memory     → `@perhapxin/dddk/agent` (long-term recall for the agent)
 *   - proactive  → `@perhapxin/dddk/modules/proactive`
 *   - analytics  → `@perhapxin/dddk/modules/analytics`
 *   - storage    → `dddk/utils/storage` (internal plumbing)
 *   - qa         → `dddk.palette.addQAItems()` for browse UX +
 *                  `dddk.tools.registerQA()` for the agent tool —
 *                  the standalone module added no value over palette + search
 *   - language / Naive-Bayes classifier / Porter stemmer  → DELETED
 *     (anti-pattern: locked the SDK to two languages — see feedback memory)
 *
 * Tree-shake-friendly subpath imports preferred:
 *   import { createSearch }    from '@perhapxin/dddk/toolbox/search';
 *   import { createRecommend } from '@perhapxin/dddk/toolbox/recommend';
 */
export * as search    from './search/index.js';
export * as recommend from './recommend/index.js';
export * as common    from './common/index.js';
