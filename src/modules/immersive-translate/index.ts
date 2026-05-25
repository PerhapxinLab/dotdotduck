/**
 * ImmersiveTranslate — page-wide bilingual rendering.
 *
 * UX (common pattern for inline page-translation tooling):
 *   1. Host calls `translate.enable('zh-TW')` (usually from a palette command).
 *   2. Module walks the visible DOM, collects translatable text BLOCKS (one
 *      per block-level element — paragraph, heading, list item, etc.).
 *   3. Blocks are BATCHED into LLM calls (default 30 blocks per call, ~5k
 *      chars per call cap) — so a 200-paragraph article costs ~7 API calls,
 *      not 200.
 *   4. For each translated block, we append a styled inline element AFTER
 *      the original (NOT replacing). Default wrapper is `<font class=
 *      "dddk-imm-translate">` — a deliberate use of the legacy <font> tag
 *      because it survives most rich-text editors and PDF viewers without
 *      being styled away by host CSS, which is the conventional choice for
 *      this kind of inline-translation overlay.
 *   5. Cache by content hash so re-enabling the same language is instant.
 *
 * Limitations:
 *   - PDFs: HTML viewers (pdf.js / Chrome built-in) render selectable text
 *     in an overlay — this module will translate that overlay if it's part
 *     of the DOM; native PDF viewers (the browser plugin) are out of reach.
 *   - docx: native .docx files served as downloads are not in the DOM.
 *     If your host renders docx as HTML (e.g. via mammoth.js), it works.
 *     If you embed Office Online viewer, the iframe is cross-origin → out
 *     of reach.
 *   - Both PDF and docx have to be HTML in the page for this module to
 *     touch them. The output convention (`<font class="dddk-imm-translate">`)
 *     was chosen so downstream PDF / docx renderers that DO accept inline
 *     HTML preserve the bilingual layout.
 */

import { resolveLLM, type LLMSource } from '../../agent/llm/router';
import type { DotDotDuck } from '../../orchestrator';
import { stripCodeFence } from '../../utils/llm-parse';
import { injectScopedStyle } from '../../utils/dom';

const TRANSLATED_ATTR = 'data-dddk-imm-translated';
const WRAPPER_TAG = 'font';                         // see file header
const WRAPPER_CLASS = 'dddk-imm-translate';
const STYLE_ID = 'dddk-imm-translate-style';

export interface ImmersiveTranslateConfig {
  llm: LLMSource;
  /** Max DOM blocks per LLM call. Default 30. */
  batchSize?: number;
  /** Max combined chars per LLM call. Default 4500. Batches break here too. */
  batchCharCap?: number;
  /** CSS selectors whose contents should NOT be translated. */
  ignoreSelector?: string;
  /** Root element to walk. Default `document.body`. */
  root?: HTMLElement;
  /** Optional persisted cache. Falls back to in-memory Map. */
  cache?: { get(key: string): string | null; set(key: string, val: string): void };
}

const DEFAULT_IGNORE = [
  '[data-dddk-ui]',
  '[data-dddk-no-translate]',
  'script', 'style', 'noscript', 'svg', 'code', 'pre', 'kbd',
  '.dddk-imm-translate',
];

const BLOCK_TAGS = new Set([
  'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
  'figcaption', 'td', 'th', 'dt', 'dd', 'summary', 'caption',
]);

const SYSTEM_PROMPT = `You are a translation engine. The user gives you a JSON array of strings (one source paragraph per element). Return a JSON array of EXACTLY THE SAME LENGTH where index N is the translation of index N into the requested target language.

ABSOLUTE RULES:
- Output ONLY the JSON array. No markdown code fences. No commentary. No keys or wrapping object.
- Preserve inline tags like <a>, <strong>, <em>, <code>, <span> verbatim and around the same content.
- Do NOT add bullets / numbering that weren't in the source.
- Keep numbers, dates, URLs, and proper nouns (especially product/brand names) as-is unless they have an established translation.
- If a paragraph contains only a code snippet, a URL, or pure symbols, return it unchanged.`;

export class ImmersiveTranslate {
  private cfg: Required<Pick<ImmersiveTranslateConfig, 'batchSize' | 'batchCharCap' | 'root'>>
    & Pick<ImmersiveTranslateConfig, 'llm' | 'ignoreSelector' | 'cache'>;
  private effectiveIgnore: string;
  private memCache = new Map<string, string>();
  private currentLang: string | null = null;
  private dddk: DotDotDuck | null = null;

