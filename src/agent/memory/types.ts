/** Memory v1 — three-tier hybrid memory for the webagent. */

export type CoreFieldType = 'string' | 'array' | 'object' | 'number' | 'boolean';
export type CoreMemorySchema = Record<string, CoreFieldType>;

export interface CoreMemoryConfig {
  /** Field shape the LLM may write into. When omitted, free-form key-value. */
  schema?: CoreMemorySchema;
  /** Where to keep the core block. Defaults to `localStorage`. */
  storage?: 'localStorage' | 'sessionStorage' | 'memory';
  /** Max stored byte budget. Writes that exceed are dropped + warned. */
  maxBytes?: number;
}

export interface EpisodicMemoryConfig {
  enabled?: boolean;
  /** Ring-buffer cap of stored session summaries. */
  maxEntries?: number;
  /** How many summaries to load into the prompt per new run. */
  replayTopK?: number;
  /** Selection heuristic. `keyword` does cheap token overlap; `recency` is order. */
  relevance?: 'recency' | 'keyword';
  storage?: 'localStorage' | 'sessionStorage' | 'memory';
}

export interface EpisodicEntry {
  id: string;
  summary: string;
  tags?: string[];
  timestamp: number;
  turnCount?: number;
  taskSummary?: string;
}

export interface SemanticMemoryEntry {
  id: string;
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  timestamp: number;
}

/** Host-implemented backend for tier-3 semantic memory (vector store /
 *  knowledge graph / whatever). dddk wires the agent's call site but does
 *  NOT embed or persist — that's the host's job. */
export interface MemoryProvider {
  remember(entry: Omit<SemanticMemoryEntry, 'id' | 'timestamp'>): Promise<string>;
  recall(query: string, opts?: { topK?: number; tags?: string[] }): Promise<SemanticMemoryEntry[]>;
  forget(id: string): Promise<void>;
  list?(opts?: { tags?: string[]; limit?: number }): Promise<SemanticMemoryEntry[]>;
}

export interface SemanticMemoryConfig {
  provider: MemoryProvider;
  /** `explicit` — only writes when user marks important or the agent tool
   *  call asks. `auto` — writes a candidate every turn (off by default). */
  writeMode?: 'explicit' | 'auto';
}

export interface MemoryPrivacyConfig {
  /** Surface a one-off opt-in UI before the first write. */
  requireConsent?: boolean;
  /** Cleanup horizon. Older episodic entries are dropped on next read. */
  retentionDays?: number;
  /** Regex set that blocks matching text from being written. */
  excludePatterns?: RegExp[];
}

export interface MemoryConfig {
  core?: CoreMemoryConfig;
  episodic?: EpisodicMemoryConfig;
  semantic?: SemanticMemoryConfig;
  privacy?: MemoryPrivacyConfig;
}
