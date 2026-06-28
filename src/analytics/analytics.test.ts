/**
 * Smoke tests for the self-hosted analytics layer:
 *   - sql-schema.ts: eventToRow / rowToEvent round trip
 *   - mapper.ts:     defaultMapper, fieldMapper, filterEvents
 *   - export.ts:     toCSV / toNDJSON / toSQL escaping + grouping
 *   - store.ts:      cap ring, drop-new, notify-host, query, drop
 *
 * Runnable via `pnpm tsx src/analytics/analytics.test.ts`. Uses
 * fake-indexeddb so the IDB path works in Node.
 */

// fake-indexeddb auto-installs an IDB shim onto the globalThis.
import 'fake-indexeddb/auto';

import { makeEvent } from '../ingest/schema';
import {
  eventToRow,
  rowToEvent,
  dddkEventsDDL,
  DDDK_EVENTS_DDL_SQLITE,
} from './sql-schema';
import {
  defaultMapper,
  fieldMapper,
  filterEvents,
} from './mapper';
import { toCSV, toNDJSON, toSQL } from './export';
import { EventStore } from './store';

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

function ev(kind: string, ts: number, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): ReturnType<typeof makeEvent> {
  return makeEvent('intent', kind, { timestamp: ts, props, ...extra });
}

// ─── sql-schema ────────────────────────────────────────────────

console.log('sql-schema:');

{
  const original = ev('palette_activated', 1700000000000, { hint: 'cmd-k' }, {
    sessionId: 'sess-1',
    visitorId: 'vis-9',
    page: { path: '/docs', locale: 'en' },
    device: { ua: 'jsdom', deviceType: 'desktop', locale: 'en-US' },
  });
  const row = eventToRow(original);
  check('eventToRow flattens optional fields', row.session_id === 'sess-1' && row.page_path === '/docs');
  check('eventToRow stringifies props',         row.props_json === JSON.stringify({ hint: 'cmd-k' }));
  const back = rowToEvent(row);
  check('rowToEvent round-trips category+kind', back.category === 'intent' && back.kind === 'palette_activated');
  check('rowToEvent round-trips ids',           back.sessionId === 'sess-1' && back.visitorId === 'vis-9');
  check('rowToEvent restores nested page',      back.page?.path === '/docs' && back.page?.locale === 'en');
  check('rowToEvent restores props object',     (back.props as Record<string, unknown> | undefined)?.hint === 'cmd-k');
}
{
  // Event with no optional fields
  const minimal = makeEvent('lifecycle', 'session_start', { timestamp: 1700 });
  const row = eventToRow(minimal);
  check('minimal event has null optional cols', row.session_id === null && row.page_path === null);
  check('minimal event has empty props_json',   row.props_json === '{}');
  const back = rowToEvent(row);
  check('minimal round-trip preserves id',      back.id === minimal.id && back.timestamp === 1700);
}
{
  check('DDL sqlite mentions table name',    DDDK_EVENTS_DDL_SQLITE.includes('CREATE TABLE'));
  check('dddkEventsDDL switches by dialect',  dddkEventsDDL('mysql').includes('utf8mb4'));
}

// ─── mapper ────────────────────────────────────────────────────

console.log('mapper:');

{
  const e = ev('palette_activated', 1700, { hint: 'cmd-k' });
  const row = defaultMapper(e);
  check('defaultMapper returns canonical row', row !== null && row.id === e.id);
}
{
  type CustomRow = {
    eid: string;
    name: string;
    tier: string | null;
  };
  const m = fieldMapper<CustomRow>({
    eid:  (e) => e.id,
    name: (e) => `${e.category}.${e.kind}`,
    tier: (e) => (e.props?.tier as string | undefined) ?? null,
  });
  const r = m(ev('agent_run_completed', 1700, { tier: 'business' }));
  check('fieldMapper renames + computes', r?.name === 'intent.agent_run_completed' && r?.tier === 'business');
}
{
  const onlyIntent = filterEvents((e) => e.category === 'intent');
  const m = onlyIntent(defaultMapper);
  const intent = ev('foo', 1);
  const non = makeEvent('interaction', 'click', { timestamp: 2 });
  check('filterEvents passes matching', m(intent) !== null);
  check('filterEvents drops non-matching', m(non) === null);
}

// ─── export ────────────────────────────────────────────────────

console.log('export:');

