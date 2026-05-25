export type { StorageAdapter, StorageKind } from './types.js';
export { memoryAdapter } from './memory.js';
export { localStorageAdapter } from './local-storage.js';
export { indexedDBAdapter } from './indexeddb.js';

import type { StorageAdapter, StorageKind } from './types.js';
import { memoryAdapter } from './memory.js';
import { localStorageAdapter } from './local-storage.js';
import { indexedDBAdapter } from './indexeddb.js';

export function resolveStorage(kind: StorageKind | undefined): StorageAdapter {
  if (!kind || kind === 'memory') return memoryAdapter();
  if (kind === 'localstorage') return localStorageAdapter();
  if (kind === 'indexeddb') {
    if (typeof indexedDB === 'undefined') return memoryAdapter();
    return indexedDBAdapter();
  }
  return kind;
}
