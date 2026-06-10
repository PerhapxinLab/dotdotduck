import type { CoreMemoryConfig, CoreMemorySchema } from './types';

const KEY = 'dddk:memory:core';

type StorageKind = NonNullable<CoreMemoryConfig['storage']>;

function pickStorage(kind: StorageKind | undefined): Storage | null {
  if (typeof window === 'undefined') return null;
  if (kind === 'sessionStorage') return window.sessionStorage;
  if (kind === 'memory') return null;
  return window.localStorage;
}

/** Tier 1 — structured user profile, always in context. < maxBytes. */
export class CoreMemory {
  private data: Record<string, unknown> = {};
  private schema?: CoreMemorySchema;
  private storage: Storage | null;
  private maxBytes: number;

  constructor(cfg: CoreMemoryConfig = {}) {
    this.schema = cfg.schema;
    this.maxBytes = cfg.maxBytes ?? 2048;
    this.storage = pickStorage(cfg.storage);
    this.load();
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(KEY);
      if (raw) this.data = JSON.parse(raw) as Record<string, unknown>;
    } catch { /* corrupt blob — start fresh */ }
  }

  private persist(): void {
    if (!this.storage) return;
    try { this.storage.setItem(KEY, JSON.stringify(this.data)); } catch { /* quota */ }
  }

  private validateField(key: string, value: unknown): boolean {
    if (!this.schema) return true;
    const t = this.schema[key];
    if (!t) return false;
    switch (t) {
      case 'string': return typeof value === 'string';
      case 'array': return Array.isArray(value);
      case 'object': return value != null && typeof value === 'object' && !Array.isArray(value);
      case 'number': return typeof value === 'number';
      case 'boolean': return typeof value === 'boolean';
    }
  }

  get(key: string): unknown {
    return this.data[key];
  }

  set(key: string, value: unknown): boolean {
    if (!this.validateField(key, value)) {
      if (typeof console !== 'undefined') {
        console.warn(`[dddk memory] core: field "${key}" rejected by schema`);
      }
      return false;
    }
    const next = { ...this.data, [key]: value };
    const size = JSON.stringify(next).length;
    if (size > this.maxBytes) {
      if (typeof console !== 'undefined') {
        console.warn(`[dddk memory] core: write would exceed ${this.maxBytes} bytes`);
      }
      return false;
    }
    this.data = next;
    this.persist();
    return true;
  }

  remove(key: string): void {
    delete this.data[key];
    this.persist();
  }

  snapshot(): Record<string, unknown> {
    return { ...this.data };
  }

  clear(): void {
    this.data = {};
    if (this.storage) {
      try { this.storage.removeItem(KEY); } catch { /* ignore */ }
    }
  }

  /** Render as a system-prompt block. Empty string when no entries. */
  toPromptBlock(): string {
    const entries = Object.entries(this.data);
    if (entries.length === 0) return '';
    const lines = ['# About this user'];
    for (const [k, v] of entries) {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      lines.push(`- ${k}: ${val}`);
    }
    return lines.join('\n');
  }
}
