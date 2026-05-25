/**
 * PieceDomRenderer — vanilla-DOM, interactive renderer for `PieceSurface`.
 *
 * Same tree shape and data model as the React `PieceRenderer`, but runs
 * without React so SDK consumers don't need to mount a React tree just
 * to show a Card with a checkbox. Used by:
 *
 *   - palette detail pane (read-only previews of a focused row's piece)
 *   - palette `showResult` host content
 *   - `PinnedPanel` (the corner-anchored card — frame only, body is a surface)
 *
 *   const r = new PieceDomRenderer({ onAction, onDataChange });
 *   r.mount(parent, { root: { kind: 'Stack', children: [...] } });
 *   r.update(nextSurface);
 *   r.unmount();
 *
 * Inputs (`Checkbox` / `Switch` / `TextField` / …) update the local data
 * model and emit `onDataChange`. `Button` / `IconButton` / `Link` emit
 * `onAction(name, payload, data)`.
 */

import type { PieceCatalog, PieceNode, PieceSurface } from './types';

export interface PieceDomRendererOptions {
  catalog?: PieceCatalog;
  /** Read-only mode — inputs render but ignore changes. Default `false`. */
  readOnly?: boolean;
  /** Fired by Button / IconButton / Link clicks. */
  onAction?: (name: string, payload: unknown, data: Record<string, unknown>) => void;
  /** Fired on every data-model mutation. */
  onDataChange?: (data: Record<string, unknown>) => void;
}

export class PieceDomRenderer {
  private opts: PieceDomRendererOptions;
  private data: Record<string, unknown> = {};
  private surface: PieceSurface | null = null;
  private host: HTMLElement | null = null;

  constructor(opts: PieceDomRendererOptions = {}) {
    this.opts = opts;
  }

  mount(parent: HTMLElement, surface: PieceSurface): void {
    this.host = parent;
    this.surface = surface;
    this.data = { ...(surface.data ?? {}) };
    this.repaint();
  }

  update(surface: PieceSurface): void {
    this.surface = surface;
    // Preserve any user edits — merge incoming data on top of existing.
    this.data = { ...this.data, ...(surface.data ?? {}) };
    this.repaint();
  }

  setData(data: Record<string, unknown>): void {
    this.data = { ...data };
    this.opts.onDataChange?.(this.data);
    this.repaint();
  }

  getData(): Record<string, unknown> {
    return { ...this.data };
  }

  unmount(): void {
    if (this.host) this.host.innerHTML = '';
    this.host = null;
    this.surface = null;
  }

  private repaint(): void {
    if (!this.host || !this.surface) return;
    this.host.innerHTML = '';
    this.host.appendChild(this.renderNode(this.surface.root));
  }

  private setBinding(path: string, value: unknown): void {
    if (this.opts.readOnly || !path) return;
    this.data = applyPointer(this.data, path, value);
    this.opts.onDataChange?.(this.data);
    this.repaint();
  }

  private trigger(name: string, payload?: unknown): void {
    this.opts.onAction?.(name, payload, this.data);
  }

  private read<T>(node: PieceNode, key: string, fallback?: T): T {
    if (node.bind) {
      const v = readPointer(this.data, String(node.bind));
      if (v !== undefined) return v as T;
    }
    const lit = node[key];
    if (lit !== undefined) return lit as T;
    return fallback as T;
  }

  private renderChildren(node: PieceNode): HTMLElement[] {
    const children = (node.children as PieceNode[] | undefined) ?? [];
    return children.map((c) => this.renderNode(c));
  }

  private renderNode(node: PieceNode): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-dddk-piece', node.kind.toLowerCase());