  constructor(config: ImmersiveTranslateConfig) {
    this.cfg = {
      llm: config.llm,
      // Smaller batches than the original 30 / 4500. With Promise.all
      // fan-out, latency is bounded by the slowest single call —
      // generating 4500 chars of translation takes ~5s on a mid model,
      // generating 1200 chars takes ~1.5s. The total work is the same,
      // so more, smaller batches → much faster wall-clock on parallel
      // hardware. Hosts that hit rate limits can override upward.
      batchSize: config.batchSize ?? 8,
      batchCharCap: config.batchCharCap ?? 1200,
      root: config.root ?? (typeof document !== 'undefined' ? document.body : (null as unknown as HTMLElement)),
      ignoreSelector: config.ignoreSelector,
      cache: config.cache,
    };
    const parts = [...DEFAULT_IGNORE];
    if (config.ignoreSelector) parts.push(config.ignoreSelector);
    this.effectiveIgnore = parts.join(', ');
  }

  attachTo(dddk: DotDotDuck): void {
    this.dddk = dddk;
    ensureStyles();
  }

  isEnabled(): boolean { return this.currentLang !== null; }
  language(): string | null { return this.currentLang; }

  /** Run a full translation pass. If the language differs from the previous
   *  enable, the page is cleared and re-translated. */
  async enable(targetLang: string, label?: string): Promise<void> {
    if (this.currentLang === targetLang) return;
    if (this.currentLang) this.disable();
    this.currentLang = targetLang;
    ensureStyles();

    const blocks = this.collectBlocks();
    if (blocks.length === 0) return;

    // Persistent processing indicator so the bottom of the screen
    // shows "translating…" the entire time the LLM calls are in flight,
    // not just for the brief moment between `subtitle.show` re-renders.
    // Without this the user sees a flash of progress text then nothing
    // while the slowest batch finishes, and assumes the feature hung.
    const indicatorLabel = `Translating → ${label ?? targetLang}`;
    this.dddk?.subtitle.showIndicator('processing', indicatorLabel);
    this.dddk?.subtitle.show({
      text: `Translating → ${label ?? targetLang} (${blocks.length} blocks)`,
      type: 'info',
    });

    // Batch the blocks honouring both block-count and char-cap, then
    // fire every batch IN PARALLEL. Sequential awaits used to walk a
    // 27-block page through one batch at a time; with parallel fan-out
    // a typical doc page completes in roughly the slowest single batch's
    // latency. Each batch independently checks the cache + mounts results
    // so a slow / failing batch doesn't block the others.
    const batches = this.buildBatches(blocks);
    let done = 0;
    const updateProgress = (): void => {
      this.dddk?.subtitle.show({
        text: `Translating ${done}/${blocks.length} → ${label ?? targetLang}`,
        type: 'info',
      });
      this.dddk?.subtitle.showIndicator('processing', `${indicatorLabel} (${done}/${blocks.length})`);
    };

    await Promise.all(batches.map(async (batch) => {
      const inputs = batch.map((b) => b.html);
      const cached: (string | null)[] = inputs.map((html) => this.cacheGet(html, targetLang));
      const need = inputs.map((html, i) => (cached[i] == null ? html : null));
      const needIdxs = need.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0);
      let translations: string[] = [];
      if (needIdxs.length > 0) {
        const toSend = needIdxs.map((i) => inputs[i]!);
        try {
          translations = await this.translateBatch(toSend, targetLang);
        } catch (err) {
          console.warn('[immersive-translate] batch failed, skipping:', err);
          translations = toSend.map(() => '');
        }
      }
      const finalOutputs: string[] = cached.map((c) => c ?? '');
      let tIdx = 0;
      for (const i of needIdxs) {
        finalOutputs[i] = translations[tIdx] ?? '';
        if (finalOutputs[i]) this.cacheSet(inputs[i]!, targetLang, finalOutputs[i]!);
        tIdx++;
      }
      for (let i = 0; i < batch.length; i++) {
        const out = finalOutputs[i];
        if (out && out !== inputs[i]) this.appendTranslation(batch[i]!.el, out);
      }
      done += batch.length;
      updateProgress();
    }));

