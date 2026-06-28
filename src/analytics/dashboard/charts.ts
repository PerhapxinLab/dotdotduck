/**
 * Vanilla-SVG chart helpers — line / bar / donut / number tile.
 *
 * Each function returns a fresh `SVGElement` (or `HTMLElement` for the
 * number tile). The dashboard composes these into a grid; nothing
 * here knows about layout.
 *
 * No charting library — the SDK can't afford the ~70KB Chart.js
 * adds. SVG primitives plus 5 lines of math per chart kind covers
 * the six tiles we ship. Hosts who want richer charts read events
 * out of `EventStore.query` and bring their own library.
 *
 * Theming reads from CSS variables — `--dddk-accent` / `--dddk-bg`
 * etc. — so the dashboard inherits the host's theme tokens with
 * zero config.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Compact number format: 1.2K / 3.4M / etc. Falls back to integer. */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
}

/** Percent format, 1 decimal place. */
export function fmtPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  return (ratio * 100).toFixed(1).replace(/\.0$/, '') + '%';
}

/** Day-month label for an x-axis tick. UTC. */
function fmtDayLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

interface ChartOptions {
  width?: number;
  height?: number;
  /** Padding around the plot area — leaves room for axis labels. */
  padding?: { top: number; right: number; bottom: number; left: number };
  /** Accent color override. Defaults to var(--dddk-accent). */
  color?: string;
  /** Optional title above the chart. */
  title?: string;
  /** Optional subtitle below the title (subtler weight). */
  subtitle?: string;
}

function chartFrame(opts: ChartOptions): {
  svg: SVGSVGElement;
  plot: { x: number; y: number; w: number; h: number };
} {
  const width = opts.width ?? 360;
  const height = opts.height ?? 180;
  const pad = opts.padding ?? { top: 28, right: 12, bottom: 22, left: 32 };
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('class', 'dddk-chart');
  svg.style.font = '12px system-ui, sans-serif';
  if (opts.title) {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(pad.left));
    t.setAttribute('y', '14');
    t.setAttribute('class', 'dddk-chart-title');
    t.style.font = 'bold 12px system-ui, sans-serif';
    t.style.fill = 'var(--dddk-text, #0a0a0b)';
    t.textContent = opts.title;
    svg.appendChild(t);
  }
  if (opts.subtitle) {
    const s = document.createElementNS(SVG_NS, 'text');
    s.setAttribute('x', String(pad.left));
    s.setAttribute('y', '14');
    s.setAttribute('dx', '0');
    s.setAttribute('dy', '0');
    s.style.font = '11px system-ui, sans-serif';
    s.style.fill = 'var(--dddk-text-muted, #6b7280)';
    s.textContent = opts.subtitle;
    s.setAttribute('text-anchor', 'end');
    s.setAttribute('x', String(width - pad.right));
    svg.appendChild(s);
  }
  return {
    svg,
    plot: {
      x: pad.left,
      y: pad.top,
      w: width - pad.left - pad.right,
      h: height - pad.top - pad.bottom,
    },
  };
}

// ─── Line chart ────────────────────────────────────────────────

export function lineChart(
  data: Array<{ x: number; y: number }>,
  opts: ChartOptions = {},
): SVGSVGElement {
  const { svg, plot } = chartFrame(opts);
  const color = opts.color ?? 'var(--dddk-accent, #6366f1)';

  if (data.length === 0) {
    appendEmptyMessage(svg, plot);
    return svg;
  }

  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = 0;
  const yMax = Math.max(1, Math.max(...ys));
  const sx = (x: number) => plot.x + ((x - xMin) / (xMax - xMin || 1)) * plot.w;
  const sy = (y: number) => plot.y + plot.h - ((y - yMin) / (yMax - yMin || 1)) * plot.h;

  // Baseline + faint mid grid line.
  appendBaseline(svg, plot);

  // Filled area under the line.
  const areaPath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${sx(d.x)} ${sy(d.y)}`)
    .concat([`L ${sx(xMax)} ${plot.y + plot.h}`, `L ${sx(xMin)} ${plot.y + plot.h}`, 'Z'])
    .join(' ');
  const area = document.createElementNS(SVG_NS, 'path');
  area.setAttribute('d', areaPath);
  area.setAttribute('fill', color);
  area.setAttribute('fill-opacity', '0.12');
  svg.appendChild(area);

  // Line itself.
  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${sx(d.x)} ${sy(d.y)}`).join(' ');
  const line = document.createElementNS(SVG_NS, 'path');
  line.setAttribute('d', linePath);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(line);

  // First / last x labels.
  appendAxisLabel(svg, plot.x, plot.y + plot.h + 14, fmtDayLabel(xMin), 'start');
  appendAxisLabel(svg, plot.x + plot.w, plot.y + plot.h + 14, fmtDayLabel(xMax), 'end');
  // Max y label.
  appendAxisLabel(svg, plot.x - 4, plot.y + 4, fmtCompact(yMax), 'end');

  return svg;
}

