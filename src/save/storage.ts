/** Storage behind an interface so the desktop build can swap IndexedDB for files. */
export interface StorageBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export class MemoryBackend implements StorageBackend {
  private readonly map = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.map.get(key) ?? null; }
  async set(key: string, value: string): Promise<void> { this.map.set(key, value); }
  async delete(key: string): Promise<void> { this.map.delete(key); }
  async keys(): Promise<string[]> { return [...this.map.keys()]; }
}

const DB = 'shelf-made', STORE = 'saves';

export class IndexedDBBackend implements StorageBackend {
  private dbp: Promise<IDBDatabase> | null = null;
  private open(): Promise<IDBDatabase> {
    this.dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbp;
  }
  private async tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    return db.transaction(STORE, mode).objectStore(STORE);
  }
  private wrap<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  }
  async get(key: string): Promise<string | null> { const v = await this.wrap((await this.tx('readonly')).get(key)); return typeof v === 'string' ? v : null; }
  async set(key: string, value: string): Promise<void> { await this.wrap((await this.tx('readwrite')).put(value, key)); }
  async delete(key: string): Promise<void> { await this.wrap((await this.tx('readwrite')).delete(key)); }
  async keys(): Promise<string[]> { const k = await this.wrap((await this.tx('readonly')).getAllKeys()); return k.map(String); }
}

/** Picks IndexedDB when available (browser), else memory (tests, SSR). A desktop wrapper can inject its own. */
export function defaultBackend(): StorageBackend {
  const injected = (globalThis as { __shelfStorage?: StorageBackend }).__shelfStorage;
  if (injected) return injected;
  if (typeof indexedDB !== 'undefined') return new IndexedDBBackend();
  return new MemoryBackend();
}
