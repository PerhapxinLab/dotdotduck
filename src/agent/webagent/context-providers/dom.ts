/**
 * Default `dom` context provider.
 *
 * Wraps the SDK's `readDOM` — same logic the runtime calls inline
 * today. Hosts who want different DOM serialization (filtered scope,
 * smaller token budget, custom indexing rules) override via
 * `webagent.registerContextProvider('dom', fn)`.
 *
 * Caveat: the runtime's internal `currentIndexMap` (the map from
 * `[3]`-style indices back to live elements for selector resolution)
 * is owned by the runtime's direct `readDOM` call, NOT by this
 * provider. As of Wave 2·D the runtime continues to use its own
 * `readDOM` invocation for that path; the provider is consulted
 * only where the runtime is being migrated. A host that overrides
 * the dom provider AND wants the runtime to actually consult it
 * will need to wait for the upcoming runtime patch (tracked in
 * docs/v0.2.0-task-agent-and-multi-instance.md).
 *
 * For now the provider is useful for:
 *   - Inspecting what the runtime would land in the prompt
 *     (`agent.contextProviders.get('dom')?.(req)`).
 *   - Composing with other tools (e.g. you want to ship the DOM
 *     dump to an audit log alongside the agent prompt).
 */

import type { ContextProvider } from '../types';
import { readDOM } from '../dom-reader';

export const defaultDomProvider: ContextProvider = () => {
  if (typeof document === 'undefined') return null;
  const result = readDOM();
  return result.text;
};
