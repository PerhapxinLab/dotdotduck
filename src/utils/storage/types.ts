export interface StorageAdapter {
  open(name: string): Promise<void>;
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  iterate(prefix: string): AsyncIterable<[string, unknown]>;
  close(): Promise<void>;
}

export type StorageKind = 'memory' | 'indexeddb' | 'localstorage' | StorageAdapter;
