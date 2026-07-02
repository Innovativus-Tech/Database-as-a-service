// Per-database Redis cache credentials, derived deterministically — no
// storage needed. Same derivation is used by the customer-facing
// /api/cache-config endpoint and by the dashboard's database detail view,
// so both always agree on the credentials.
const crypto = require('crypto');

const REDIS_USER_PREFIX = 'rdb_';

// HMAC-based deterministic password so we never need to store Redis creds.
function deriveRedisPassword(dbId) {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update('redis:' + dbId)
    .digest('hex')
    .slice(0, 32);
}

function deriveRedisUsername(dbId) {
  // Redis usernames must match [A-Za-z0-9_] — strip dashes from UUID.
  return REDIS_USER_PREFIX + dbId.replace(/-/g, '').slice(0, 16);
}

function deriveKeyPrefix(dbId) {
  return `cdb:${dbId}:`;
}

// Public URL a customer app can use directly (the SDK discovers the same
// thing via /api/cache-config).
function publicRedisUrl(dbId, fallbackHost) {
  const host = process.env.REDIS_PUBLIC_HOST || fallbackHost;
  const port = Number(process.env.REDIS_PUBLIC_PORT) || 6380;
  return `redis://${deriveRedisUsername(dbId)}:${deriveRedisPassword(dbId)}@${host}:${port}`;
}

// Idempotent ACL provisioning, throttled per-DB. SETUSER overwrites existing
// config, so re-running is always safe; the TTL just avoids a Redis
// round-trip on every call. 5 minutes: long enough to absorb bursts, short
// enough to self-heal after a Redis restart wipes the ACL table.
const ACL_PROVISION_TTL_MS = 5 * 60_000;

async function ensureAclProvisioned(dbId) {
  const { redis } = require('./redisClient');
  const { cache } = require('./cache');
  const username = deriveRedisUsername(dbId);
  const password = deriveRedisPassword(dbId);
  const keyPrefix = deriveKeyPrefix(dbId);
  await cache.getOrLoad(`acl-provisioned:${dbId}`, ACL_PROVISION_TTL_MS, async () => {
    // ACL: enable user, set password, restrict to this DB's key prefix,
    // allow data-plane command categories, deny admin/keyspace-wide commands
    // (they take no key argument, so the key pattern alone can't stop them).
    await redis().call('ACL', 'SETUSER', username, 'on',
      `>${password}`,
      `~${keyPrefix}*`,
      '+@read', '+@write',
      '+@string', '+@hash', '+@set', '+@sortedset', '+@list',
      '+@hyperloglog', '+@geo', '+@stream', '+@bitmap',
      '+@scripting', '+@connection', '+@transaction',
      '-FLUSHDB', '-FLUSHALL', '-KEYS', '-SCAN',
      '-CONFIG', '-DEBUG', '-SHUTDOWN', '-MONITOR',
      '-CLIENT', '-CLUSTER', '-REPLICAOF', '-SLAVEOF',
      '-SAVE', '-BGSAVE', '-BGREWRITEAOF', '-LASTSAVE'
    );
    return true;
  });
}

module.exports = { deriveRedisPassword, deriveRedisUsername, deriveKeyPrefix, publicRedisUrl, ensureAclProvisioned };
