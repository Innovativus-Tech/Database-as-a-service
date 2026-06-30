// Cache-config endpoint: customer SDKs call this to discover the Redis
// credentials they should use for caching, scoped to their database only.
//
// Auth: HTTP Basic with the customer's DB username + password (same creds
// they put in their connection string). We look up the credential, verify
// the password, and only then mint a Redis user for them.
//
// Isolation: each database gets its OWN Redis ACL user, restricted to keys
// matching `cdb:<dbId>:*`. Even if one customer leaks their Redis password
// (e.g., by debugging the SDK), they can't read or write another customer's
// cache — Redis ACL enforces the prefix at the protocol level.
//
// Deterministic password: the per-DB Redis password is derived from
// HMAC(JWT_SECRET, "redis:" + dbId), so we don't need to persist it. Same
// dbId → same Redis password forever, until the platform's JWT secret
// rotates. No DB schema change needed.

const express = require('express');
const crypto = require('crypto');
const prisma = require('../prisma');
const { decrypt } = require('../services/crypto');
const { redis } = require('../services/redisClient');

const router = express.Router();

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

// Idempotent: SETUSER overwrites existing config, so calling it on every
// request is safe and ensures the user always has the right ACL.
async function ensureRedisUserExists({ username, password, keyPrefix }) {
  // ACL command syntax: SETUSER <user> on >password ~keyPattern +@cats -cmds
  // - `on` = enable user
  // - `>password` = set the password
  // - `~cdb:dbId:*` = only allow access to keys matching this pattern
  // - `+@read +@write +@string +@hash ...` = standard data-plane commands
  // - `-FLUSHDB -FLUSHALL -KEYS -CONFIG ...` = explicit denylist of dangerous
  //   commands. These are technically inside @write/@keyspace categories, so
  //   without explicit denial a customer could FLUSHDB and wipe their own
  //   cache (annoying) or KEYS the entire keyspace and DoS the server.
  //   Key-pattern ACL doesn't block these because they don't take a key arg.
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
}

router.get('/cache-config', async (req, res) => {
  // Parse HTTP Basic auth header
  const authHeader = req.headers.authorization || '';
  const [scheme, b64] = authHeader.split(' ');
  if (scheme !== 'Basic' || !b64) {
    return res.status(401).json({ error: 'Basic auth with DB username:password required' });
  }

  let username, password;
  try {
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) throw new Error('Malformed Basic auth payload');
    username = decoded.slice(0, idx);
    password = decoded.slice(idx + 1);
  } catch {
    return res.status(401).json({ error: 'Malformed Basic auth header' });
  }

  if (!username || !password) {
    return res.status(401).json({ error: 'Empty credentials' });
  }

  // Look up the customer's DB credential
  const cred = await prisma.credential.findFirst({
    where: { username },
    include: { database: true },
  });
  if (!cred) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Verify password (constant-time compare to mitigate timing attacks)
  let actualPassword;
  try {
    actualPassword = decrypt(cred.passwordEncrypted);
  } catch {
    return res.status(500).json({ error: 'Credential store error' });
  }
  const a = Buffer.from(password);
  const b = Buffer.from(actualPassword);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const db = cred.database;
  if (db.status !== 'active') {
    return res.status(403).json({ error: 'Database is not active' });
  }

  // Derive + ensure the per-DB Redis user
  const redisUsername = deriveRedisUsername(db.id);
  const redisPassword = deriveRedisPassword(db.id);
  const keyPrefix = deriveKeyPrefix(db.id);

  try {
    await ensureRedisUserExists({
      username: redisUsername,
      password: redisPassword,
      keyPrefix,
    });
  } catch (err) {
    console.error('[cache-config] failed to provision Redis ACL user:', err.message);
    return res.status(503).json({ error: 'Cache service temporarily unavailable' });
  }

  res.json({
    host: process.env.REDIS_PUBLIC_HOST || db.host,
    port: Number(process.env.REDIS_PUBLIC_PORT) || 6380,
    username: redisUsername,
    password: redisPassword,
    keyPrefix,
    // Suggested cache TTL in seconds. The SDK can override per query.
    defaultTtlSeconds: 60,
    db: {
      id: db.id,
      name: db.dbName,
      type: db.type, // 'nosql' or 'sql'
    },
  });
});

module.exports = router;
