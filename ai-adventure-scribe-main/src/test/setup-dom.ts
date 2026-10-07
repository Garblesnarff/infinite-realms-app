import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// DOM-only Vitest setup
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-function-return-type */

type MockIDBRequest<T = any> = {
  onsuccess: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onupgradeneeded?: ((event: any) => void) | null;
  result: T;
  error: Error | null;
};

type MockStoreMeta = {
  keyPath: string;
  data: Map<string, any>;
};

const createRequest = <T = any>(): MockIDBRequest<T> => ({
  onsuccess: null,
  onerror: null,
  onupgradeneeded: null,
  result: undefined as T,
  error: null,
});

const resolveRequest = <T>(request: MockIDBRequest<T>, result: T, target: any = request): void => {
  setTimeout(() => {
    request.result = result;
    request.onsuccess?.({ target });
  }, 0);
};

if (!(globalThis as any).IDBKeyRange) {
  (globalThis as any).IDBKeyRange = {
    upperBound: (upper: string) => ({ upper }),
  };
}

if (!(globalThis as any).indexedDB) {
  class MockObjectStoreNames {
    private names = new Set<string>();

    contains(name: string): boolean {
      return this.names.has(name);
    }

    add(name: string): void {
      this.names.add(name);
    }
  }

  class MockObjectStore {
    constructor(
      private store: MockStoreMeta,
      private indexName?: string,
    ) {}

    createIndex(index: string): void {
      this.indexName = index;
    }

    put(value: any): MockIDBRequest<void> {
      const request = createRequest<void>();
      const key = String(value[this.store.keyPath]);
      this.store.data.set(key, value);
      resolveRequest(request, undefined);
      return request;
    }

    get(key: string): MockIDBRequest<any> {
      const request = createRequest<any>();
      resolveRequest(request, this.store.data.get(String(key)));
      return request;
    }

    index(name: string): MockObjectStore {
      return new MockObjectStore(this.store, name);
    }

    getAll(value: any): MockIDBRequest<any[]> {
      const request = createRequest<any[]>();
      const items = Array.from(this.store.data.values()).filter((item) =>
        this.indexName ? item[this.indexName] === value : true,
      );
      resolveRequest(request, items);
      return request;
    }

    openCursor(range: { upper: string }): MockIDBRequest<any> {
      const request = createRequest<any>();
      const entries = Array.from(this.store.data.entries()).filter(([, item]) => {
        if (!this.indexName) return true;
        const candidate = String(item[this.indexName]);
        return candidate <= range.upper;
      });

      let pointer = 0;
      const advance = () => {
        const current = entries[pointer];
        if (!current) {
          resolveRequest(request, null, request);
          return;
        }

        const [key, value] = current;
        const cursor = {
          value,
          delete: () => {
            this.store.data.delete(key);
          },
          continue: () => {
            pointer += 1;
            setTimeout(advance, 0);
          },
        };

        resolveRequest(request, cursor, { result: cursor });
      };

      setTimeout(advance, 0);
      return request;
    }
  }

  class MockDatabase {
    public objectStoreNames = new MockObjectStoreNames();
    private stores = new Map<string, MockStoreMeta>();

    createObjectStore(name: string, options: { keyPath: string }): MockObjectStore {
      const meta: MockStoreMeta = { keyPath: options.keyPath, data: new Map() };
      this.objectStoreNames.add(name);
      this.stores.set(name, meta);
      return new MockObjectStore(meta);
    }

    transaction(_storeNames: string[]): { objectStore: (name: string) => MockObjectStore } {
      return {
        objectStore: (name: string) => {
          const store = this.stores.get(name);
          if (!store) {
            throw new Error(`Object store ${name} not found`);
          }
          return new MockObjectStore(store);
        },
      };
    }
  }

  const databases = new Map<string, MockDatabase>();

  (globalThis as any).indexedDB = {
    open: (name: string) => {
      const request = createRequest<any>();
      let db = databases.get(name);
      const needsUpgrade = !db;

      if (!db) {
        db = new MockDatabase();
        databases.set(name, db);
      }

      request.result = db as any;

      setTimeout(() => {
        if (needsUpgrade) {
          request.onupgradeneeded?.({ target: request });
        }
        request.onsuccess?.({ target: request });
      }, 0);

      return request;
    },
  };
}

// Mock global objects that might be missing in jsdom or causing issues
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

if (!navigator.mediaDevices) {
  (navigator as any).mediaDevices = {};
}
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
  writable: true,
  value: vi.fn().mockResolvedValue(null), // Mock it to resolve with null or a mock stream
});
