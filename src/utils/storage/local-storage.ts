import type { StorageAdapter } from './types.js';

export function localStorageAdapter(prefix = 'dddk:'): StorageAdapter {
  const fullKey = (k: string) => prefix + k;
  return {
    async open() {
      if (typeof localStorage === 'undefined') {
        throw new Error('localStorageAdapter: localStorage is unavailable in this runtime');
      }
    },
    async get(key) {
      const raw = localStorage.getItem(fullKey(key));
      if (raw === null) return undefined as never;
      try {
        return JSON.parse(raw) as never;
      } catch {
        return raw as never;
      }
    },
    async set(key, value) {
      localStorage.setItem(fullKey(key), JSON.stringify(value));
    },
    async delete(key) {
      localStorage.removeItem(fullKey(key));
    },
    async *iterate(p) {
      const full = prefix + p;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(full)) continue;
        const raw = localStorage.getItem(k);
        if (raw === null) continue;
        let val: unknown;
        try {
          val = JSON.parse(raw);
        } catch {
          val = raw;
        }
        yield [k.slice(prefix.length), val];
      }
    },
    async close() {},
  };
}
