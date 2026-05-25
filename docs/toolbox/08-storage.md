# storage

Persistence adapters. Each toolbox module accepts `storage: 'memory' | 'indexeddb' | 'localstorage' | CustomAdapter`.

## Built-in

| Adapter | Persistence | Where it runs |
|---------|-------------|---------------|
| `memoryAdapter()`        | Volatile (lost on page reload) | Anywhere |
| `localStorageAdapter()`  | Persistent, ~5MB cap, sync API wrapped async | Browsers |
| `indexedDBAdapter()`     | Persistent, GB-scale, async | Browsers |

`resolveStorage('indexeddb')` auto-falls back to memory if IndexedDB is unavailable
(SSR / Node test environment) — modules work in all environments without special casing.

## Custom adapter

```typescript
import type { StorageAdapter } from '@perhapxin/dddk/toolbox/storage';
import fs from 'node:fs/promises';

const fsAdapter: StorageAdapter = {
  async open(name) {
    await fs.mkdir(`./.dddk/${name}`, { recursive: true });
  },
  async get(key) {
    try {
      return JSON.parse(await fs.readFile(`./.dddk/${key}.json`, 'utf-8'));
    } catch {
      return undefined;
    }
  },
  async set(key, value) {
    await fs.writeFile(`./.dddk/${key}.json`, JSON.stringify(value));
  },
  async delete(key) {
    await fs.unlink(`./.dddk/${key}.json`).catch(() => {});
  },
  async *iterate(prefix) {
    const files = await fs.readdir('./.dddk');
    for (const f of files) {
      if (!f.startsWith(prefix)) continue;
      const v = JSON.parse(await fs.readFile(`./.dddk/${f}`, 'utf-8'));
      yield [f, v];
    }
  },
  async close() {},
};

const search = createSearch({ storage: fsAdapter, ... });
```