    switch (node.kind) {
      // ─── Layout ──────────────────────────────────────────────────
      case 'Stack': {
        el.style.display = 'flex';
        el.style.flexDirection = node.direction === 'horizontal' ? 'row' : 'column';
        el.style.gap = px(node.gap, 8);
        el.style.alignItems = String(node.align ?? 'stretch');
        this.appendAll(el, this.renderChildren(node));
        return el;
      }
      case 'Grid': {
        el.style.display = 'grid';
        el.style.gridTemplateColumns = `repeat(${Number(node.columns ?? 2)}, minmax(0,1fr))`;
        el.style.gap = px(node.gap, 8);
        this.appendAll(el, this.renderChildren(node));
        return el;
      }
      case 'Split': {
        el.style.display = 'grid';
        el.style.gridTemplateColumns = '1fr 1fr';
        el.style.gap = '12px';
        this.appendAll(el, this.renderChildren(node));
        return el;
      }
      case 'Card': {
        el.style.background = 'var(--dddk-bg-elevated, #fff)';
        el.style.borderRadius = 'var(--dddk-radius, 12px)';
        el.style.padding = '16px';
        el.style.boxShadow = 'var(--dddk-shadow-md, 0 1px 3px rgba(0,0,0,0.05))';
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.gap = '12px';
        this.appendAll(el, this.renderChildren(node));
        return el;
      }
      case 'Tabs': {
        const tabs = (node.tabs as Array<{ id: string; label: string; content: PieceNode }>) ?? [];
        const activeKey = node.bind ?? (node.id ? `__activeTab_${node.id}` : '__activeTab');
        const active = (this.read<string>(
          { kind: 'Tabs', bind: activeKey } as PieceNode,
          'active',
          tabs[0]?.id ?? '',
        )) || tabs[0]?.id;

        const bar = document.createElement('div');
        bar.style.display = 'flex';
        bar.style.gap = '8px';
        bar.style.borderBottom = '1px solid var(--dddk-border, rgba(0,0,0,0.08))';
        for (const t of tabs) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = t.label;
          btn.style.padding = '6px 12px';
          btn.style.background = 'transparent';
          btn.style.border = '0';
          btn.style.borderBottom = t.id === active
            ? '2px solid var(--dddk-accent, #6366f1)'
            : '2px solid transparent';
          btn.style.cursor = 'pointer';
          btn.style.font = 'inherit';
          btn.addEventListener('click', () => this.setBinding(String(activeKey), t.id));
          bar.appendChild(btn);
        }
        el.appendChild(bar);

        const panel = document.createElement('div');
        panel.style.padding = '12px';
        const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];
        if (activeTab) panel.appendChild(this.renderNode(activeTab.content));
        el.appendChild(panel);
        return el;
      }

      // ─── Content ─────────────────────────────────────────────────
      case 'Heading': {
        const level = Math.min(6, Math.max(1, Number(node.level ?? 3)));
        const h = document.createElement(`h${level}`);
        h.style.margin = '0 0 8px 0';
        h.textContent = this.read<string>(node, 'text', '');
        el.appendChild(h);
        return el;
      }
      case 'Text': {
        el.style.display = 'inline';
        el.textContent = this.read<string>(node, 'text', '');
        return el;
      }
      case 'Markdown': {
        el.style.whiteSpace = 'pre-wrap';
        el.textContent = this.read<string>(node, 'text', '');
        return el;
      }
      case 'Code': {
        const pre = document.createElement('pre');
        pre.style.cssText =
          'background:var(--dddk-bg, #fafafa);padding:8px;border-radius:6px;' +
          'font-family:var(--dddk-font-mono, ui-monospace, monospace);' +
          'font-size:12px;margin:0;overflow-x:auto;';
        pre.textContent = this.read<string>(node, 'code', '');
        el.appendChild(pre);
        return el;
      }
      case 'Image': {
        const img = document.createElement('img');
        img.src = String(node.src ?? '');
        img.alt = String(node.alt ?? '');
        img.style.cssText = 'max-width:100%;border-radius:6px;';
        el.appendChild(img);
        return el;
      }
      case 'Tag': {
        const tone = String(node.tone ?? 'neutral');
        const tones: Record<string, { bg: string; fg: string }> = {
          neutral: { bg: 'rgba(0,0,0,0.06)', fg: 'inherit' },
          success: { bg: 'rgba(16,185,129,0.12)', fg: '#10b981' },
          warning: { bg: 'rgba(245,158,11,0.12)', fg: '#f59e0b' },
          error:   { bg: 'rgba(239,68,68,0.12)',  fg: '#ef4444' },
          info:    { bg: 'rgba(59,130,246,0.12)', fg: '#3b82f6' },
        };
        const c = tones[tone] ?? tones.neutral!;
        const span = document.createElement('span');
        span.style.cssText =
          `background:${c.bg};color:${c.fg};padding:2px 8px;border-radius:12px;` +
          'font-size:11px;font-weight:500;display:inline-block;';
        span.textContent = String(node.text ?? '');
        el.appendChild(span);
        return el;
      }
      case 'Divider': {
        const hr = document.createElement('hr');
        hr.style.cssText = 'border:0;border-top:1px solid var(--dddk-border, rgba(0,0,0,0.08));margin:8px 0;';
        el.appendChild(hr);
        return el;
      }

      // ─── Data ────────────────────────────────────────────────────
      case 'Listing': {
        type Item = { id: string; title: string; subtitle?: string; accessory?: string; icon?: string };
        const items = this.read<Item[]>(node, 'items', []);
        const ul = document.createElement('ul');
        ul.style.cssText = 'list-style:none;margin:0;padding:0;';
        for (const it of items) {
          const li = document.createElement('li');
          li.style.cssText =
            'display:flex;gap:8px;padding:6px 8px;' +
            'border-bottom:1px solid var(--dddk-border, rgba(0,0,0,0.05));';
          if (it.icon) {
            const ic = document.createElement('span');
            ic.textContent = it.icon;
            li.appendChild(ic);
          }
          const text = document.createElement('div');
          text.style.cssText = 'flex:1;min-width:0;';
          const t = document.createElement('div');
          t.textContent = it.title;
          text.appendChild(t);
          if (it.subtitle) {
            const s = document.createElement('small');
            s.style.color = 'var(--dddk-text-muted, #6b6b6b)';
            s.textContent = it.subtitle;
            text.appendChild(s);
          }
          li.appendChild(text);
          if (it.accessory) {
            const a = document.createElement('span');
            a.style.color = 'var(--dddk-text-muted, #6b6b6b)';
            a.textContent = it.accessory;
            li.appendChild(a);
          }
          ul.appendChild(li);
        }
        el.appendChild(ul);
        return el;
      }
      case 'Table': {
        const columns = (node.columns as Array<{ key: string; label: string }>) ?? [];
        const rows = this.read<Array<Record<string, unknown>>>(node, 'rows', []);
        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;';
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const c of columns) {
          const th = document.createElement('th');
          th.style.cssText =
            'text-align:left;padding:6px;border-bottom:1px solid var(--dddk-border, rgba(0,0,0,0.08));';
          th.textContent = c.label;
          headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        for (const r of rows) {
          const tr = document.createElement('tr');
          for (const c of columns) {
            const td = document.createElement('td');
            td.style.cssText =
              'padding:6px;border-bottom:1px solid var(--dddk-border, rgba(0,0,0,0.05));';
            td.textContent = String(r[c.key] ?? '');
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        el.appendChild(table);
        return el;
      }
      case 'Metric': {
        const trend = String(node.trend ?? 'flat');
        const color = trend === 'up' ? '#10b981' : trend === 'down' ? '#ef4444' : '#6b6b6b';
        const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '–';
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
        if (node.label) {
          const lbl = document.createElement('span');
          lbl.style.cssText = 'font-size:11px;color:var(--dddk-text-muted, #6b6b6b);';
          lbl.textContent = String(node.label);
          wrap.appendChild(lbl);
        }
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:baseline;gap:8px;';
        const strong = document.createElement('strong');
        strong.style.fontSize = '22px';
        strong.textContent = String(node.value ?? '');
        row.appendChild(strong);
        if (node.delta != null) {
          const d = document.createElement('span');
          d.style.cssText = `color:${color};font-size:12px;`;
          d.textContent = `${arrow} ${node.delta}`;
          row.appendChild(d);
        }
        wrap.appendChild(row);
        el.appendChild(wrap);
        return el;
      }
      case 'Timeline': {
        type Evt = { id: string; time: string; title: string; note?: string };
        const events = this.read<Evt[]>(node, 'events', []);
        const ol = document.createElement('ol');
        ol.style.cssText =
          'list-style:none;margin:0;padding:0;border-left:2px solid var(--dddk-border, rgba(0,0,0,0.08));';
        for (const e of events) {
          const li = document.createElement('li');
          li.style.cssText = 'margin-left:12px;padding-left:12px;padding-bottom:12px;position:relative;';
          li.innerHTML = `
            <span style="position:absolute;left:-19px;top:6px;width:8px;height:8px;border-radius:50%;
              background:var(--dddk-accent, #6366f1);"></span>
            <small style="color:var(--dddk-text-muted, #6b6b6b)">${escapeHtml(e.time)}</small>
            <div>${escapeHtml(e.title)}</div>
            ${e.note ? `<small style="color:var(--dddk-text-muted, #6b6b6b)">${escapeHtml(e.note)}</small>` : ''}
          `;
          ol.appendChild(li);
        }
        el.appendChild(ol);
        return el;
      }

      // ─── Input ───────────────────────────────────────────────────
      case 'TextField':
      case 'PasswordField': {
        const f = this.fieldWrap(node);
        const input = document.createElement('input');
        input.type = node.kind === 'PasswordField' ? 'password' : 'text';
        applyInputStyle(input);
        input.value = String(this.read<string>(node, 'value', '') ?? '');
        if (node.placeholder) input.placeholder = String(node.placeholder);
        input.addEventListener('input', () => {
          if (node.bind) this.setBinding(String(node.bind), input.value);
        });
        f.appendChild(input);
        el.appendChild(f);
        return el;
      }
      case 'TextArea': {
        const f = this.fieldWrap(node);
        const ta = document.createElement('textarea');
        applyInputStyle(ta);
        ta.rows = Number(node.rows ?? 3);
        ta.value = String(this.read<string>(node, 'value', '') ?? '');
        if (node.placeholder) ta.placeholder = String(node.placeholder);
        ta.addEventListener('input', () => {
          if (node.bind) this.setBinding(String(node.bind), ta.value);
        });
        f.appendChild(ta);
        el.appendChild(f);
        return el;
      }
      case 'NumberField': {
        const f = this.fieldWrap(node);
        const input = document.createElement('input');
        input.type = 'number';
        applyInputStyle(input);
        input.value = String(this.read<number>(node, 'value', 0) ?? 0);
        if (node.min != null) input.min = String(node.min);
        if (node.max != null) input.max = String(node.max);
        if (node.step != null) input.step = String(node.step);
        input.addEventListener('input', () => {
          if (node.bind) this.setBinding(String(node.bind), Number(input.value));
        });
        f.appendChild(input);
        el.appendChild(f);
        return el;
      }
      case 'Checkbox': {
        const lbl = document.createElement('label');
        lbl.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer;';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = Boolean(this.read<boolean>(node, 'value', false));
        input.addEventListener('change', () => {
          if (node.bind) this.setBinding(String(node.bind), input.checked);
        });
        lbl.appendChild(input);
        const span = document.createElement('span');
        span.textContent = String(node.label ?? '');
        lbl.appendChild(span);
        el.appendChild(lbl);
        return el;
      }
      case 'Switch': {
        const checked = Boolean(this.read<boolean>(node, 'value', false));
        const lbl = document.createElement('label');
        lbl.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer;';
        const track = document.createElement('span');
        track.style.cssText =
          'width:32px;height:18px;border-radius:9px;position:relative;display:inline-block;' +
          `background:${checked ? 'var(--dddk-accent, #6366f1)' : 'rgba(0,0,0,0.2)'};` +
          'transition:background 120ms;';
        const knob = document.createElement('span');
        knob.style.cssText =
          `position:absolute;top:2px;left:${checked ? 16 : 2}px;` +
          'width:14px;height:14px;border-radius:50%;background:#fff;transition:left 120ms;';
        track.appendChild(knob);
        track.addEventListener('click', () => {
          if (node.bind) this.setBinding(String(node.bind), !checked);
        });
        lbl.appendChild(track);
        if (node.label) {
          const span = document.createElement('span');
          span.textContent = String(node.label);
          lbl.appendChild(span);
        }
        el.appendChild(lbl);
        return el;
      }
      case 'Picker': {
        const f = this.fieldWrap(node);
        const sel = document.createElement('select');
        applyInputStyle(sel);
        const opts = (node.options as Array<string | { value: string; label: string }>) ?? [];
        const current = String(this.read<string>(node, 'value', '') ?? '');
        for (const o of opts) {
          const v = typeof o === 'string' ? o : o.value;
          const l = typeof o === 'string' ? o : o.label;
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = l;
          if (v === current) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener('change', () => {
          if (node.bind) this.setBinding(String(node.bind), sel.value);
        });
        f.appendChild(sel);
        el.appendChild(f);
        return el;
      }
      case 'DatePicker': {
        const f = this.fieldWrap(node);
        const input = document.createElement('input');
        input.type = 'datetime-local';
        applyInputStyle(input);
        input.value = String(this.read<string>(node, 'value', '') ?? '');
        input.addEventListener('input', () => {
          if (node.bind) this.setBinding(String(node.bind), input.value);
        });
        f.appendChild(input);
        el.appendChild(f);
        return el;
      }
      case 'Slider': {
        const f = this.fieldWrap(node);
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(node.min ?? 0);
        input.max = String(node.max ?? 100);
        input.step = String(node.step ?? 1);
        input.value = String(this.read<number>(node, 'value', 0) ?? 0);
        input.addEventListener('input', () => {
          if (node.bind) this.setBinding(String(node.bind), Number(input.value));
        });
        f.appendChild(input);
        el.appendChild(f);
        return el;
      }
      case 'FilePicker': {
        const f = this.fieldWrap(node);
        const input = document.createElement('input');
        input.type = 'file';
        if (node.accept) input.accept = String(node.accept);
        if (node.multiple) input.multiple = true;
        input.addEventListener('change', () => {
          if (!node.bind) return;
          this.setBinding(String(node.bind), Array.from(input.files ?? []));
        });
        f.appendChild(input);
        el.appendChild(f);
        return el;
      }

      // ─── Action ──────────────────────────────────────────────────
      case 'Button': {
        const variant = String(node.variant ?? 'primary');
        const btn = document.createElement('button');
        btn.type = 'button';
        const styles: Record<string, string> = {
          primary:
            'background:var(--dddk-accent, #6366f1);color:var(--dddk-text-on-accent, #fff);border:0;',
          secondary:
            'background:transparent;color:inherit;border:1px solid var(--dddk-border, rgba(0,0,0,0.15));',
          destructive: 'background:#ef4444;color:#fff;border:0;',
        };
        btn.style.cssText =
          `${styles[variant] ?? styles.primary!}` +
          'padding:6px 14px;border-radius:6px;font:inherit;cursor:pointer;font-weight:500;';
        btn.textContent = String(node.text ?? '');
        btn.addEventListener('click', () => this.trigger(String(node.action ?? 'submit'), node.payload));
        el.appendChild(btn);
        return el;
      }
      case 'Link': {
        const a = document.createElement('a');
        a.href = String(node.href ?? '#');
        if (node.target) a.target = String(node.target);
        a.style.cssText = 'color:var(--dddk-accent, #6366f1);text-decoration:underline;cursor:pointer;';
        a.textContent = String(node.text ?? '');
        el.appendChild(a);
        return el;
      }
      case 'IconButton': {
        const btn = document.createElement('button');
        btn.type = 'button';
        if (node.title) btn.title = String(node.title);
        btn.style.cssText = 'background:transparent;border:0;cursor:pointer;padding:4px;font-size:16px;';
        btn.textContent = String(node.icon ?? '');
        btn.addEventListener('click', () => this.trigger(String(node.action ?? 'click'), node.payload));
        el.appendChild(btn);
        return el;
      }

      // ─── Feedback ────────────────────────────────────────────────
      case 'Spinner': {
        el.textContent = '⋯';
        return el;
      }
      case 'ProgressBar': {
        const v = Math.min(100, Math.max(0, Number(this.read<number>(node, 'value', 0) ?? 0)));
        const track = document.createElement('div');
        track.style.cssText = 'background:rgba(0,0,0,0.08);height:6px;border-radius:3px;overflow:hidden;';
        const fill = document.createElement('div');
        fill.style.cssText =
          `width:${v}%;height:100%;background:var(--dddk-accent, #6366f1);transition:width 200ms;`;
        track.appendChild(fill);
        el.appendChild(track);
        return el;
      }
      case 'EmptyState': {
        el.style.cssText = 'padding:24px;text-align:center;color:var(--dddk-text-muted, #6b6b6b);';
        const icon = document.createElement('div');
        icon.style.cssText = 'font-size:28px;margin-bottom:8px;';
        icon.textContent = String(node.icon ?? '∅');
        el.appendChild(icon);
        const title = document.createElement('div');
        title.textContent = String(node.title ?? '');
        el.appendChild(title);
        if (node.description) {
          const small = document.createElement('small');
          small.textContent = String(node.description);
          el.appendChild(small);
        }
        return el;
      }
      case 'ErrorState': {
        el.style.cssText =
          'padding:16px;background:rgba(239,68,68,0.08);border:1px solid #ef4444;' +
          'border-radius:6px;color:#991b1b;';
        const strong = document.createElement('strong');
        strong.textContent = String(node.title ?? 'Error');
        el.appendChild(strong);
        if (node.message) {
          const msg = document.createElement('div');
          msg.style.cssText = 'margin-top:4px;font-size:13px;';
          msg.textContent = String(node.message);
          el.appendChild(msg);
        }
        return el;
      }

      // ─── Slot (host-provided element) ────────────────────────────
      case 'Slot': {
        const slotName = node.slotName;
        if (typeof slotName === 'string') {
          const map =
            (typeof window !== 'undefined' &&
              (window as unknown as { __dddkSlotElements?: Record<string, HTMLElement> }).__dddkSlotElements) ||
            {};
          const supplied = map[slotName];
          if (supplied) {
            el.appendChild(supplied);
            return el;
          }
        }
        el.style.cssText = 'padding:8px;background:rgba(0,0,0,0.04);border-radius:4px;font-size:11px;color:#6b6b6b;';
        el.textContent = `Slot: ${slotName ?? '(inline)'}`;
        return el;
      }

      default: {
        const def = this.opts.catalog?.get(node.kind);
        el.style.cssText = 'padding:6px;background:rgba(0,0,0,0.03);border-radius:4px;font-size:12px;color:#6b6b6b;';
        el.textContent = def ? `<${node.kind}>` : `Unknown piece: ${node.kind}`;
        return el;
      }
    }
  }

  private appendAll(parent: HTMLElement, children: HTMLElement[]): void {
    for (const c of children) parent.appendChild(c);
  }

  private fieldWrap(node: PieceNode): HTMLElement {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;font-size:13px;';
    if (node.label != null) {
      const span = document.createElement('span');
      span.textContent = String(node.label);
      wrap.appendChild(span);
    }
    return wrap;
  }
}

