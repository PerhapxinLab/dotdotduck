/**
 * Smoke test for resolveInlineScope.
 *
 * Not part of a formal test suite (no test runner wired in yet);
 * runnable via `pnpm tsx src/agent/inline/scoping.test.ts` and prints
 * pass/fail per case. Excluded from the published bundle via the
 * `.test.ts` suffix.
 *
 * Covers:
 *   - empty registry → null
 *   - single scope, direct match
 *   - single scope, ancestor match
 *   - nested scopes, innermost wins
 *   - callback resolver bypass (returns non-null)
 *   - callback resolver fall-through (returns null)
 *   - invalid selector doesn't crash
 */

import { resolveInlineScope, type ScopeEntry, type InlineScopeConfig } from './scoping';

// ─── Minimal JSDOM-style stub ──────────────────────────────────
//
// We can't import jsdom inside the SDK (would balloon devDeps), so we
// roll a tiny DOM mock with just the bits resolveInlineScope touches:
//   - element.matches(selector)
//   - element.parentElement
//
// Each "element" is just { tag, classList, parent }.

interface FakeEl {
  tag: string;
  attrs: Record<string, string>;
  parent: FakeEl | null;
  matches: (selector: string) => boolean;
  get parentElement(): FakeEl | null;
}

function make(tag: string, attrs: Record<string, string> = {}): FakeEl {
  const el: FakeEl = {
    tag,
    attrs,
    parent: null,
    matches(selector: string): boolean {
      // Support only the subset we use in tests:
      //   '[data-x="y"]'   attribute equality
      //   '.foo'           class
      //   'tag'            tag name
      //   'tag.foo'        tag + class
      const m = /^\[([\w-]+)="([^"]+)"\]$/.exec(selector);
      if (m) return this.attrs[m[1]] === m[2];
      const cls = /^\.([\w-]+)$/.exec(selector);
      if (cls) return (this.attrs['class'] ?? '').split(/\s+/).includes(cls[1]);
      const tagCls = /^([\w-]+)\.([\w-]+)$/.exec(selector);
      if (tagCls) {
        return this.tag === tagCls[1]
          && (this.attrs['class'] ?? '').split(/\s+/).includes(tagCls[2]);
      }
      if (/^[\w-]+$/.test(selector)) return this.tag === selector;
      if (selector === 'invalid:::selector') throw new Error('bad selector');
      return false;
    },
    get parentElement(): FakeEl | null {
      return this.parent;
    },
  };
  return el;
}

function nest(...els: FakeEl[]): FakeEl {
  // First element is outermost, last is innermost. Returns innermost.
  for (let i = 1; i < els.length; i++) els[i].parent = els[i - 1];
  return els[els.length - 1];
}

// ─── Assertions ────────────────────────────────────────────────

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

// ─── Cases ────────────────────────────────────────────────────

console.log('resolveInlineScope:');

// Case 1: empty registry → null
{
  const el = make('textarea');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = resolveInlineScope(el as any, [], undefined, 'hello');
  check('empty registry returns null', r === null);
}

// Case 2: single scope, direct match on the element itself
{
  const el = make('textarea', { 'data-region': 'docs' });
  const cfg: InlineScopeConfig = { appendSystemPrompt: 'docs scope' };
  const scopes: ScopeEntry[] = [{ id: 's1', selector: '[data-region="docs"]', config: cfg }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = resolveInlineScope(el as any, scopes, undefined, 'hello');
  check('direct match resolves to scope', r === cfg);
}

// Case 3: single scope, ancestor match (selection inside a wrapper)
{
  const wrapper = make('section', { 'data-region': 'docs' });
  const inner = make('textarea');
  nest(wrapper, inner);
  const cfg: InlineScopeConfig = { appendSystemPrompt: 'ancestor scope' };
  const scopes: ScopeEntry[] = [{ id: 's1', selector: '[data-region="docs"]', config: cfg }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = resolveInlineScope(inner as any, scopes, undefined, 'hello');
  check('ancestor match resolves to scope', r === cfg);
}

// Case 4: nested scopes — innermost wins
{
  const outer = make('section', { 'data-region': 'docs' });
  const inner = make('textarea', { 'class': 'code' });
  nest(outer, inner);
  const outerCfg: InlineScopeConfig = { appendSystemPrompt: 'outer' };
  const innerCfg: InlineScopeConfig = { appendSystemPrompt: 'inner' };
  const scopes: ScopeEntry[] = [
    { id: 's-outer', selector: '[data-region="docs"]', config: outerCfg },
    { id: 's-inner', selector: '.code',                config: innerCfg },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = resolveInlineScope(inner as any, scopes, undefined, 'foo');
  check('nested scopes — innermost wins', r === innerCfg,
        r === outerCfg ? 'got outer' : `got ${r ? 'something else' : 'null'}`);
}

// Case 5: callback resolver bypass (non-null return wins over selectors)
{
  const el = make('textarea', { 'data-region': 'docs' });
  const cbCfg: InlineScopeConfig = { appendSystemPrompt: 'callback won' };
  const selectorCfg: InlineScopeConfig = { appendSystemPrompt: 'selector lost' };
  const scopes: ScopeEntry[] = [{ id: 's1', selector: '[data-region="docs"]', config: selectorCfg }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = resolveInlineScope(el as any, scopes, () => cbCfg, 'hello');
  check('callback bypass beats selector match', r === cbCfg);
}

// Case 6: callback resolver fall-through (returns null → selectors run)
{
  const el = make('textarea', { 'data-region': 'docs' });
  const cfg: InlineScopeConfig = { appendSystemPrompt: 'docs scope' };
  const scopes: ScopeEntry[] = [{ id: 's1', selector: '[data-region="docs"]', config: cfg }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = resolveInlineScope(el as any, scopes, () => null, 'hello');
  check('callback null falls through to selectors', r === cfg);
}

// Case 7: invalid selector doesn't crash, falls through
{
  const el = make('textarea', { 'data-region': 'docs' });
  const cfg: InlineScopeConfig = { appendSystemPrompt: 'docs scope' };
  const scopes: ScopeEntry[] = [
    { id: 's-bad',  selector: 'invalid:::selector',   config: { appendSystemPrompt: 'bad' } },
    { id: 's-good', selector: '[data-region="docs"]', config: cfg },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = resolveInlineScope(el as any, scopes, undefined, 'hello');
  check('invalid selector is skipped, valid one wins', r === cfg);
}

// ─── Summary ──────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
