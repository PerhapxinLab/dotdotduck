/**
 * LLM Adapter system — public entry point.
 *
 * Typical boot:
 *
 *   import { seedDefaultAdapters, createProvider } from '@perhapxin/dddk';
 *   seedDefaultAdapters();
 *   const provider = createProvider('google:gemma-4-26b-a4b-it', {
 *     apiKey: env.GOOGLE_API_KEY,
 *   });
 *
 * Custom adapter (e.g. self-hosted vLLM exposing an OpenAI-compatible
 * endpoint at a private URL):
 *
 *   import { registerAdapter, type LLMAdapter } from '@perhapxin/dddk';
 *   registerAdapter({
 *     id: 'company-vllm',
 *     matchesModel: (m) => m.startsWith('vllm/'),
 *     create: (c) => new OpenAIProvider({
 *       apiKey: c.apiKey ?? '',
 *       baseURL: 'https://llm.internal.acme.com/v1',
 *       model: c.model,
 *     }),
 *   });
 *
 * `seedDefaultAdapters()` must be called explicitly — bundlers tree-shake
 * pure side-effect imports.
 */

import { registerAdapter } from './registry';
import { openaiAdapter } from './openai';
import { googleAdapter } from './google';
import { proxyAdapter } from './proxy';
import { agnesAdapter } from './agnes';

export { openaiAdapter, googleAdapter, proxyAdapter, agnesAdapter };
export {
  registerAdapter,
  getAdapter,
  listAdapters,
  unregisterAdapter,
  createProvider,
} from './registry';
export type { LLMAdapter, AdapterConfig } from './types';

/**
 * Register the built-in adapters (`openai`, `google`, `proxy`, `agnes`).
 * Idempotent: safe to call multiple times. Returns the list of registered
 * adapter ids for diagnostic logging.
 */
export function seedDefaultAdapters(): string[] {
  registerAdapter(openaiAdapter);
  registerAdapter(googleAdapter);
  registerAdapter(proxyAdapter);
  registerAdapter(agnesAdapter);
  return [openaiAdapter.id, googleAdapter.id, proxyAdapter.id, agnesAdapter.id];
}
