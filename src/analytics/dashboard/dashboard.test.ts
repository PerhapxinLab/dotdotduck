/**
 * Smoke tests for the bundled dashboard.
 *
 *   - queries: aggregation correctness against a populated store
 *   - charts: vanilla SVG primitives produce expected shape
 *   - renderDashboard: mounts six tiles, refresh re-runs queries,
 *     destroy detaches
 *
 * Runnable via `pnpm tsx src/analytics/dashboard/dashboard.test.ts`.
 * Uses fake-indexeddb for the store + happy-dom for the SVG layer.
 */

import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';

// Wire the happy-dom window onto globalThis BEFORE importing modules
// that touch `document` / `SVGElement`.
const win = new Window();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = win;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).document = win.document;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).HTMLElement = win.HTMLElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).SVGElement = win.SVGElement;

import { makeEvent } from '../../ingest/schema';
import { EventStore } from '../store';
import {
  eventsPerDay,
  topPaletteItems,
  agentCompletionRate,
  feedbackDistribution,
} from './queries';
import { lineChart, barChart, donut, numberTile, fmtCompact, fmtPercent } from './charts';
import { renderDashboard } from './index';

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

const DAY = 86_400_000;

async function makeStore(name: string): Promise<EventStore> {
  const store = await EventStore.open({ dbName: name, cap: { maxDays: Infinity } });
  await store.clear();
  return store;
}

// ─── queries ──────────────────────────────────────────────────

console.log('queries:');

{
  const store = await makeStore('test-dash-queries');
  // Seed: 3 events on day 0, 1 on day 1, 0 on day 2.
  const t0 = 1_700_000_000_000;
  await store.write(makeEvent('intent', 'palette_activated', { timestamp: t0,         props: { itemId: 'cmdA' } }));
  await store.write(makeEvent('intent', 'palette_activated', { timestamp: t0 + 1_000, props: { itemId: 'cmdA' } }));
  await store.write(makeEvent('intent', 'palette_activated', { timestamp: t0 + 2_000, props: { itemId: 'cmdB' } }));
  await store.write(makeEvent('intent', 'palette_activated', { timestamp: t0 + DAY,   props: { itemId: 'cmdA' } }));

  const buckets = await eventsPerDay(store, { from: t0, to: t0 + 2 * DAY });
  check('eventsPerDay covers full range (3 days)', buckets.length === 3);
  check('eventsPerDay day 0 = 3', buckets[0].y === 3);
  check('eventsPerDay day 1 = 1', buckets[1].y === 1);
  check('eventsPerDay day 2 = 0', buckets[2].y === 0);

  const top = await topPaletteItems(store, { from: t0, to: t0 + 2 * DAY }, 5);
  check('topPaletteItems sorts by count desc',
        top.length === 2 && top[0].label === 'cmdA' && top[0].value === 3 && top[1].label === 'cmdB' && top[1].value === 1);

  store.close();
}

{
  const store = await makeStore('test-dash-agent');
  const t = 1_700_000_000_000;
  await store.write(makeEvent('intent', 'agent_run_started',   { timestamp: t }));
  await store.write(makeEvent('intent', 'agent_run_started',   { timestamp: t + 1 }));
  await store.write(makeEvent('intent', 'agent_run_completed', { timestamp: t + 2 }));
  await store.write(makeEvent('intent', 'agent_run_stopped',   { timestamp: t + 3 }));

  const cr = await agentCompletionRate(store, { from: t, to: t + 4 });
  check('agentCompletionRate counts started', cr.started === 2);
  check('agentCompletionRate counts completed', cr.completed === 1);
  check('agentCompletionRate counts stopped', cr.stopped === 1);
  check('agentCompletionRate computes 50% rate', Math.abs(cr.rate - 0.5) < 1e-9);

  store.close();
}

