type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

declare global {
  // eslint-disable-next-line no-var
  var __RR_MEMORY_CACHE__: Map<string, CacheEntry> | undefined;
  // eslint-disable-next-line no-var
  var __RR_MEMORY_CACHE_INFLIGHT__: Map<string, Promise<unknown>> | undefined;
}

const cacheStore = globalThis.__RR_MEMORY_CACHE__ || new Map<string, CacheEntry>();
const inflightStore =
  globalThis.__RR_MEMORY_CACHE_INFLIGHT__ || new Map<string, Promise<unknown>>();

globalThis.__RR_MEMORY_CACHE__ = cacheStore;
globalThis.__RR_MEMORY_CACHE_INFLIGHT__ = inflightStore;

export async function withMemoryCache<T>(
  key: string,
  ttlMs: number,
  factory: () => Promise<T>
): Promise<T> {
  const current = cacheStore.get(key);
  const now = Date.now();

  if (current && current.expiresAt > now) {
    return current.value as T;
  }

  const inflight = inflightStore.get(key);
  if (inflight) {
    return inflight as Promise<T>;
  }

  const promise = (async () => {
    const value = await factory();
    cacheStore.set(key, {
      expiresAt: Date.now() + ttlMs,
      value,
    });
    return value;
  })().finally(() => {
    inflightStore.delete(key);
  });

  inflightStore.set(key, promise);
  return promise;
}

export function clearMemoryCache(prefix?: string) {
  if (!prefix) {
    cacheStore.clear();
    inflightStore.clear();
    return;
  }

  for (const key of Array.from(cacheStore.keys())) {
    if (key.startsWith(prefix)) {
      cacheStore.delete(key);
    }
  }

  for (const key of Array.from(inflightStore.keys())) {
    if (key.startsWith(prefix)) {
      inflightStore.delete(key);
    }
  }
}
