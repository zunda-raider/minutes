/**
 * Node.js 25+ enables experimental Web Storage without --localstorage-file,
 * leaving globalThis.localStorage as a broken empty Proxy.
 * Next.js / tooling then does typeof localStorage !== 'undefined' && localStorage.getItem(...)
 * and crashes with: TypeError: localStorage.getItem is not a function
 *
 * See: https://github.com/nodejs/node/issues/60303
 */
(function polyfillBrokenLocalStorage() {
  try {
    const ls = globalThis.localStorage;
    if (ls != null && typeof ls.getItem === 'function') {
      return; // real or already-good Storage
    }
  } catch {
    // getter itself threw — replace below
  }

  const store = new Map();
  const memoryStorage = {
    getItem(key) {
      const k = String(key);
      return store.has(k) ? store.get(k) : null;
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
      globalThis.localStorage = memoryStorage;
    } catch {
      // give up — caller may still fail
    }
  }
})();
