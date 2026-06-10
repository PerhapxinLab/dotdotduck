import type { MemoryProvider, SemanticMemoryConfig, SemanticMemoryEntry } from './types';

/** Tier 3 — thin wrapper over a host-provided MemoryProvider. dddk does
 *  NOT embed or persist; the host's provider owns infra. */
export class SemanticMemory {
  private provider: MemoryProvider;
  readonly writeMode: 'explicit' | 'auto';

  constructor(cfg: SemanticMemoryConfig) {
    this.provider = cfg.provider;
    this.writeMode = cfg.writeMode ?? 'explicit';
  }

  recall(query: string, opts?: { topK?: number; tags?: string[] }): Promise<SemanticMemoryEntry[]> {
    return this.provider.recall(query, opts);
  }

  remember(entry: Omit<SemanticMemoryEntry, 'id' | 'timestamp'>): Promise<string> {
    return this.provider.remember(entry);
  }

  forget(id: string): Promise<void> {
    return this.provider.forget(id);
  }

  async list(opts?: { tags?: string[]; limit?: number }): Promise<SemanticMemoryEntry[]> {
    if (!this.provider.list) return [];
    return this.provider.list(opts);
  }

  toPromptBlock(recalled: SemanticMemoryEntry[]): string {
    if (recalled.length === 0) return '';
    const lines = ['# Recalled facts'];
    for (const e of recalled) lines.push(`- ${e.content}`);
    return lines.join('\n');
  }
}
