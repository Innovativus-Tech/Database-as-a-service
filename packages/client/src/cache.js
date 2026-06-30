// The cache layer — fetches per-DB Redis credentials from the platform's
// /api/cache-config endpoint, maintains a Redis connection, and exposes
// getOrSet + invalidate operations. All errors fall through to the underlying
// DB call so a Redis outage degrades performance, not correctness.

'use strict';

const crypto = require('crypto');
const Redis = require('ioredis');

class CacheLayer {
  constructor({ cacheConfigUrl, username, password, dbId: knownDbId, dbType, defaultTtl, debug }) {
    this.cacheConfigUrl = cacheConfigUrl;
    this.username = username;
    this.password = password;
    this.knownDbId = knownDbId;
    this.dbType = dbType;
    this.defaultTtl = defaultTtl ?? null;
    this.debug = !!debug;

    this._redis = null;
    this._config = null;
    this._connectPromise = null;
  }

  // Fetches /api/cache-config with HTTP Basic auth, opens the Redis
  // connection. Idempotent — called automatically on first cache op.
  async connect() {
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = (async () => {
      const cfg = await this._fetchConfig();
      this._config = cfg;
      this._redis = new Redis({
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        password: cfg.password,
        maxRetriesPerRequest: 2,
        connectTimeout: 5000,
        // Buffer commands until the TCP/auth handshake completes, otherwise
        // the very first cache op after process start races ahead of the
        // connection and fails with "Stream isn't writeable". One-time
        // race; doesn't affect steady-state behavior.
        enableOfflineQueue: true,
        // The per-DB Redis ACL user is explicitly denied admin commands
        // (INFO, CONFIG, etc.). ioredis's default readiness check uses
        // INFO and would log a noisy warning + delay readiness otherwise.
        enableReadyCheck: false,
        lazyConnect: false,
      });
      // Wait for the connection to actually open before returning — keeps
      // the very first cache call snappy and avoids buffered-command lag.
      await new Promise((resolve, reject) => {
        const onReady = () => { cleanup(); resolve(); };
        const onError = (e) => { cleanup(); reject(e); };
        const cleanup = () => {
          this._redis.removeListener('connect', onReady);
          this._redis.removeListener('error', onError);
        };
        this._redis.once('connect', onReady);
        this._redis.once('error', onError);
      });
      this._redis.on('error', (err) => {
        if (this.debug) console.warn('[customdb] redis error (non-fatal):', err.code || err.message);
      });
    })();
    return this._connectPromise;
  }

  async _fetchConfig() {
    const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    const url = `${this.cacheConfigUrl}/api/cache-config`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`cache-config fetch failed (${res.status}): ${body || res.statusText}`);
    }
    return res.json();
  }

  // Try Redis first; on miss or any error, call loader() and cache the result.
  // ttlSeconds: how long the cache entry lives. null/undefined = use server's
  // suggested default.
  async getOrSet(rawKey, ttlSeconds, loader) {
    await this.connect();
    const key = this._namespacedKey(rawKey);
    const ttl = ttlSeconds ?? this._config?.defaultTtlSeconds ?? 60;

    try {
      const hit = await this._redis.get(key);
      if (hit !== null) {
        if (this.debug) console.log(`[customdb] cache HIT ${key}`);
        return JSON.parse(hit);
      }
    } catch (err) {
      // Redis read failed — degrade to direct DB call. Don't throw.
      if (this.debug) console.warn('[customdb] redis read error, falling through:', err.message);
    }

    if (this.debug) console.log(`[customdb] cache MISS ${key}`);
    const fresh = await loader();

    try {
      await this._redis.set(key, JSON.stringify(fresh), 'EX', ttl);
    } catch (err) {
      // Redis write failed — return fresh data without caching. Don't throw.
      if (this.debug) console.warn('[customdb] redis write error (non-fatal):', err.message);
    }
    return fresh;
  }

  // Invalidate one specific key (un-namespaced; we add the prefix).
  async invalidate(rawKey) {
    if (!this._redis) return;
    try {
      await this._redis.del(this._namespacedKey(rawKey));
    } catch (err) {
      if (this.debug) console.warn('[customdb] invalidate failed (non-fatal):', err.message);
    }
  }

  // Invalidate every key under a "tag" — used for "wipe everything for this
  // collection/table after a write." We can't use Redis KEYS pattern (the SDK
  // user is denied that command by ACL), so we keep a tag→version counter:
  // bumping the counter makes any cached entry for that tag stale immediately.
  async bumpTag(tag) {
    if (!this._redis) return;
    try {
      await this._redis.incr(this._namespacedKey(`tag:${tag}`));
    } catch (err) {
      if (this.debug) console.warn('[customdb] bumpTag failed (non-fatal):', err.message);
    }
  }

  // Read the current version for a tag — used as a salt in cache keys so
  // bumping the tag invalidates all keys derived from that tag in O(1) on
  // the write side. Old keys naturally expire via TTL.
  async getTagVersion(tag) {
    if (!this._redis) return '0';
    try {
      const v = await this._redis.get(this._namespacedKey(`tag:${tag}`));
      return v || '0';
    } catch {
      return '0';
    }
  }

  _namespacedKey(rawKey) {
    // The platform's ACL forces all keys to start with the keyPrefix
    // anyway — any attempt to write outside it returns NOPERM. Doing the
    // prefix client-side just saves a round trip.
    return `${this._config.keyPrefix}${rawKey}`;
  }

  async disconnect() {
    if (this._redis) {
      try { await this._redis.quit(); } catch {}
      this._redis = null;
    }
  }
}

// Hash a query+params object into a stable, short cache-key fragment.
// Used by both the Mongo and Postgres clients.
function hashQuery(value) {
  const str = JSON.stringify(value, (_, v) =>
    typeof v === 'bigint' ? `__bigint:${v.toString()}` :
    v instanceof Date ? `__date:${v.toISOString()}` :
    v
  );
  return crypto.createHash('sha1').update(str || '').digest('hex').slice(0, 16);
}

module.exports = { CacheLayer, hashQuery };
