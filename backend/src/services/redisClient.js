// Backend's connection to the platform Redis. Reused by the cache-config
// endpoint to manage per-DB ACL users, and available for any future feature
// that wants to talk to Redis from the backend itself.
//
// Connects via the internal Docker network hostname (customdb-redis), not
// the public host — internal hop bypasses nginx and doesn't need TLS.
// REDIS_URL is set in docker-compose.yml and includes the auth password.

const Redis = require('ioredis');

let _client = null;

function redis() {
  if (_client) return _client;
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL is not set — Redis service unavailable. Set it in your environment.');
  }
  _client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    // Buffer commands until connection is established. The first call after
    // process start would otherwise race ahead of the TCP handshake and fail
    // with "Stream isn't writeable" — happens reliably for the cache-config
    // endpoint when the very first customer call comes in during cold start.
    enableOfflineQueue: true,
    connectTimeout: 5000,
  });
  _client.on('error', (err) => {
    // Don't crash the backend if Redis hiccups — degrade gracefully.
    console.warn('[redis] connection error (non-fatal):', err.code || err.message);
  });
  return _client;
}

module.exports = { redis };
