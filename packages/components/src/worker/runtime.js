export function getOptimalWasmThreads(hardwareConcurrency = globalThis.navigator?.hardwareConcurrency) {
  if (!globalThis.crossOriginIsolated) return 1;
  const available = Number.isFinite(hardwareConcurrency) ? Math.floor(hardwareConcurrency) : 1;
  return Math.max(1, available);
}

export function localForageCache(store) {
  return Object.freeze({
    get: (key) => store.getItem(key),
    set: (key, value) => store.setItem(key, value),
    delete: (key) => store.removeItem(key),
  });
}

export function cacheStorageCache(store) {
  return Object.freeze({
    async get(key) {
      const response = await store.match(key);
      return response ? response.arrayBuffer() : null;
    },
    set: (key, value) => store.put(key, new Response(value)),
    delete: (key) => store.delete(key),
  });
}