    this.dddk?.subtitle.hideIndicator();
    this.dddk?.subtitle.show({
      text: `Translation complete (${blocks.length} blocks)`,
      type: 'info',
      autoHide: 2000,
    });
  }

  /** Strip all injected translation nodes; revert page to original state. */
  disable(): void {
    if (!this.currentLang) return;
    this.cfg.root.querySelectorAll(`.${WRAPPER_CLASS}`).forEach((el) => el.remove());
    this.cfg.root.querySelectorAll(`[${TRANSLATED_ATTR}]`).forEach((el) => el.removeAttribute(TRANSLATED_ATTR));
    this.currentLang = null;
  }

  toggle(targetLang: string, label?: string): Promise<void> | void {
    if (this.isEnabled()) { this.disable(); return; }
    return this.enable(targetLang, label);
  }

  // ─── internals ───────────────────────────────────────────────

  private collectBlocks(): Array<{ el: HTMLElement; html: string }> {
    const out: Array<{ el: HTMLElement; html: string }> = [];
    const walker = document.createTreeWalker(this.cfg.root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => {
        if (!(node instanceof HTMLElement)) return NodeFilter.FILTER_REJECT;
        if (this.effectiveIgnore && node.closest(this.effectiveIgnore)) return NodeFilter.FILTER_REJECT;
        if (!BLOCK_TAGS.has(node.tagName.toLowerCase())) return NodeFilter.FILTER_SKIP;
        if (node.hasAttribute(TRANSLATED_ATTR)) return NodeFilter.FILTER_REJECT;
        const text = (node.textContent ?? '').trim();
        if (text.length < 2) return NodeFilter.FILTER_REJECT;
        // Skip if it contains a block child (we'd double-translate).
        for (const child of Array.from(node.children)) {
          if (BLOCK_TAGS.has(child.tagName.toLowerCase())) return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const el = n as HTMLElement;
      el.setAttribute(TRANSLATED_ATTR, 'pending');
      // Use innerHTML so inline tags (<a>, <strong>, …) survive — the prompt
      // tells the LLM to preserve them.
      out.push({ el, html: (el.innerHTML ?? '').trim() });
    }
    return out;
  }

  private buildBatches(blocks: Array<{ el: HTMLElement; html: string }>):
    Array<Array<{ el: HTMLElement; html: string }>> {
    const out: Array<Array<{ el: HTMLElement; html: string }>> = [];
    let cur: Array<{ el: HTMLElement; html: string }> = [];
    let curChars = 0;
    for (const b of blocks) {
      if (cur.length >= this.cfg.batchSize || curChars + b.html.length > this.cfg.batchCharCap) {
        if (cur.length > 0) out.push(cur);
        cur = [];
        curChars = 0;
      }
      cur.push(b);
      curChars += b.html.length;
    }
    if (cur.length > 0) out.push(cur);
    return out;
  }

  private async translateBatch(blocks: string[], targetLang: string): Promise<string[]> {
    const llm = resolveLLM(this.cfg.llm, 'inline');
    const user = `Target language: ${targetLang}\n\nSource (JSON array of ${blocks.length} strings):\n${JSON.stringify(blocks)}`;
    const res = await llm.complete({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
      // Translation doesn't need reasoning — disable thinking for speed +
      // to keep the model from leaking analysis into the JSON output.
      thinking: 'off',
      jsonMode: true,
      temperature: 0.2,
      maxTokens: Math.min(4000, blocks.reduce((s, b) => s + b.length, 0) * 3 + 500),
    });
    const raw = res.content.trim();
    // Strip leading/trailing markdown fences if the model leaked them.
    const cleaned = stripCodeFence(raw);
    try {
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      if (parsed.length !== blocks.length) throw new Error(`length mismatch ${parsed.length} vs ${blocks.length}`);
      return parsed.map((s) => String(s));
    } catch (err) {
      console.warn('[immersive-translate] JSON parse failed:', err, 'raw:', raw);
      return blocks.map(() => '');
    }
  }

  private appendTranslation(el: HTMLElement, html: string): void {
    el.setAttribute(TRANSLATED_ATTR, 'done');
    // Insert as a <font class="dddk-imm-translate"> after the original
    // content inside the same block — survives most rich-text + Office /
    // PDF HTML pipelines.
    const wrap = document.createElement(WRAPPER_TAG);
    wrap.className = WRAPPER_CLASS;
    wrap.innerHTML = html;
    // Force a line break before so original + translation are visually separable.
    const br = document.createElement('br');
    br.className = WRAPPER_CLASS;
    el.appendChild(br);
    el.appendChild(wrap);
  }

  private cacheKey(source: string, lang: string): string {
    return `imm:${lang}:${fnv1a(source)}`;
  }
  private cacheGet(source: string, lang: string): string | null {
    const k = this.cacheKey(source, lang);
    return (this.cfg.cache?.get(k)) ?? this.memCache.get(k) ?? null;
  }
  private cacheSet(source: string, lang: string, value: string): void {
    const k = this.cacheKey(source, lang);
    this.memCache.set(k, value);
    this.cfg.cache?.set(k, value);
  }
}

function ensureStyles(): void {
  injectScopedStyle(STYLE_ID, `
    .${WRAPPER_CLASS} {
      color: var(--dddk-text-muted, #6b6b6b);
      font-family: inherit;
      display: inline;
      opacity: 0.95;
    }
    br.${WRAPPER_CLASS} { display: block; margin-top: 4px; }
  `);
}

/** Tiny non-crypto hash for the translation cache key. 32-bit FNV-1a. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
}