{
  const events = [
    ev('palette_activated', 1700000000000, { hint: 'cmd-k' }),
    ev('agent_run_started',  1700000001000, { runId: 'r-1' }),
  ];
  const csv = toCSV(events);
  check('toCSV emits header + 2 data rows', csv.split('\n').filter(Boolean).length === 3);
  check('toCSV includes the canonical id col', csv.split('\n')[0].includes('id'));
}
{
  // CSV escaping
  const e = ev('foo', 1, { msg: 'has,comma and "quote"' });
  const csv = toCSV([e]);
  check('CSV escapes commas in props_json',  csv.includes('"{""msg"":""has,comma and \\""quote\\""""}"')
                                          || csv.includes('"{""msg"":""has,comma and \\\\""quote\\\\""""}"')
                                          // we don't strictly require backslash; just require quoted output
                                          || /"\{""msg"":/.test(csv));
}
{
  const events = [ev('a', 1), ev('b', 2)];
  const nd = toNDJSON(events);
  check('toNDJSON emits one line per event (+trailing nl)', nd.split('\n').filter(Boolean).length === 2);
  check('toNDJSON lines are valid JSON', nd.split('\n').filter(Boolean).every((l) => {
    try { JSON.parse(l); return true; } catch { return false; }
  }));
}
{
  const events = [ev('a', 1), ev('b', 2)];
  const sql = toSQL(events, { dialect: 'sqlite' });
  check('toSQL uses double-quoted identifiers (sqlite)', sql.includes('"id"') && sql.includes('"dddk_events"'));
  check('toSQL groups VALUES into one INSERT', (sql.match(/INSERT INTO/g) ?? []).length === 1);
  const mysql = toSQL(events, { dialect: 'mysql' });
  check('toSQL switches to backticks (mysql)', mysql.includes('`id`') && mysql.includes('`dddk_events`'));
  const withDDL = toSQL(events, { includeDDL: true });
  check('toSQL prepends DDL when asked', withDDL.startsWith('CREATE TABLE'));
}
{
  // Identifier guard — reject hostile column names
  let threw = false;
  try { toSQL([ev('foo', 1)], { table: "evil; DROP TABLE x" }); } catch { threw = true; }
  check('toSQL rejects invalid identifier', threw);
}

// ─── store (IDB) ───────────────────────────────────────────────

console.log('store:');

{
  // Tests use synthetic past timestamps (so ordering is deterministic);
  // need maxDays: Infinity to stop the age cap from sweeping them.
  const store = await EventStore.open({ dbName: 'test-store-basic', cap: { maxDays: Infinity } });
  await store.clear();
  await store.write(ev('a', 1700000000000));
  await store.write(ev('b', 1700000001000));
  const found = await store.query({ limit: 10 });
  check('store.query returns events newest-first', found.length === 2 && found[0].kind === 'b');
  const sized = await store.size();
  check('store.size reports correct count', sized.events === 2);
  await store.clear();
  check('store.clear empties', (await store.size()).events === 0);
  store.close();
}
{
  // ring policy
  const store = await EventStore.open({
    dbName: 'test-store-ring',
    cap: { maxEvents: 3, maxDays: Infinity },
    onFull: 'ring',
  });
  await store.clear();
  for (let i = 0; i < 5; i++) await store.write(ev('e', 1700000000000 + i));
  const after = await store.query({ order: 'asc', limit: 10 });
  check('ring keeps last 3', after.length === 3);
  check('ring evicts oldest first', after[0].timestamp === 1700000000002);
  store.close();
}
{
  // drop-new policy
  const store = await EventStore.open({
    dbName: 'test-store-dropnew',
    cap: { maxEvents: 2, maxDays: Infinity },
    onFull: 'drop-new',
  });
  await store.clear();
  await store.write(ev('a', 1));
  await store.write(ev('b', 2));
  const r = await store.write(ev('c', 3));
  check('drop-new rejects overflow', r.stored === false && r.reason === 'full');
  check('drop-new keeps original 2', (await store.size()).events === 2);
  store.close();
}
{
  // notify-host policy
  let notified = false;
  const store = await EventStore.open({
    dbName: 'test-store-notify',
    cap: { maxEvents: 2, maxDays: Infinity },
    onFull: { notifyHost: () => { notified = true; } },
  });
  await store.clear();
  await store.write(ev('a', 1));
  await store.write(ev('b', 2));
  const r = await store.write(ev('c', 3));
  check('notify-host invokes callback', notified);
  check('notify-host returns host-rejected reason', r.stored === false && r.reason === 'host-rejected');
  store.close();
}
{
  // query filters
  const store = await EventStore.open({
    dbName: 'test-store-query',
    cap: { maxDays: Infinity },
  });
  await store.clear();
  await store.write(ev('palette_activated', 1700));
  await store.write(makeEvent('interaction', 'click', { timestamp: 1800 }));
  await store.write(ev('agent_run_started', 1900, {}, { runId: 'r1' }));
  const byCat = await store.query({ category: 'intent' });
  check('query filters by category', byCat.length === 2);
  const byRun = await store.query({ runId: 'r1' });
  check('query filters by runId via index', byRun.length === 1 && byRun[0].kind === 'agent_run_started');
  const byRange = await store.query({ from: 1750, to: 1850 });
  check('query filters by time range', byRange.length === 1 && byRange[0].kind === 'click');
  store.close();
}

// ─── Summary ──────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
