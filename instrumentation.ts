/**
 * Server startup hook: neutralize Node 25 broken localStorage before SSR.
 * @see scripts/polyfill-localstorage.cjs
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;

  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls != null && typeof ls.getItem === 'function') return;
  } catch {
    // continue to polyfill
  }

  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    getItem(key) {
      const k = String(key);
      return store.has(k) ? store.get(k)! : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
    key(index) {
      return Array.from(store.keys())[Number(index)] ?? null;
    },
    get length() {
      return store.size;
    },
  };

  try {
    Object.defineProperty(globalThis, 'localStorage', {
      value: memoryStorage,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch {
    try {
      (globalThis as { localStorage: Storage }).localStorage = memoryStorage;
    } catch {
      // ignore
    }
  }
}
