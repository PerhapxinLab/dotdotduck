import type { StorageAdapter } from './types.js';

const STORE = 'kv';

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function indexedDBAdapter(dbName = 'dddk-toolbox'): StorageAdapter {
  let db: IDBDatabase | undefined;
  return {
    async open() {
      if (typeof indexedDB === 'undefined') {
        throw new Error('indexedDBAdapter: IndexedDB unavailable; falling back recommended for SSR / Node');
      }
      db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async get(key) {
      if (!db) throw new Error('indexedDBAdapter: not opened');
      const tx = db.transaction(STORE, 'readonly');
      return (await promisify(tx.objectStore(STORE).get(key))) as never;
    },
    async set(key, value) {
      if (!db) throw new Error('indexedDBAdapter: not opened');
      const tx = db.transaction(STORE, 'readwrite');
      await promisify(tx.objectStore(STORE).put(value, key));
    },
    async delete(key) {
      if (!db) throw new Error('indexedDBAdapter: not opened');
      const tx = db.transaction(STORE, 'readwrite');
      await promisify(tx.objectStore(STORE).delete(key));
    },
    async *iterate(prefix) {
      if (!db) throw new Error('indexedDBAdapter: not opened');
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const range = IDBKeyRange.bound(prefix, prefix + '￿');
      const cursorReq = store.openCursor(range);
      while (true) {
        const cur = await new Promise<IDBCursorWithValue | null>((resolve, reject) => {
          cursorReq.onsuccess = () => resolve(cursorReq.result);
          cursorReq.onerror = () => reject(cursorReq.error);
        });
        if (!cur) break;
        yield [String(cur.key), cur.value];
        cur.continue();
      }
    },
    async close() {
      db?.close();
      db = undefined;
    },
  };
}
