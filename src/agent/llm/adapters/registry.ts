/**
 * Adapter registry — module-level map from id → adapter.
 *
 * IMPORTANT: This module does NOT auto-register the built-in adapters.
 * Per the tsup tree-shake constraint (see project memory
 * `feedback_sdk_seed_tree_shake.md`), side-effect imports are dropped
 * from the bundle, so the host MUST call `seedDefaultAdapters()`
 * explicitly at boot to get the OpenAI/Google/Proxy adapters available.
 *
 * The registry is per-process (module singleton). All `createProvider`
 * / `getAdapter` calls see the same map. Re-registering an id silently
 * replaces the previous adapter — useful when an app wants to swap the
 * default OpenAI adapter for one that hits an internal proxy.
 */

import type { LLMProvider } from '../types';
import type { LLMAdapter, AdapterConfig } from './types';

const registry = new Map<string, LLMAdapter>();

/** Register or replace an adapter by id. */
export function registerAdapter(adapter: LLMAdapter): void {
  registry.set(adapter.id, adapter);
}

/** Get an adapter by id, or undefined if not registered. */
export function getAdapter(id: string): LLMAdapter | undefined {
  return registry.get(id);
}

/** All currently-registered adapters (insertion order). */
export function listAdapters(): LLMAdapter[] {
  return [...registry.values()];
}

/** Remove an adapter from the registry. Returns whether it existed. */
export function unregisterAdapter(id: string): boolean {
  return registry.delete(id);
}

/**
 * Build a provider from either:
 *   1. A `"<adapter>:<model>"` spec string (`"openai:gpt-5.4-mini"`)
 *      — looks up the adapter, calls `.create({ model })` against it.
 *      Caller can pass extra `{ apiKey, baseURL, ... }` via the second arg.
 *   2. A config object with an explicit `adapter` field.
 *
 * Throws if no adapter is registered for the given id. We throw instead
 * of returning null because a missing adapter is almost always a boot-
 * order bug (forgot `seedDefaultAdapters()`) and a loud failure
 * surfaces it faster than a silent `null`.
 */
export function createProvider(
  spec: string | (AdapterConfig & { adapter: string }),
  extra?: AdapterConfig,
): LLMProvider {
  if (typeof spec === 'string') {
    const idx = spec.indexOf(':');
    if (idx < 0) throw new Error(`LLM spec must be "<adapter>:<model>", got "${spec}"`);
    const adapterId = spec.slice(0, idx).trim();
    const model = spec.slice(idx + 1).trim();
    return createProvider({ ...(extra ?? {}), adapter: adapterId, model });
  }
  const { adapter: adapterId, ...config } = spec;
  const adapter = registry.get(adapterId);
  if (!adapter) {
    throw new Error(
      `No LLM adapter registered for "${adapterId}". Did you call seedDefaultAdapters()?`,
    );
  }
  return adapter.create(config);
}
