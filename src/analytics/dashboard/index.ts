/**
 * Bundled mini-dashboard — mount-anywhere stat panel over an
 * `EventStore`.
 *
 * Host opens an EventStore, calls `renderDashboard(container, store)`,
 * and gets six charts: event volume, top palette items, agent
 * completion rate, feedback distribution, voice usage, average LLM
 * latency. The dashboard is vanilla SVG (no charting library) and
 * inherits the host's `--dddk-*` CSS tokens so the colors match
 * whatever theme is wired upstream.
 *
 * NOT a SaaS console replacement. Cross-tenant / RL trajectory
 * export / long-term retention stay in dddk-console (paid). This is
 * the "30-day single-host visibility" tier that gives an OSS user
 * actionable numbers without setting up backend infrastructure.
 */

import type { EventStore } from '../store';
import {
  eventsPerDay,
  topPaletteItems,
  agentCompletionRate,
  feedbackDistribution,
  voiceUsagePerDay,
  avgLatencyPerDay,
  type TimeRange,
} from './queries';
import {
  lineChart,
  barChart,
  donut,
  numberTile,
  fmtCompact,
  fmtPercent,
} from './charts';

export type ChartId =
  | 'volume'
  | 'palette'
  | 'agent-completion'
  | 'feedback'
  | 'voice'
  | 'latency';

export const ALL_CHARTS: ReadonlyArray<ChartId> = [
  'volume',
  'palette',
  'agent-completion',
  'feedback',
  'voice',
  'latency',
];

export interface DashboardOptions {
  /** Window of events to aggregate. Default: last 30 days. */
  range?: TimeRange;
  /**
   * Which charts to render, in this order. Default: all six in the
   * declared order. Pass a subset to drop tiles.
   */
  charts?: ReadonlyArray<ChartId>;
  /** Locale for built-in labels. `'en'` | `'zh-TW'`. Default `'en'`. */
  locale?: 'en' | 'zh-TW';
  /**
   * Auto-refresh interval. `0` disables polling — call `handle.refresh()`
   * manually from `IntentEvent` subscriptions if you want push-style
   * updates. Default `0`.
   */
  refreshIntervalMs?: number;
}

export interface DashboardHandle {
  /** Re-run every query + redraw every chart. */
  refresh(): Promise<void>;
  /** Change the time range; redraws as a side effect. */
  setRange(range: TimeRange): Promise<void>;
  /** Stop auto-refresh and detach DOM. */
  destroy(): void;
}

const I18N = {
  en: {
    volume:           'Events per day',
    palette:          'Top palette commands',
    agent_completion: 'Agent completion',
    feedback:         'User feedback',
    voice:            'Voice activations',
    latency:          'Avg LLM latency (ms)',
    runs_completed:   'completed',
    runs_started:     'started',
    satisfied:        'Satisfied',
    unsatisfied:      'Unsatisfied',
    skipped:          'Skipped',
    range_label:      (n: number) => `Last ${n} days`,
  },
  'zh-TW': {
    volume:           '每日事件量',
    palette:          '最常用的 palette 指令',
    agent_completion: 'Agent 完成率',
    feedback:         '使用者回饋',
    voice:            '語音啟動次數',
    latency:          '平均 LLM 延遲（ms）',
    runs_completed:   '完成',
    runs_started:     '啟動',
    satisfied:        '滿意',
    unsatisfied:      '不滿意',
    skipped:          '略過',
    range_label:      (n: number) => `近 ${n} 天`,
  },
} as const;

const DAY_MS = 86_400_000;

/**
 * Render the dashboard into `container`. Clears the container first.
 * The returned handle controls refresh / range / teardown.
 *
 * Idiomatic usage:
 *   const store = await EventStore.open();
 *   const handle = await renderDashboard(document.getElementById('panel')!, store);
 *   // when host tears down:
 *   handle.destroy();
 */
