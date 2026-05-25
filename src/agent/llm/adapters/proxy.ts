/**
 * Proxy adapter — wraps `ProxyProvider`. The production-safe pattern for
 * BYOK in browser apps: client → your /api/llm endpoint → vendor. The
 * adapter is registered under id `'proxy'`; `matchesModel` is omitted
 * because proxy routes don't carry a model-id naming convention.
 *
 * Config keys:
 *   - `endpoint`     (string, required) — backend URL
 *   - `method`       ('POST' | 'PUT')
 *   - `headers`      (Record<string,string>)
 *   - `credentials`  (RequestCredentials)
 *   - `buildBody`    ((opts) => unknown)
 *   - `parseResult`  ((raw) => CompleteResult)
 *   - `timeoutMs`    (number)
 *   - `name`         (string)
 *
 * See `ProxyProviderConfig` for the full surface.
 */

import { ProxyProvider, type ProxyProviderConfig } from '../proxy';
import type { LLMAdapter, AdapterConfig } from './types';

export const proxyAdapter: LLMAdapter = {
  id: 'proxy',
  create(config: AdapterConfig) {
    if (typeof config.endpoint !== 'string' || !config.endpoint) {
      throw new Error('proxy adapter requires `endpoint` (string)');
    }
    const cfg: ProxyProviderConfig = {
      endpoint: config.endpoint,
      method: config.method as ProxyProviderConfig['method'],
      headers: config.headers as Record<string, string> | undefined,
      credentials: config.credentials as RequestCredentials | undefined,
      buildBody: config.buildBody as ProxyProviderConfig['buildBody'],
      parseResult: config.parseResult as ProxyProviderConfig['parseResult'],
      name: config.name as string | undefined,
      timeoutMs: config.timeoutMs as number | undefined,
    };
    return new ProxyProvider(cfg);
  },
};
