/**
 * Toolbox — host-facing data tools. Tree-shake-friendly subpath imports preferred:
 *   import { createSearch }    from '@perhapxin/dddk/toolbox/search';
 *   import { createRecommend } from '@perhapxin/dddk/toolbox/recommend';
 */
export * as search    from './search/index.js';
export * as recommend from './recommend/index.js';
export * as common    from './common/index.js';