{
  const store = await makeStore('test-dash-feedback');
  const t = 1_700_000_000_000;
  await store.write(makeEvent('intent', 'agent_feedback', { timestamp: t,     props: { satisfied: true } }));
  await store.write(makeEvent('intent', 'agent_feedback', { timestamp: t + 1, props: { satisfied: true } }));
  await store.write(makeEvent('intent', 'agent_feedback', { timestamp: t + 2, props: { satisfied: false } }));
  await store.write(makeEvent('intent', 'agent_feedback', { timestamp: t + 3, props: { satisfied: null } }));

  const fb = await feedbackDistribution(store, { from: t, to: t + 4 });
  check('feedbackDistribution counts satisfied true', fb.satisfied === 2);
  check('feedbackDistribution counts unsatisfied false', fb.unsatisfied === 1);
  check('feedbackDistribution counts null as skipped', fb.skipped === 1);

  store.close();
}

// ─── charts (DOM shape) ───────────────────────────────────────

console.log('charts:');

{
  const svg = lineChart([{ x: 1, y: 1 }, { x: 2, y: 3 }, { x: 3, y: 2 }], { title: 'volume' });
  check('lineChart returns an <svg>', svg.tagName.toLowerCase() === 'svg');
  // happy-dom case-sensitivity: querySelector for SVG uses lowercase
  check('lineChart contains a <path>', !!svg.querySelector('path'));
  check('lineChart includes title text', (svg.querySelector('text')?.textContent ?? '').includes('volume'));
}
{
  const svg = barChart([{ label: 'a', value: 5 }, { label: 'b', value: 2 }], { title: 'top' });
  check('barChart renders one rect per row', svg.querySelectorAll('rect').length === 2);
}
{
  const svg = donut(3, 10, { centerLabel: '30%' });
  check('donut has track + arc circles', svg.querySelectorAll('circle').length === 2);
  check('donut shows centre label', (svg.querySelector('text')?.textContent ?? '').includes('30%'));
}
{
  const tile = numberTile({ label: 'sessions', value: 12345 });
  check('numberTile returns an HTMLDivElement', tile.tagName.toLowerCase() === 'div');
  check('numberTile compact-formats large numbers', tile.textContent?.includes('12.3K') ?? false);
}
{
  check('fmtCompact handles billions', fmtCompact(1_234_000_000) === '1.2B');
  check('fmtPercent handles 0', fmtPercent(0) === '0%');
}

// ─── renderDashboard ──────────────────────────────────────────

console.log('renderDashboard:');

{
  const store = await makeStore('test-dash-render');
  await store.write(makeEvent('intent', 'palette_activated', { timestamp: Date.now() - 1000, props: { itemId: 'x' } }));
  await store.write(makeEvent('intent', 'agent_run_started',  { timestamp: Date.now() - 500 }));
  await store.write(makeEvent('intent', 'agent_run_completed',{ timestamp: Date.now() - 250 }));

  const container = win.document.createElement('div');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = await renderDashboard(container as any, store);
  check('renderDashboard mounts six cells', container.children.length === 6);
  const ids = Array.from(container.children).map((c) => (c as HTMLElement).dataset.chart);
  check('cell order matches ALL_CHARTS', ids.join(',') === 'volume,palette,agent-completion,feedback,voice,latency');
  // Refresh should leave the six cells in place.
  await handle.refresh();
  check('refresh keeps six cells', container.children.length === 6);
  // Destroy should clear container and remove the class.
  handle.destroy();
  check('destroy empties the container', container.children.length === 0);
  check('destroy removes dddk-dashboard class', !container.classList.contains('dddk-dashboard'));
  store.close();
}

{
  // Subset of charts + custom range
  const store = await makeStore('test-dash-subset');
  const container = win.document.createElement('div');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = await renderDashboard(container as any, store, {
    charts: ['volume', 'palette'],
    range: { from: Date.now() - 7 * DAY, to: Date.now() },
    locale: 'zh-TW',
  });
  check('renderDashboard honours `charts` subset (2 cells)', container.children.length === 2);
  await handle.setRange({ from: Date.now() - 14 * DAY, to: Date.now() });
  check('setRange keeps the same cell count', container.children.length === 2);
  handle.destroy();
  store.close();
}

// ─── summary ──────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
