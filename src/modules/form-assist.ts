/**
 * FormAssist — detect forms on the page, offer "AI fill" near them.
 *
 * Workflow:
 *  1. Module observes the DOM for <form> + ARIA forms (role=form)
 *  2. Adds a small floating "AI fill" button near each form (toggleable)
 *  3. User clicks → orchestrator starts agent task "fill the form at <selector>
 *     based on: <context>". Webagent's fill_input action handles the rest.
 *
 * Pure DOM module — no host data. Agent only sees what's in the page DOM
 * (which is what the user can see too) — so security boundary holds.
 */

import type { Subtitle } from '../ui/subtitle';
import { inferSelector } from '../utils/selector';
import { injectScopedStyle } from '../utils/dom';

export interface FormAssistConfig {
  /** Selector for forms to assist with. Default 'form'. */
  formSelector?: string;
  /** Skip forms matching this selector (e.g. login forms). */
  skipSelector?: string;
  /**
   * Called when user clicks the "AI fill" button. Host typically dispatches
   * this to `dddk.startAgent(...)` with a task that uses webagent's
   * `fill_input` action.
   */
  onAssist: (info: FormAssistInfo) => void;
  /** Show the button automatically when forms appear. Default true. */
  autoShow?: boolean;
}

export interface FormAssistInfo {
  form: HTMLFormElement;
  selector: string;
  fields: Array<{ name: string; label: string; type: string; required: boolean }>;
}

const UI_ATTR = 'data-dddk-ui';
const STYLE_ID = 'dddk-form-assist-style';

export class FormAssistModule {
  private cfg: Required<Omit<FormAssistConfig, 'onAssist' | 'skipSelector'>> & FormAssistConfig;
  private observed = new WeakSet<HTMLFormElement>();
  private buttons = new WeakMap<HTMLFormElement, HTMLButtonElement>();
  private observer: MutationObserver | null = null;

  constructor(config: FormAssistConfig) {
    this.cfg = {
      formSelector: 'form',
      autoShow: true,
      ...config,
    };
  }

  start(subtitle?: Subtitle): void {
    if (typeof document === 'undefined') return;
    ensureStyles();
    this.scan(subtitle);
    if (this.cfg.autoShow) {
      this.observer = new MutationObserver(() => this.scan(subtitle));
      this.observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    document.querySelectorAll(`[${UI_ATTR}="form-assist-btn"]`).forEach((el) => el.remove());
  }

  /** Manually attach a button to one form. */
  attachTo(form: HTMLFormElement, subtitle?: Subtitle): void {
    if (this.observed.has(form)) return;
    if (this.cfg.skipSelector && form.matches(this.cfg.skipSelector)) return;

    this.observed.add(form);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(UI_ATTR, 'form-assist-btn');
    btn.textContent = '✨ 幫填';
    btn.title = 'AI 幫你填寫這個表單';
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const info = inspectForm(form);
      subtitle?.show({ text: `分析 ${info.fields.length} 個欄位中…`, type: 'info', autoHide: 1500 });
      this.cfg.onAssist(info);
    };
    // place inside form, top-right corner. `position: static` is the default
    // computed value, and `||` won't overwrite it (it's a truthy string), so
    // we have to consult getComputedStyle to know whether we need to bump it
    // to `relative` for our absolute-positioned button to anchor correctly.
    if (typeof window !== 'undefined' && getComputedStyle(form).position === 'static') {
      form.style.position = 'relative';
    }
    form.appendChild(btn);
    this.buttons.set(form, btn);
  }

  /** Manually detach. */
  detachFrom(form: HTMLFormElement): void {
    const btn = this.buttons.get(form);
    btn?.remove();
    this.buttons.delete(form);
    this.observed.delete(form);
  }

  // ─── private ──────────────────────────────────────────────────────

  private scan(subtitle?: Subtitle): void {
    const forms = document.querySelectorAll<HTMLFormElement>(this.cfg.formSelector);
    forms.forEach((f) => this.attachTo(f, subtitle));
  }
}

// ─── helpers ──────────────────────────────────────────────────────

export function inspectForm(form: HTMLFormElement): FormAssistInfo {
  const fields: FormAssistInfo['fields'] = [];
  const inputs = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input, select, textarea'
  );
  inputs.forEach((el) => {
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
    const label = findLabel(el);
    fields.push({
      name: el.name || el.id || label || '(unnamed)',
      label,
      type: el.type || el.tagName.toLowerCase(),
      required: el.required,
    });
  });
  return {
    form,
    selector: inferSelector(form),
    fields,
  };
}

function findLabel(el: HTMLElement): string {
  const id = el.id;
  if (id) {
    const lbl = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`);
    if (lbl) return lbl.textContent?.trim() ?? '';
  }
  const wrap = el.closest('label');
  if (wrap) {
    // strip the input's own text content
    const clone = wrap.cloneNode(true) as HTMLLabelElement;
    clone.querySelectorAll('input, select, textarea').forEach((x) => x.remove());
    return clone.textContent?.trim() ?? '';
  }
  return el.getAttribute('aria-label') ?? (el as HTMLInputElement).placeholder ?? '';
}


function ensureStyles(): void {
  injectScopedStyle(STYLE_ID, `
    [${UI_ATTR}="form-assist-btn"] {
      position: absolute; top: 8px; right: 8px;
      background: var(--dddk-accent, #3b82f6);
      color: #fff; border: 0; border-radius: 6px;
      padding: 4px 10px; font-size: 12px; cursor: pointer;
      box-shadow: var(--dddk-shadow-sm, 0 1px 3px rgba(0,0,0,0.1));
      z-index: 10;
    }
    [${UI_ATTR}="form-assist-btn"]:hover {
      background: var(--dddk-accent-hover, #2563eb);
    }
  `);
}
