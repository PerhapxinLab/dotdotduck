/**
 * Tool registry — host-friendly API for exposing arbitrary capabilities
 * (QA, search, recommend, custom domain ops) to the webagent.
 *
 * What this gives you:
 *   - `dddk.tools.register({...})` — register any ActionDefinition; the
 *     webagent picks it up on next build, and if the agent is already
 *     running, the new tool is added live via `agent.registerAction(...)`.
 *   - `dddk.tools.registerQA({items, description?})` — convenience
 *     wrapper that takes a list of FAQ items, spins up a `dddk/toolbox/qa`
 *     instance internally, and exposes it as a `<id>_lookup` tool the
 *     LLM can call (e.g. agent decides on its own "I should look this
 *     up in the company FAQ first").
 *   - `dddk.tools.unregister(id)` — remove a tool.
 *   - `dddk.tools.list()` — read the current set (for debugging).
 *
 * Design notes:
 *   - QA / search / recommend are NOT palette panel demos. They are
 *     tools the agent uses automatically when it reasons. Putting them
 *     in the palette as standalone surfaces forces the user to pick
 *     which tool to use; registering them as agent tools lets the LLM
 *     decide.
 *   - The host can also provide per-turn context via the WebAgent
 *     config's `brand` + `appendSystemPrompt` fields — that's
 *     orthogonal to tools.
 */

import type {
  ActionDefinition,
  ActionResult,
} from './agent';
import type { WebAgent } from './agent';
import { createSearch } from './toolbox/search/index.js';
import { builtin as searchBuiltin } from './toolbox/search/builtin.js';
import { createRecommend, builtin as recBuiltin } from './toolbox/recommend/index.js';

export interface ToolSpec extends ActionDefinition {
  /** Optional human label shown in `tools.list()` output. */
  label?: string;
}

export interface QAToolItem {
  id: string;
  question: string;
  answer: string;
  category?: string;
  lang?: string;
}

export interface RegisterQAOpts {
  /** Tool id. Default `'qa_lookup'`. Becomes the agent-visible action
   *  name (must be alphanumeric + underscore, no slashes/dots). */
  id?: string;
  /** FAQ entries. Host can pass mixed-language items; the QA module
   *  auto-detects per-item. */
  items: QAToolItem[];
  /** Override description the LLM sees. Default tells the agent this
   *  is the canonical "look something up in the company knowledge
   *  base" tool. */
  description?: string;
  /** topK returned to the LLM. Default 3. */
  topK?: number;
}

/** Search-tool registration — wires `dddk/toolbox/search` as a tool. */
export interface RegisterSearchOpts<TRow> {
  /** Tool id. Default `'search_catalog'`. */
  id?: string;
  /** Default description: "search the product catalog by free text". */
  description?: string;
  /** Items the search index holds (products, articles, …). */
  items: TRow[];
  /** Map each row to `{ id, fields, meta? }`. The `fields` keys become
   *  searchable text per-row; `fields` values can be strings or string
   *  arrays. */
  toDoc: (row: TRow) => { id: string; fields: Record<string, string | string[]>; meta?: Record<string, unknown> };
  /** Per-field weight + tf-saturation. Default: weight 1.0, sat 7. */
  fieldWeights?: Record<string, number>;
  /** topK returned. Default 5. */
  topK?: number;
}

/** Recommender-tool registration — wires `dddk/toolbox/recommend`. */
export interface RegisterRecommendOpts<TRow> {
  /** Tool id prefix. Default `'recommend'` → produces actions
   *  `recommend_for_customer`, `recommend_similar`. */
  id?: string;
  /** Description for the `for_customer` variant. */
  forCustomerDescription?: string;
  /** Description for the `similar` variant. */
  similarDescription?: string;
  /** Catalog items. */
  items: TRow[];
  toDoc: (row: TRow) => { id: string; fields: Record<string, string | string[]>; meta?: Record<string, unknown> };
  /** Customer ID for preference scoping. Default `'anon'`. */
  customerId?: string;
  /** topK returned. Default 5. */
  topK?: number;
}

/**
 * Internal — the orchestrator instantiates this and exposes a subset
 * as `dddk.tools`. Holds the buffer of registered tools so the
 * WebAgent picks them up at build-time AND can be added at runtime.
 */
export class ToolsRegistry {
  private tools = new Map<string, ToolSpec>();
  /** Set by the orchestrator after WebAgent is built so runtime
   *  registrations land in the live agent immediately. */
  private liveAgent: WebAgent | null = null;

  attachAgent(agent: WebAgent): void {
    this.liveAgent = agent;
    // Replay all already-registered tools into the live agent so order
    // of (host registers tool) → (host opens dddk for first time) doesn't
    // matter.
    for (const spec of this.tools.values()) {
      try { agent.registerAction(spec); } catch { /* swallow */ }
    }
  }

