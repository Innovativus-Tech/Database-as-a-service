// The cache layer — fetches per-DB Redis credentials from the platform's
// /api/cache-config endpoint, maintains a Redis connection, and exposes
// getOrSet + invalidate operations. All errors fall through to the underlying
// DB call so a Redis outage degrades performance, not correctness.

'use strict';

const crypto = require('crypto');
const Redis = require('ioredis');

// After a failed connect, don't hammer the config endpoint / Redis on every
// query — wait this long before the next attempt. Queries in the cooldown
// window go straight to the database.
const RECONNECT_COOLDOWN_MS = 30_000;

class CacheLayer {
  constructor({ cacheConfigUrl, username, password, dbId: knownDbId, dbType, defaultTtl, debug, serializer }) {
    this.cacheConfigUrl = cacheConfigUrl;
    this.username = username;
    this.password = password;
    this.knownDbId = knownDbId;
    this.dbType = dbType;
    this.defaultTtl = defaultTtl ?? null;
    this.debug = !!debug;
    // Optional { stringify, parse } pair — the Mongo client passes EJSON so
    // ObjectId/Date survive the cache round-trip. Defaults to plain JSON.
    this._serializer = serializer || JSON;

    this._redis = null;
    this._config = null;
    this._connectPromise = null;
    this._lastConnectFailAt = 0;
  }

  // Fetches /api/cache-config with HTTP Basic auth, opens the Redis
  // connection. Idempotent — called automatically on first cache op.
  async connect() {
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = (async () => {
      const cfg = await this._fetchConfig();
      this._config = cfg;
      const redis = new Redis({
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
      // Persistent error handler goes on BEFORE anything can fail — ioredis
      // is an EventEmitter, and an 'error' event with no listener crashes
      // the whole process (including background reconnect failures).
      redis.on('error', (err) => {
        if (this.debug) console.warn('[customdb] redis error (non-fatal):', err.code || err.message);
      });
      // Wait for the connection to actually open before returning — keeps
      // the very first cache call snappy and avoids buffered-command lag.
      try {
        await new Promise((resolve, reject) => {
          redis.once('connect', resolve);
          redis.once('error', reject);
        });
      } catch (err) {
        // Kill the failed instance so it doesn't keep retrying forever in
        // the background; _ensureConnected() will build a fresh one later.
        try { redis.disconnect(); } catch {}
        throw err;
      }
      this._redis = redis;
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

  // Connect, but treat failure as "cache unavailable" instead of an error.
  // A dead Redis or unreachable cache-config endpoint must never take the
  // customer's database access down with it — reads/writes fall through to
  // the real database and we retry the cache connection after a cooldown.
  async _ensureConnected() {
    if (this._redis && this._config) return true;
    if (Date.now() - this._lastConnectFailAt < RECONNECT_COOLDOWN_MS) return false;
    try {
      await this.connect();
      return true;
    } catch (err) {
      this._lastConnectFailAt = Date.now();
      this._connectPromise = null; // allow a fresh attempt after the cooldown
      if (this._redis) { try { this._redis.disconnect(); } catch {} this._redis = null; }
      if (this.debug) console.warn('[customdb] cache unavailable, queries go direct to DB:', err.message);
      return false;
    }
  }

  // Try Redis first; on miss or any error, call loader() and cache the result.
  // ttlSeconds: how long the cache entry lives. null/undefined = use server's
  // suggested default.
  async getOrSet(rawKey, ttlSeconds, loader) {
    if (!(await this._ensureConnected())) return loader();
    const key = this._namespacedKey(rawKey);
    const ttl = ttlSeconds ?? this._config?.defaultTtlSeconds ?? 60;

    try {
      const hit = await this._redis.get(key);
      if (hit !== null) {
        if (this.debug) console.log(`[customdb] cache HIT ${key}`);
        return this._serializer.parse(hit);
      }
    } catch (err) {
      // Redis read failed — degrade to direct DB call. Don't throw.
      if (this.debug) console.warn('[customdb] redis read error, falling through:', err.message);
    }

    if (this.debug) console.log(`[customdb] cache MISS ${key}`);
    const fresh = await loader();

    try {
      await this._redis.set(key, this._serializer.stringify(fresh), 'EX', ttl);
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
    if (!(await this._ensureConnected())) return;
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
    if (!(await this._ensureConnected())) return '0';
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