// ─── Bar chart ─────────────────────────────────────────────────

export function barChart(
  data: Array<{ label: string; value: number }>,
  opts: ChartOptions = {},
): SVGSVGElement {
  const { svg, plot } = chartFrame({
    height: Math.max(opts.height ?? 0, Math.max(60, data.length * 22 + 40)),
    ...opts,
    padding: { top: 28, right: 12, bottom: 12, left: 110 },
  });
  const color = opts.color ?? 'var(--dddk-accent, #6366f1)';

  if (data.length === 0) {
    appendEmptyMessage(svg, plot);
    return svg;
  }

  const max = Math.max(1, ...data.map((d) => d.value));
  const rowH = plot.h / data.length;
  const barH = Math.min(16, rowH - 4);

  data.forEach((d, i) => {
    const y = plot.y + i * rowH + (rowH - barH) / 2;
    const w = (d.value / max) * plot.w;
    // Label (truncated to fit the left pad).
    const lbl = document.createElementNS(SVG_NS, 'text');
    lbl.setAttribute('x', String(plot.x - 6));
    lbl.setAttribute('y', String(y + barH / 2 + 4));
    lbl.setAttribute('text-anchor', 'end');
    lbl.style.fill = 'var(--dddk-text, #0a0a0b)';
    lbl.style.font = '11px system-ui, sans-serif';
    lbl.textContent = truncate(d.label, 16);
    svg.appendChild(lbl);
    // Bar.
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(plot.x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(Math.max(2, w)));
    rect.setAttribute('height', String(barH));
    rect.setAttribute('rx', '3');
    rect.setAttribute('fill', color);
    rect.setAttribute('fill-opacity', '0.8');
    svg.appendChild(rect);
    // Value at end of bar.
    const val = document.createElementNS(SVG_NS, 'text');
    val.setAttribute('x', String(plot.x + w + 4));
    val.setAttribute('y', String(y + barH / 2 + 4));
    val.style.fill = 'var(--dddk-text-muted, #6b7280)';
    val.style.font = '11px system-ui, sans-serif';
    val.textContent = fmtCompact(d.value);
    svg.appendChild(val);
  });

  return svg;
}

// ─── Donut ─────────────────────────────────────────────────────

export function donut(
  value: number,
  max: number,
  opts: ChartOptions & { centerLabel?: string } = {},
): SVGSVGElement {
  const { svg, plot } = chartFrame({ width: 180, height: 180, ...opts });
  const color = opts.color ?? 'var(--dddk-accent, #6366f1)';
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const r = Math.min(plot.w, plot.h) / 2 - 8;
  const stroke = 14;
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * ratio;

  // Track.
  const bg = document.createElementNS(SVG_NS, 'circle');
  bg.setAttribute('cx', String(cx));
  bg.setAttribute('cy', String(cy));
  bg.setAttribute('r', String(r));
  bg.setAttribute('fill', 'none');
  bg.setAttribute('stroke', 'var(--dddk-border, #e5e7eb)');
  bg.setAttribute('stroke-width', String(stroke));
  svg.appendChild(bg);

  // Value arc — start at 12 o'clock.
  const arc = document.createElementNS(SVG_NS, 'circle');
  arc.setAttribute('cx', String(cx));
  arc.setAttribute('cy', String(cy));
  arc.setAttribute('r', String(r));
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', color);
  arc.setAttribute('stroke-width', String(stroke));
  arc.setAttribute('stroke-dasharray', `${dash} ${circumference - dash}`);
  arc.setAttribute('stroke-dashoffset', `${circumference / 4}`);
  arc.setAttribute('stroke-linecap', 'round');
  arc.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
  svg.appendChild(arc);

  // Center label.
  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('x', String(cx));
  label.setAttribute('y', String(cy + 6));
  label.setAttribute('text-anchor', 'middle');
  label.style.fill = 'var(--dddk-text, #0a0a0b)';
  label.style.font = 'bold 22px system-ui, sans-serif';
  label.textContent = opts.centerLabel ?? fmtPercent(ratio);
  svg.appendChild(label);

  return svg;
}

