import type { StorageAdapter } from './types.js';

export function memoryAdapter(): StorageAdapter {
  const store = new Map<string, unknown>();
  return {
    async open() {},
    async get(key) {
      return store.get(key) as never;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async *iterate(prefix) {
      for (const [k, v] of store) if (k.startsWith(prefix)) yield [k, v];
    },
    async close() {
      store.clear();
    },
  };
}
