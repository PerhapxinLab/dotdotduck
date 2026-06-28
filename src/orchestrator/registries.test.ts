/**
 * Smoke tests for SessionsRegistry + AgentsRegistry.
 *
 * Run via `pnpm tsx src/orchestrator/registries.test.ts`. No DOM or
 * IDB needed — registries are plain Map wrappers + session.ts helpers.
 */

import { SessionsRegistry } from './sessions-registry';
import { AgentsRegistry } from './agents-registry';
import type { WebAgent } from '../agent';

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

// sessionStorage shim — that's what session.ts actually uses. Node has
// neither sessionStorage nor localStorage out of the box.
const memStore = (() => {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    key:        (i: number) => Array.from(store.keys())[i] ?? null,
    getItem:    (k: string) => store.get(k) ?? null,
    setItem:    (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear:      () => { store.clear(); },
  } as Storage;
})();
(globalThis as unknown as { sessionStorage?: Storage }).sessionStorage = memStore;
(globalThis as unknown as { localStorage?: Storage }).localStorage = memStore;

// ─── SessionsRegistry ─────────────────────────────────────────

console.log('SessionsRegistry:');

{
  const reg = new SessionsRegistry();
  const a = reg.get('main', { currentPage: '/docs' });
  check('get() lazily creates a session', a.turns.length === 0 && a.currentPage === '/docs');
  const b = reg.get('main');
  check('get() returns same object on second call', a === b);
  check('has() reflects registered sessions', reg.has('main') && !reg.has('admin'));
  check('list() reports names', reg.list().includes('main'));
}

{
  const reg = new SessionsRegistry();
  const initial = reg.get('main', { currentPage: '/' });
  initial.turns.push({ kind: 'user', ts: Date.now(), text: 'hi' });
  const fresh = reg.reset('main', { currentPage: '/admin' });
  check('reset() returns a different object', fresh !== initial);
  check('reset() empties turns', fresh.turns.length === 0);
  check('reset() updates currentPage', fresh.currentPage === '/admin');
  check('get() after reset returns the fresh one', reg.get('main') === fresh);
}

{
  const reg = new SessionsRegistry();
  const a = reg.get('main', { persistKey: 'test.session', currentPage: '/' });
  a.turns.push({ kind: 'user', ts: Date.now(), text: 'remembered' });
  reg.persist('main');
  // Drop in-memory entry; the registry should re-load from storage.
  reg.clear('main');
  check('clear() with persistKey removes storage entry', sessionStorage.getItem('test.session') === null);

  const a2 = reg.get('main', { persistKey: 'test2.session', currentPage: '/' });
  a2.turns.push({ kind: 'user', ts: Date.now(), text: 'kept' });
  reg.persist('main');
  // Re-open a separate registry — simulate page reload.
  const reg2 = new SessionsRegistry();
  const restored = reg2.get('main', { persistKey: 'test2.session', currentPage: '/' });
  check('persistKey survives a fresh registry', restored.turns.length === 1
        && (restored.turns[0] as { text: string }).text === 'kept');
}

// ─── AgentsRegistry ──────────────────────────────────────────

console.log('AgentsRegistry:');

// Use plain objects shaped like WebAgent for the registry tests —
// we only need to confirm storage / activeName semantics.
function mockAgent(name: string): WebAgent {
  return { name, isRunning: () => false, stop: () => {}, destroy: () => {} } as unknown as WebAgent;
}

{
  const reg = new AgentsRegistry();
  const docs  = mockAgent('docs');
  const admin = mockAgent('admin');
  reg.register('docs', docs);
  reg.register('admin', admin);
  check('register() adds entries',           reg.has('docs') && reg.has('admin'));
  check('first register becomes active',      reg.getActive() === docs);
  check('list() reports both',                reg.list().sort().join(',') === 'admin,docs');
  reg.setActive('admin');
  check('setActive() switches active',        reg.getActive() === admin);
  check('getActiveName() reflects switch',    reg.getActiveName() === 'admin');
  reg.unregister('admin');
  check('unregister() removes',               !reg.has('admin'));
  check('unregister of active clears active', reg.getActive() === null);
  let threw = false;
  try { reg.setActive('nope'); } catch { threw = true; }
  check('setActive throws on unknown name',   threw);
}

// ─── Summary ─────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
