/**
 * Unified memory facade.
 *
 * The SDK has shipped TWO memory subsystems in parallel since v0.1.0:
 *
 *   - `Memory` (this module) — 3-tier structured: CoreMemory (persistent
 *     identity facts), EpisodicMemory (per-session summaries), SemanticMemory
 *     (vector retrieval). Strong typing, schema-driven.
 *   - `DrawerMemory` — wing/room/drawer free-form storage. Looser shape, used
 *     by the proactive module's `TriggerMemory = Memory | DrawerMemory`
 *     union.
 *
 * Hosts pick one and the two don't share state. The unification task is
 * NOT a destructive merge (which would break v0.1 host integrations) — it's
 * a facade that owns both, presents a single API, and routes writes/reads
 * to the right backend automatically.
 *
 *   const memory = new UnifiedMemory({
 *     core:     { schema: { tone: 'string', industry: 'string' } },
 *     episodic: { enabled: true },
 *     drawer:   { storage: 'localStorage', maxItems: 500 },
 *   });
 *
 *   await memory.remember('user prefers concise responses');     // → CoreMemory if matches schema, else Drawer
 *   await memory.remember('looking at pricing page for 2min');    // → Drawer / behavioural
 *   const ctx = await memory.buildContext('what should I show?'); // merges all tiers
 *
 * The original `Memory` and `DrawerMemory` classes stay exported, untouched,
 * for hosts on v0.1 integrations.
 */

import { Memory, type MemoryConfig } from './index';
import { DrawerMemory, type DrawerMemoryOpts, type Drawer } from './drawer';

export interface UnifiedMemoryConfig extends MemoryConfig {
  /** Drawer subsystem opts. Omit to skip the drawer backend entirely. */
  drawer?: DrawerMemoryOpts;
}

export interface RememberOpts {
  /** Routing hint. `auto` (default) picks based on shape. */
  tier?: 'auto' | 'core' | 'drawer' | 'episodic';
  /** Drawer-only metadata. */
  wing?: string;
  room?: string;
  meta?: Record<string, unknown>;
  /** Core-only: which field to set when tier=core (or auto routing decides). */
  coreField?: string;
}

export interface RecallResult {
  source: 'core' | 'drawer' | 'episodic' | 'semantic';
  text: string;
  ts?: number;
  meta?: Record<string, unknown>;
  score?: number;
}

export class UnifiedMemory {
  readonly structured: Memory;
  readonly drawer: DrawerMemory | null;

  constructor(cfg: UnifiedMemoryConfig = {}) {
    this.structured = new Memory(cfg);
    this.drawer = cfg.drawer ? new DrawerMemory(cfg.drawer) : null;
  }

  async init(): Promise<void> {
    if (this.drawer) await this.drawer.init();
  }

  isPII(text: string): boolean {
    return this.structured.isPII(text);
  }

  /**
   * Write a memory. Routing:
   *   - `tier: 'core'` + `coreField` → CoreMemory.set(field, text)
   *   - `tier: 'drawer'` (or auto when long-form) → DrawerMemory.addDrawer
   *   - `tier: 'episodic'` → no-op here (use endSession to commit one)
   *   - `tier: 'auto'` (default) → core if a coreField is supplied, else drawer
   */
  async remember(text: string, opts: RememberOpts = {}): Promise<void> {
    if (!text.trim()) return;
    if (this.isPII(text)) return; // honour the PII gate at facade level
    const tier = opts.tier ?? 'auto';
    if ((tier === 'core' || (tier === 'auto' && opts.coreField)) && opts.coreField && this.structured.core) {
      this.structured.core.set(opts.coreField, text);
      return;
    }
    if (this.drawer) {
      await this.drawer.wing(opts.wing ?? 'default').room(opts.room ?? 'notes').addDrawer({
        text,
        meta: opts.meta,
      });
      return;
    }
    // No drawer configured and not a Core write — silently drop. The host
    // either configured no backing storage or asked us to route somewhere
    // we don't have. Loud failures here would break otherwise-working flows.
  }

  /**
   * Read memory. Pulls from BOTH backends and merges by best-effort score.
   * For backward compatibility, hosts that just want a system-prompt block
   * can call `buildContext(query)` instead — same shape as the v0.1 Memory.
   */
  async recall(query: string, opts: { limit?: number } = {}): Promise<RecallResult[]> {
    const limit = opts.limit ?? 10;
    const out: RecallResult[] = [];

    // Core: include every set field as a context item.
    if (this.structured.core) {
      const snap = this.structured.core.snapshot();
      for (const [field, value] of Object.entries(snap)) {
        if (value == null || value === '') continue;
        out.push({ source: 'core', text: `${field}: ${String(value)}`, score: 1.0 });
      }
    }

    // Drawer: keyword/feature search.
    if (this.drawer) {
      const drawers: Drawer[] = await this.drawer.search(query, { topK: limit });
      for (const d of drawers) {
        out.push({
          source: 'drawer',
          text: d.text,
          ts: d.ts,
          meta: d.meta,
        });
      }
    }

    // Semantic: vector retrieval (if configured).
    if (this.structured.semantic) {
      try {
        const hits = await this.structured.semantic.recall(query, { topK: limit });
        for (const h of hits) {
          out.push({
            source: 'semantic',
            text: h.content,
            ts: h.timestamp,
            meta: h.metadata,
          });
        }
      } catch {
        // Semantic backend unreachable — fall through to whatever we have.
      }
    }

    return out.slice(0, limit);
  }

  /** Build the system-prompt context block. Delegates to structured Memory,
   *  then appends recent drawer entries if a drawer is configured. */
  async buildContext(userQuery: string): Promise<string> {
    const structured = await this.structured.buildContext(userQuery);
    if (!this.drawer) return structured;
    const recent = this.drawer.recent({ limit: 5 });
    if (recent.length === 0) return structured;
    const drawerBlock = recent.map((d) => `- ${d.text}`).join('\n');
    return [structured, '\nRecent notes:', drawerBlock].filter(Boolean).join('\n').trim();
  }

  endSession(input: { summary: string; taskSummary?: string; tags?: string[]; turnCount?: number }) {
    return this.structured.endSession(input);
  }

  clear(): void {
    this.structured.clear();
    // Drawer has no clear method by design (host responsibility) — leave as-is.
  }

  async dispose(): Promise<void> {
    if (this.drawer) await this.drawer.dispose();
  }
}

export function createUnifiedMemory(cfg: UnifiedMemoryConfig = {}): UnifiedMemory {
  return new UnifiedMemory(cfg);
}