export async function renderDashboard(
  container: HTMLElement,
  store: EventStore,
  options: DashboardOptions = {},
): Promise<DashboardHandle> {
  let range: TimeRange = options.range ?? { from: Date.now() - 30 * DAY_MS, to: Date.now() };
  const chartIds = options.charts ?? ALL_CHARTS;
  const locale = options.locale ?? 'en';
  const refreshMs = options.refreshIntervalMs ?? 0;
  const labels = I18N[locale];

  // Clear + scaffold.
  container.innerHTML = '';
  container.classList.add('dddk-dashboard');
  Object.assign(container.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '14px',
    padding: '14px',
    background: 'var(--dddk-bg, #fafbfd)',
    color: 'var(--dddk-text, #0a0a0b)',
    fontFamily: 'system-ui, sans-serif',
  });

  // Hold the cells so refresh() can replace them in place.
  const cells = new Map<ChartId, HTMLDivElement>();
  for (const id of chartIds) {
    const cell = document.createElement('div');
    cell.dataset.chart = id;
    cell.style.cssText = [
      'min-height: 120px',
      'padding: 12px',
      'background: var(--dddk-bg-elevated, #ffffff)',
      'border: 1px solid var(--dddk-border, #e5e7eb)',
      'border-radius: 12px',
      'overflow: hidden',
    ].join('; ');
    cells.set(id, cell);
    container.appendChild(cell);
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;

  async function rebuild(): Promise<void> {
    if (destroyed) return;
    const days = Math.max(1, Math.round((range.to - range.from) / DAY_MS));
    const subtitle = labels.range_label(days);

    // Each chart fans out an independent query so a slow one doesn't
    // hold up the rest. Failures fall back to a placeholder so a
    // single bad bucket can't break the whole dashboard.
    await Promise.all(
      chartIds.map(async (id) => {
        const cell = cells.get(id);
        if (!cell) return;
        try {
          const chart = await buildChart(id, store, range, labels, subtitle);
          cell.innerHTML = '';
          cell.appendChild(chart);
        } catch (err) {
          cell.innerHTML = '';
          const msg = document.createElement('div');
          msg.style.cssText = 'padding: 16px; color: var(--dddk-text-muted, #6b7280); font-size: 12px;';
          msg.textContent = `Failed to load ${id}: ${String(err)}`;
          cell.appendChild(msg);
        }
      }),
    );
  }

  await rebuild();

  if (refreshMs > 0) {
    timer = setInterval(() => { void rebuild(); }, refreshMs);
  }

  return {
    refresh: rebuild,
    setRange: async (r) => {
      range = r;
      await rebuild();
    },
    destroy: () => {
      destroyed = true;
      if (timer) clearInterval(timer);
      container.classList.remove('dddk-dashboard');
      container.innerHTML = '';
    },
  };
}

type Labels = typeof I18N['en'] | typeof I18N['zh-TW'];

async function buildChart(
  id: ChartId,
  store: EventStore,
  range: TimeRange,
  labels: Labels,
  subtitle: string,
): Promise<Element> {
  switch (id) {
    case 'volume': {
      const data = await eventsPerDay(store, range);
      return lineChart(data, { title: labels.volume, subtitle, width: 360, height: 180 });
    }
    case 'palette': {
      const data = await topPaletteItems(store, range, 10);
      return barChart(data, { title: labels.palette, subtitle, width: 360 });
    }
    case 'agent-completion': {
      const stats = await agentCompletionRate(store, range);
      // Donut + supporting tile, wrapped together.
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'display: flex; align-items: center; gap: 12px;';
      const ring = donut(stats.completed, Math.max(1, stats.completed + stats.stopped), {
        title: labels.agent_completion,
        subtitle,
        width: 180,
        height: 180,
        centerLabel: fmtPercent(stats.rate),
      });
      wrapper.appendChild(ring);
      const sideInfo = document.createElement('div');
      sideInfo.style.cssText = 'display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--dddk-text-muted, #6b7280);';
      sideInfo.innerHTML = `
        <div><strong style="color: var(--dddk-text, #0a0a0b);">${fmtCompact(stats.completed)}</strong> ${labels.runs_completed}</div>
        <div><strong style="color: var(--dddk-text, #0a0a0b);">${fmtCompact(stats.started)}</strong> ${labels.runs_started}</div>
      `;
      wrapper.appendChild(sideInfo);
      return wrapper;
    }
    case 'feedback': {
      const stats = await feedbackDistribution(store, range);
      const data = [
        { label: labels.satisfied,   value: stats.satisfied },
        { label: labels.unsatisfied, value: stats.unsatisfied },
        { label: labels.skipped,     value: stats.skipped },
      ];
      return barChart(data, { title: labels.feedback, subtitle, width: 360, color: 'var(--dddk-accent, #6366f1)' });
    }
    case 'voice': {
      const data = await voiceUsagePerDay(store, range);
      return lineChart(data, { title: labels.voice, subtitle, width: 360, height: 180 });
    }
    case 'latency': {
      const data = await avgLatencyPerDay(store, range);
      return lineChart(data, { title: labels.latency, subtitle, width: 360, height: 180 });
    }
  }
}

// Re-export the chart primitives so hosts can drop in custom tiles
// alongside the default six.
export {
  lineChart,
  barChart,
  donut,
  numberTile,
  fmtCompact,
  fmtPercent,
} from './charts';
export {
  eventsPerDay,
  topPaletteItems,
  agentCompletionRate,
  feedbackDistribution,
  voiceUsagePerDay,
  avgLatencyPerDay,
} from './queries';
export type { TimeRange, DayBucket, CountSlice, CompletionRate, FeedbackDistribution } from './queries';
