/**
 * Smoke tests for WebAgent's live tool + context provider registry.
 *
 * v0.2.0. Run via:
 *   pnpm tsx src/agent/webagent/registry.test.ts
 *
 * Covers:
 *   - registerAction / registerTool return ToolHandle with working remove
 *   - unregisterAction returns boolean correctly
 *   - registerContextProvider returns ContextProviderHandle; remove restores prior binding
 *   - unregisterContextProvider returns boolean correctly
 */

import { WebAgent } from './webagent';
import type { ActionDefinition, ContextProvider } from './types';

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
  }
}

// Stub LLM source — none of these tests fire a turn, we just touch
// the public registry surface.
const fakeLlm = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  complete: () => Promise.reject(new Error('fakeLlm.complete should not be called in registry tests')),
} as unknown as Parameters<typeof WebAgent>['0']['llm'];

function makeAction(name: string): ActionDefinition {
  return {
    name,
    description: `test action ${name}`,
    parameters: { type: 'object', properties: {} },
    handler: () => ({ ok: true }),
  } as unknown as ActionDefinition;
}

function makeProvider(label: string): ContextProvider {
  return () => label;
}

// ─── tool registry ────────────────────────────────────────────

console.log('tool registry:');

{
  const agent = new WebAgent({ llm: fakeLlm });
  const handle = agent.registerTool(makeAction('custom_lookup'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  check('registerTool stores the action',  (agent as any).actions.has('custom_lookup'));
  check('registerTool returns a handle',   typeof handle.remove === 'function');
  handle.remove();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  check('handle.remove unregisters',       !(agent as any).actions.has('custom_lookup'));
  // Calling twice is idempotent — actions.delete returns false the
  // second time, no throw.
  let threw = false;
  try { handle.remove(); } catch { threw = true; }
  check('handle.remove is idempotent',     !threw);
}

{
  const agent = new WebAgent({ llm: fakeLlm });
  agent.registerAction(makeAction('foo'));
  check('unregisterAction(name) returns true when present',  agent.unregisterAction('foo') === true);
  check('unregisterAction(name) returns false when missing', agent.unregisterAction('foo') === false);
}

// ─── context provider registry ────────────────────────────────

console.log('context provider registry:');

{
  // v0.2·D — defaults are auto-installed in the constructor.
  const agent = new WebAgent({ llm: fakeLlm });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cp = (agent as any).contextProviders as Map<string, ContextProvider>;
  check('constructor installs default for `url`',          cp.has('url'));
  check('constructor installs default for `page_summary`', cp.has('page_summary'));
  check('constructor installs default for `dom`',          cp.has('dom'));
  check('constructor installs default for `screenshot`',   cp.has('screenshot'));
  check('constructor installs default for `history`',      cp.has('history'));
  check('constructor installs default for `selection`',    cp.has('selection'));
  // Host override flips the slot to their function.
  const h1 = agent.registerContextProvider('dom', makeProvider('dump-A'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  check('registerContextProvider stores under role', (agent as any).contextProviders.has('dom'));
  // Replace — handle.remove of the LATER one should restore A, not delete entirely.
  const h2 = agent.registerContextProvider('dom', makeProvider('dump-B'));
  h2.remove();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cur = (agent as any).contextProviders.get('dom') as ContextProvider | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  check('h2.remove restores the prior provider', (cur?.({} as any) ?? '') === 'dump-A');
  // Now remove h1 — slot should fall back to the SDK default.
  h1.remove();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const after = (agent as any).contextProviders.get('dom') as ContextProvider | undefined;
  check('h1.remove falls back to SDK default (slot still populated)', after !== undefined);
}

{
  const agent = new WebAgent({ llm: fakeLlm });
  agent.registerContextProvider('selection', makeProvider('sel-A'));
  check('unregisterContextProvider returns true',   agent.unregisterContextProvider('selection') === true);
  check('unregisterContextProvider returns false on missing', agent.unregisterContextProvider('selection') === false);
}

// ─── Summary ─────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