// ─── helpers ────────────────────────────────────────────────────────

function applyInputStyle(el: HTMLElement): void {
  el.style.cssText =
    'width:100%;padding:6px 8px;border:1px solid var(--dddk-border, rgba(0,0,0,0.15));' +
    'border-radius:6px;font:inherit;background:var(--dddk-bg, #fff);color:inherit;box-sizing:border-box;';
}

function px(value: unknown, fallback: number): string {
  if (typeof value === 'number') return `${value}px`;
  if (typeof value === 'string') return value;
  return `${fallback}px`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

function readPointer(data: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  if (!path.startsWith('/')) return data[path];
  const parts = path.slice(1).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur: unknown = data;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as object)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function applyPointer(
  data: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  if (!path) return data;
  if (!path.startsWith('/')) return { ...data, [path]: value };
  const parts = path.slice(1).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  const last = parts.pop();
  const next: Record<string, unknown> = { ...data };
  if (!last) return next;
  let cur: Record<string, unknown> = next;
  for (const p of parts) {
    const existing = cur[p];
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      const cloned = { ...(existing as Record<string, unknown>) };
      cur[p] = cloned;
      cur = cloned;
    } else {
      const fresh: Record<string, unknown> = {};
      cur[p] = fresh;
      cur = fresh;
    }
  }
  cur[last] = value;
  return next;
}