  detachAgent(): void {
    this.liveAgent = null;
  }

  /** All currently-registered tools — passed to WebAgent at build time. */
  snapshot(): ActionDefinition[] {
    return [...this.tools.values()];
  }

  register(spec: ToolSpec): void {
    if (!/^[a-z][a-z0-9_]*$/i.test(spec.name)) {
      throw new Error(`tool name "${spec.name}" must be alphanumeric + underscore`);
    }
    this.tools.set(spec.name, spec);
    if (this.liveAgent) {
      try { this.liveAgent.registerAction(spec); } catch { /* swallow */ }
    }
  }

  unregister(id: string): boolean {
    const removed = this.tools.delete(id);
    // v0.2.0: WebAgent now supports runtime un-register
    // via `unregisterAction`. Mirror the delete into the live agent
    // so the next step actually loses the tool.
    if (removed && this.liveAgent) {
      try { this.liveAgent.unregisterAction(id); } catch { /* swallow */ }
    }
    return removed;
  }

  list(): ToolSpec[] {
    return [...this.tools.values()];
  }

  /**
   *
   * Wait for any in-flight agent turn to complete, so the very next
   * turn observes whatever tools have just been registered. Without
   * this, mid-flight `register(...)` calls only apply to subsequent
   * turns — the in-flight turn finishes with the snapshot it started
   * with, which is correct but surprises hosts.
   *
   * If no agent is attached or no run is in flight, resolves
   * immediately. Otherwise resolves when the current run reaches idle.
   *
   * Implementation note: WebAgent doesn't expose a public event
   * emitter, so this poll-until-idle approach is the lowest-coupling
   * way to wire the same semantics. Poll interval is 100ms — agent
   * turn boundaries are typically 1-3s on `gpt-5.4-nano`, so the
   * loop tops out at ~30 polls per turn.
   */
  async flush(): Promise<void> {
    const agent = this.liveAgent;
    if (!agent) return;
    // Peek at WebAgent's status via the public `isRunning` semantics.
    // We can't import WebAgent's status directly without a type
    // dependency, so probe via the session: a non-null session whose
    // status is 'thinking' / 'executing' / 'waiting' means there's
    // a turn in progress.
    type StatusProbe = { isRunning?: () => boolean };
    const probe = agent as unknown as StatusProbe;
    if (typeof probe.isRunning !== 'function') return;
    if (!probe.isRunning()) return;
    return new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (typeof probe.isRunning !== 'function' || !probe.isRunning()) {
          clearInterval(t);
          resolve();
        }
      }, 100);
    });
  }

  // ─── QA convenience ────────────────────────────────────────────

  /**
   * Wire a FAQ dataset as a webagent tool. The LLM sees one action
   * (`qa_lookup` by default) that takes a `question: string` and gets
   * back the top matched entries. Lets the agent decide on its own
   * "the user is asking about refunds, let me check the FAQ" without
   * the host having to wire each FAQ entry as a separate tool.
   */
  registerQA(opts: RegisterQAOpts): void {
    const id = opts.id ?? 'qa_lookup';
    const topK = opts.topK ?? 3;
    const description = opts.description ??
      'Look up an answer in the company knowledge base (FAQ — refund, shipping, payment, account, privacy, etc.). Call this whenever the user asks something that likely has a canonical answer. Returns the top 3 matching FAQ entries with their answers and confidence.';

    // Index FAQ entries with a BM25 search over the question field.
    // Each Doc is `{ id, fields: { question, answer }, meta: { category } }`;
    // recall the entry by ranking on the `question` field only — the
    // answer text would otherwise pollute the score for off-topic queries
    // that share vocabulary with the body.
    type QASearchRow = { id: string; question: string; answer: string; category?: string };
    let searchInstance: ReturnType<typeof createSearch<QASearchRow>> | null = null;
    let initPromise: Promise<void> | null = null;
    const getSearch = () => {
      if (searchInstance) return searchInstance;
      searchInstance = createSearch<QASearchRow>({
        adapter: {
          fromRow: (row) => ({
            id: row.id,
            fields: { question: row.question, answer: row.answer },
            meta: { category: row.category, answer: row.answer },
          }),
        },
        scorers: [
          {
            id: 'bm25_question',
            compute: (doc, ctx) => {
              // Hand-rolled BM25 against the `question` field only.
              const store = ctx._store;
              if (!store) return 0;
              const uniqQ = new Set(ctx.queryFeatures);
              let total = 0;
              for (const f of uniqQ) {
                const postings = store.postingsFor(f);
                if (!postings) continue;
                const hit = postings.find((p) => p.docId === doc.id);
                if (!hit) continue;
                const tf = hit.fieldFreqs['question'] ?? 0;
                if (tf === 0) continue;
                const N = store.totalDocs;
                const df = postings.length;
                const avgLen = store.avgFieldLen('question');
                // Reuse the same BM25 the search module ships with.
                const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
                const k1 = 1.5;
                const b = 0.75;
                const denom = tf + k1 * (1 - b + (b * avgLen) / Math.max(1, avgLen));
                total += (idf * (tf * (k1 + 1))) / denom;
              }
              return total;
            },
          },
        ],
        combiner: 'weighted_sum',
        weights: { bm25_question: 1.0 },
        topK,
      });
      const inst = searchInstance;
      initPromise = (async () => {
        await inst.init();
        await inst.addDocs(opts.items.map((it) => ({
          id: it.id,
          question: it.question,
          answer: it.answer,
          category: it.category,
        })));
      })();
      return inst;
    };

    this.register({
      name: id,
      description,
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The user question to look up, in the user\'s own words.',
          },
        },
        required: ['question'],
      },
      handler: async (params: unknown): Promise<ActionResult<unknown>> => {
        const question = (params as { question?: string })?.question ?? '';
        try {
          const search = getSearch();
          if (initPromise) { await initPromise; initPromise = null; }
          const results = await search.query(question, { topK });
          // Map results back to {q, a, score, category} shape the LLM sees.
          const max = results[0]?.score ?? 0;
          const matches = results.map((r) => {
            const ratio = max > 0 ? r.score / max : 0;
            const confidence: 'high' | 'medium' | 'low' =
              ratio > 0.8 ? 'high' : ratio > 0.5 ? 'medium' : 'low';
            return {
              q: r.doc.fields.question,
              a: typeof r.doc.meta?.answer === 'string' ? r.doc.meta.answer : '',
              confidence,
              score: r.score,
              category: typeof r.doc.meta?.category === 'string' ? r.doc.meta.category : undefined,
            };
          });
          return { ok: true, data: { matches } };
        } catch (err) {
          return { ok: false, reason: 'unknown', message: (err as Error).message };
        }
      },
    });
  }

  // ─── Search convenience ────────────────────────────────────────

  /**
   * Wire a catalog as a search tool. The LLM sees `search_catalog(query)`
   * and can call it to find products / articles / records by free text.
   * Backed by `dddk/toolbox/search` with per-field BM25.
   */
  registerSearch<TRow>(opts: RegisterSearchOpts<TRow>): void {
    const id = opts.id ?? 'search_catalog';
    const topK = opts.topK ?? 5;
    const description = opts.description ??
      'Full-text search the product catalog. Call this when the user wants to find a specific item by name, description, or keyword. Returns the top matching catalog rows with relevance scores.';
    const fieldWeights = opts.fieldWeights ?? { title: 3.0, body: 1.0 };

    // Async setup runs once on first call.
    let searchInstance: ReturnType<typeof createSearch<TRow>> | null = null;
    let initPromise: Promise<void> | null = null;
    const getSearch = () => {
      if (searchInstance) return searchInstance;
      const fieldWeightsConfig: Record<string, { weight: number; saturation?: number }> = {};
      for (const [field, weight] of Object.entries(fieldWeights)) {
        fieldWeightsConfig[field] = { weight };
      }
      searchInstance = createSearch<TRow>({
        adapter: {
          fromRow: (row) => {
            const d = opts.toDoc(row);
            // Doc.fields is string-only; collapse arrays to space-joined.
            const flat: Record<string, string> = {};
            for (const [k, v] of Object.entries(d.fields)) {
              flat[k] = Array.isArray(v) ? v.join(' ') : v;
            }
            return { id: d.id, fields: flat, ...(d.meta ? { meta: d.meta } : {}) };
          },
        },
        scorers: [searchBuiltin.bm25Field({ weights: fieldWeightsConfig })],
        weights: { bm25_field: 1.0 },
        combiner: 'weighted_sum',
        topK,
      });
      const inst = searchInstance;
      initPromise = (async () => {
        await inst.init();
        await inst.addDocs(opts.items);
      })();
      return inst;
    };

    this.register({
      name: id,
      description,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text search query.' },
        },
        required: ['query'],
      },
      handler: async (params: unknown): Promise<ActionResult<unknown>> => {
        const query = (params as { query?: string })?.query ?? '';
        const s = getSearch();
        try {
          if (initPromise) { await initPromise; initPromise = null; }
          const results = await s.query(query, { topK });
          const hits = results.map((r) => ({
            id: r.doc.id,
            fields: r.doc.fields,
            meta: r.doc.meta,
            score: r.score,
          }));
          return { ok: true, data: { hits } };
        } catch (err) {
          return { ok: false, reason: 'unknown', message: (err as Error).message };
        }
      },
    });
  }

  // ─── Recommender convenience ───────────────────────────────────

  /**
   * Wire a recommender as TWO tools — `recommend_for_customer` (no
   * input, returns personalised top-K) and `recommend_similar` (given
   * a product id, returns similar items). The recommender uses the
   * same catalog as the search builder and learns from
   * `recordPreference(productId, response)` calls — the LLM can hand
   * the user's ♥/✕ choices back to the recommender by calling
   * `record_preference` (third tool registered here).
   */
  registerRecommend<TRow>(opts: RegisterRecommendOpts<TRow>): void {
    const idPrefix = opts.id ?? 'recommend';
    const topK = opts.topK ?? 5;

    // Recommend needs a Search-backed catalog. Build a dedicated Search
    // instance per recommender (NOT shared with the search tool, so the
    // host can use both independently with different field weights).
    let recInstance: ReturnType<typeof createRecommend> | null = null;
    let initPromise: Promise<void> | null = null;
    const getRec = () => {
      if (recInstance) return recInstance;
      const catalog = createSearch<TRow>({
        adapter: {
          fromRow: (row) => {
            const d = opts.toDoc(row);
            // Doc.fields is string-only; collapse arrays to space-joined.
            const flat: Record<string, string> = {};
            for (const [k, v] of Object.entries(d.fields)) {
              flat[k] = Array.isArray(v) ? v.join(' ') : v;
            }
            return { id: d.id, fields: flat, ...(d.meta ? { meta: d.meta } : {}) };
          },
        },
        scorers: [searchBuiltin.bm25Field({ weights: { title: { weight: 2 } } })],
      });
      recInstance = createRecommend({
        catalog,
        customerId: opts.customerId ?? 'anon',
        signals: [recBuiltin.preferenceMatch({ catalog })],
        weights: { preference_match: 1.0 },
        combiner: 'weighted_sum',
        topK,
      });
      const cat = catalog;
      const rec = recInstance;
      initPromise = (async () => {
        await cat.init();
        await cat.addDocs(opts.items);
        await rec.init();
      })();
      return rec;
    };

    this.register({
      name: `${idPrefix}_for_customer`,
      description: opts.forCustomerDescription ??
        'Get personalised recommendations for the current customer based on their accumulated likes / dislikes. Returns top items with scores.',
      parameters: { type: 'object', properties: {} },
      handler: async (): Promise<ActionResult<unknown>> => {
        try {
          const rec = getRec();
          if (initPromise) { await initPromise; initPromise = null; }
          const results = await rec.forCustomer({ topK });
          return { ok: true, data: { recommendations: results.map((r) => ({ id: r.doc.id, fields: r.doc.fields, score: r.score })) } };
        } catch (err) {
          return { ok: false, reason: 'unknown', message: (err as Error).message };
        }
      },
    });

    this.register({
      name: `${idPrefix}_similar`,
      description: opts.similarDescription ??
        'Find items similar to a given product. Useful when the user is browsing one item and wants suggestions like it.',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'string', description: 'Catalog id of the seed item.' } },
        required: ['productId'],
      },
      handler: async (params: unknown): Promise<ActionResult<unknown>> => {
        const productId = (params as { productId?: string })?.productId ?? '';
        try {
          const rec = getRec();
          if (initPromise) { await initPromise; initPromise = null; }
          const results = await rec.similarTo(productId, { topK });
          return { ok: true, data: { recommendations: results.map((r) => ({ id: r.doc.id, fields: r.doc.fields, score: r.score })) } };
        } catch (err) {
          return { ok: false, reason: 'unknown', message: (err as Error).message };
        }
      },
    });

    this.register({
      name: 'record_preference',
      description:
        'Record that the user likes (response="yes"), dislikes ("no"), or dismissed ("dismiss") a product. Affects future recommendations.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          response: { type: 'string', enum: ['yes', 'no', 'dismiss'] },
        },
        required: ['productId', 'response'],
      },
      handler: async (params: unknown): Promise<ActionResult<unknown>> => {
        const { productId, response } = (params as { productId?: string; response?: 'yes' | 'no' | 'dismiss' });
        if (!productId || !response) {
          return { ok: false, reason: 'unknown', message: 'productId and response required' };
        }
        try {
          const rec = getRec();
          if (initPromise) { await initPromise; initPromise = null; }
          await rec.recordPreference({ productId, response });
          return { ok: true, data: { recorded: true } };
        } catch (err) {
          return { ok: false, reason: 'unknown', message: (err as Error).message };
        }
      },
    });
  }
}
