// In-memory TTL cache with in-flight request coalescing.
//
// Two properties that matter for the hot paths:
//   1. TTL — burst of N requests for the same key inside the window collapses
//      to 1 expensive backing call (Postgres query, disk walk, Docker socket).
//   2. In-flight dedupe — if a key is being computed RIGHT NOW and another
//      request for the same key arrives, it awaits the in-flight promise
//      instead of starting a second backing call. Without this, the first
//      few simultaneous requests after a cold start all do the expensive work.
//
// One process, one shared instance. Sized cap evicts oldest entries when
// passing the limit to keep memory bounded even with many user databases.

const DEFAULT_MAX = 5000;

function createTTLCache({ max = DEFAULT_MAX } = {}) {
  const data = new Map();   // key -> { value, expiresAt }
  const inflight = new Map(); // key -> Promise<value>

  function get(key) {
    const entry = data.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      data.delete(key);
      return undefined;
    }
    // Touch for LRU ordering on Map (delete + set moves to tail).
    data.delete(key);
    data.set(key, entry);
    return entry.value;
  }

  function set(key, value, ttlMs) {
    if (data.size >= max) {
      const oldest = data.keys().next().value;
      if (oldest !== undefined) data.delete(oldest);
    }
    data.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  function invalidate(key) {
    data.delete(key);
    inflight.delete(key);
  }

  // get-or-compute. Concurrent callers for the same key await the same
  // pending promise — exactly one backing call runs at a time per key.
  async function getOrLoad(key, ttlMs, loader) {
    const hit = get(key);
    if (hit !== undefined) return hit;

    const pending = inflight.get(key);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const value = await loader();
        set(key, value, ttlMs);
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise);
    return promise;
  }

  return { get, set, invalidate, getOrLoad, _data: data };
}

// Single shared instance for the whole process.
const cache = createTTLCache();

module.exports = { cache, createTTLCache };