// ─── Number tile ───────────────────────────────────────────────

export interface NumberTileOptions {
  label: string;
  value: string | number;
  hint?: string;
  /** Trend indicator: '+5%', '-2%', etc. Optional. */
  delta?: string;
  deltaDirection?: 'up' | 'down' | 'flat';
}

/**
 * A simple stat tile — big number, small label. Returns an HTMLDivElement
 * so the dashboard grid can lay it out with the SVG charts.
 */
export function numberTile(opts: NumberTileOptions): HTMLDivElement {
  const tile = document.createElement('div');
  tile.className = 'dddk-tile';
  tile.style.cssText = [
    'display: flex',
    'flex-direction: column',
    'gap: 6px',
    'padding: 16px 18px',
    'background: var(--dddk-bg-elevated, #ffffff)',
    'border: 1px solid var(--dddk-border, #e5e7eb)',
    'border-radius: 10px',
    'font-family: system-ui, sans-serif',
  ].join('; ');
  const lbl = document.createElement('div');
  lbl.style.cssText = 'font-size: 12px; color: var(--dddk-text-muted, #6b7280); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;';
  lbl.textContent = opts.label;
  const val = document.createElement('div');
  val.style.cssText = 'font-size: 28px; font-weight: 700; color: var(--dddk-text, #0a0a0b);';
  val.textContent = typeof opts.value === 'number' ? fmtCompact(opts.value) : opts.value;
  tile.appendChild(lbl);
  tile.appendChild(val);
  if (opts.hint || opts.delta) {
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size: 11px; color: var(--dddk-text-muted, #6b7280);';
    if (opts.delta) {
      const dir = opts.deltaDirection ?? 'flat';
      const color = dir === 'up' ? '#10b981' : dir === 'down' ? '#ef4444' : 'var(--dddk-text-muted, #6b7280)';
      hint.innerHTML = `<span style="color: ${color}; font-weight: 600;">${opts.delta}</span>${opts.hint ? ` · ${opts.hint}` : ''}`;
    } else {
      hint.textContent = opts.hint ?? '';
    }
    tile.appendChild(hint);
  }
  return tile;
}

// ─── helpers ───────────────────────────────────────────────────

function appendBaseline(svg: SVGSVGElement, plot: { x: number; y: number; w: number; h: number }): void {
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(plot.x));
  line.setAttribute('y1', String(plot.y + plot.h));
  line.setAttribute('x2', String(plot.x + plot.w));
  line.setAttribute('y2', String(plot.y + plot.h));
  line.setAttribute('stroke', 'var(--dddk-border, #e5e7eb)');
  line.setAttribute('stroke-width', '1');
  svg.appendChild(line);
}

function appendAxisLabel(svg: SVGSVGElement, x: number, y: number, text: string, anchor: 'start' | 'middle' | 'end'): void {
  const lbl = document.createElementNS(SVG_NS, 'text');
  lbl.setAttribute('x', String(x));
  lbl.setAttribute('y', String(y));
  lbl.setAttribute('text-anchor', anchor);
  lbl.style.fill = 'var(--dddk-text-muted, #6b7280)';
  lbl.style.font = '10px system-ui, sans-serif';
  lbl.textContent = text;
  svg.appendChild(lbl);
}

function appendEmptyMessage(svg: SVGSVGElement, plot: { x: number; y: number; w: number; h: number }): void {
  const msg = document.createElementNS(SVG_NS, 'text');
  msg.setAttribute('x', String(plot.x + plot.w / 2));
  msg.setAttribute('y', String(plot.y + plot.h / 2));
  msg.setAttribute('text-anchor', 'middle');
  msg.style.fill = 'var(--dddk-text-muted, #6b7280)';
  msg.style.font = '12px system-ui, sans-serif';
  msg.textContent = 'No data';
  svg.appendChild(msg);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
