/** Memory v1 — three-tier hybrid memory for the webagent.
 *
 *   core      — structured user profile, always in context
 *   episodic  — ring buffer of past session summaries
 *   semantic  — host-provided long-term recall (vector / KG / etc)
 *
 * All tiers are opt-in. A bare `new DotDotDuck({})` has memory disabled.
 *
 * The legacy verbatim-drawer store (formerly `Memory`) is still available
 * as `DrawerMemory` from `@perhapxin/dddk/agent` — they serve different
 * use cases and can coexist.
 */

import { CoreMemory } from './core';
import { EpisodicMemory } from './episodic';
import { SemanticMemory } from './semantic';
import { looksLikePII } from './pii';
import type {
  CoreFieldType, CoreMemoryConfig, CoreMemorySchema,
  EpisodicEntry, EpisodicMemoryConfig,
  MemoryConfig, MemoryPrivacyConfig, MemoryProvider,
  SemanticMemoryConfig, SemanticMemoryEntry,
} from './types';

export class Memory {
  readonly core: CoreMemory | null;
  readonly episodic: EpisodicMemory | null;
  readonly semantic: SemanticMemory | null;
  private privacy: MemoryPrivacyConfig;

  constructor(cfg: MemoryConfig = {}) {
    this.privacy = cfg.privacy ?? {};
    this.core = cfg.core ? new CoreMemory(cfg.core) : null;
    this.episodic = cfg.episodic?.enabled !== false && cfg.episodic
      ? new EpisodicMemory(cfg.episodic, this.privacy.retentionDays ?? 90)
      : null;
    this.semantic = cfg.semantic ? new SemanticMemory(cfg.semantic) : null;
  }

  /** Check if `text` would be blocked by PII patterns. */
  isPII(text: string): boolean {
    return looksLikePII(text, this.privacy.excludePatterns ?? []);
  }

  /** Build the system-prompt context block for a new agent run. Runs
   *  semantic recall against `userQuery` when wired. Empty string when
   *  no tier has content. */
  async buildContext(userQuery: string): Promise<string> {
    const blocks: string[] = [];
    if (this.core) {
      const b = this.core.toPromptBlock();
      if (b) blocks.push(b);
    }
    if (this.episodic) {
      const b = this.episodic.toPromptBlock(userQuery);
      if (b) blocks.push(b);
    }
    if (this.semantic) {
      try {
        const recalled = await this.semantic.recall(userQuery, { topK: 5 });
        const b = this.semantic.toPromptBlock(recalled);
        if (b) blocks.push(b);
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.warn('[dddk memory] semantic recall failed:', err);
        }
      }
    }
    return blocks.join('\n\n');
  }

  /** Called when a session ends. Writes a short episodic summary if the
   *  tier is on. Caller supplies the summary text — hosts that want an
   *  LLM-generated summary should produce it before calling. */
  endSession(input: { summary: string; taskSummary?: string; tags?: string[]; turnCount?: number }): EpisodicEntry | null {
    if (!this.episodic) return null;
    if (this.isPII(input.summary)) {
      if (typeof console !== 'undefined') {
        console.warn('[dddk memory] episodic write blocked by PII filter');
      }
      return null;
    }
    return this.episodic.add(input);
  }

  /** Wipe all tiers. */
  clear(): void {
    this.core?.clear();
    this.episodic?.clear();
  }
}

export { CoreMemory, EpisodicMemory, SemanticMemory };
export { DrawerMemory, createDrawerMemory } from './drawer';
export type { Drawer, DrawerMemoryOpts, DrawerSearchOpts } from './drawer';
// Unified memory facade (wraps Memory + DrawerMemory).
export { UnifiedMemory, createUnifiedMemory } from './unified';
export type { UnifiedMemoryConfig, RememberOpts, RecallResult } from './unified';
export type {
  CoreMemoryConfig, CoreMemorySchema, CoreFieldType,
  EpisodicMemoryConfig, EpisodicEntry,
  SemanticMemoryConfig, SemanticMemoryEntry, MemoryProvider,
  MemoryPrivacyConfig, MemoryConfig,
};
