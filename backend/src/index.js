require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const prisma = require('./prisma');

const app = express();
app.set('trust proxy', 1);

// CORS — two policies:
//
// 1. Dashboard/API routes (/api/auth, /api/databases): restricted to the
//    configured FRONTEND_ORIGIN, any https subdomain of its registrable
//    domain (staging, previews), and localhost for dev. The old config
//    reflected EVERY https origin here, which let any website script calls
//    against the dashboard API.
// 2. /api/cache-config: open to any origin — it authenticates with per-DB
//    Basic credentials (no cookies, no ambient auth), and customer apps
//    live on domains we can't enumerate.
//
// `credentials: false` is correct for JWT-in-Authorization-header auth.
// Disallowed origins get cb(null, false) — request proceeds without CORS
// headers (browser blocks the read) instead of a confusing 500.
function registrableDomain(hostname) {
  const parts = hostname.split('.').filter(Boolean);
  return parts.length <= 2 ? hostname : parts.slice(-2).join('.');
}
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || '').replace(/\/+$/, '');
let allowedRootDomain = null;
try {
  if (FRONTEND_ORIGIN) allowedRootDomain = registrableDomain(new URL(FRONTEND_ORIGIN).hostname);
} catch { /* malformed FRONTEND_ORIGIN — fall through to localhost-only */ }

const sharedCors = {
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600, // browsers cache preflight result for 10 min, reducing OPTIONS hits
};
const dashboardCors = cors({
  ...sharedCors,
  origin: (origin, cb) => {
    // No Origin header = server-to-server / curl — not a browser, allow.
    if (!origin) return cb(null, true);
    if (FRONTEND_ORIGIN && origin === FRONTEND_ORIGIN) return cb(null, true);
    try {
      const { protocol, hostname } = new URL(origin);
      if (/^https?:$/.test(protocol) && /^(localhost|127\.0\.0\.1)$/.test(hostname)) return cb(null, true);
      if (protocol === 'https:' && allowedRootDomain &&
          (hostname === allowedRootDomain || hostname.endsWith(`.${allowedRootDomain}`))) {
        return cb(null, true);
      }
    } catch { /* unparseable origin — disallow */ }
    return cb(null, false);
  },
});
const openCors = cors({ ...sharedCors, origin: true });

// 17mb: MongoDB documents can be up to 16 MB, and the document editor PUTs
// the whole document as a JSON body. 1 MB silently rejected legitimate edits.
app.use(express.json({ limit: '17mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

// Root path — answer 200 OK so Coolify-Traefik's default healthcheck doesn't
// mark the container unhealthy (it probes / by default and 404 = drop the route).
app.get('/', (req, res) => {
  res.json({ service: 'customdb-backend', status: 'ok' });
});

// LIGHTWEIGHT liveness probe — for Coolify/Traefik/Docker healthcheck.
// MUST NOT touch Postgres, Redis, Docker, or anything that can block.
// If this 200s, the Node process is alive and able to serve requests.
// That's all the container orchestrator needs to know.
//
// Reason this exists: a single endpoint that did `SELECT 1` against
// Postgres caused cascading container restarts during heavy customer
// migrations. When the meta-DB slowed down, the healthcheck timed out
// (>5s), Coolify marked the container unhealthy after 3 strikes (30s),
// killed and restarted it, and login was dead for 30-60s during the
// restart. Migration kept running, the cycle repeated for hours.
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

// Deep health diagnostic — touches Postgres, intended for human use
// (curl from the dashboard, monitoring tools, etc.). DO NOT use as
// the container healthcheck.
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', message: err.message });
  }
});

app.use('/api/auth', dashboardCors, require('./routes/auth').router);
app.use('/api/databases', dashboardCors, require('./routes/databases'));
app.use('/api', openCors, require('./routes/cacheConfig'));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Redis ACL users are created with ACL SETUSER and are NOT persisted by
// Redis across restarts — after a Redis restart every per-DB cache user is
// gone, and customers using the raw redis:// URL get NOAUTH errors until
// something re-provisions them. Re-assert all ACLs on boot and every 10
// minutes (SETUSER is idempotent and one round-trip per DB — cheap).
async function reprovisionAllRedisAcls() {
  if (!process.env.REDIS_URL) return 0; // no platform Redis configured (bare local dev)
  const { ensureAclProvisioned } = require('./services/redisCreds');
  const { cache } = require('./services/cache');
  const dbs = await prisma.database.findMany({
    where: { status: 'active' },
    select: { id: true },
  });
  let failed = 0;
  for (const db of dbs) {
    // Drop the 5-min memo first so the sweep always issues a real SETUSER —
    // the memo exists to absorb request bursts, not to skip the healer.
    cache.invalidate(`acl-provisioned:${db.id}`);
    try { await ensureAclProvisioned(db.id); } catch { failed++; }
  }
  if (failed > 0) console.warn(`[redis-acl] re-provision: ${failed}/${dbs.length} failed (Redis down?)`);
  return dbs.length;
}

async function bootstrap() {
  const { ensureNetwork } = require('./services/dockerNetwork');
  const { syncFromDatabaseRows, reloadNginx } = require('./services/nginxManager');
  const { ensureContainerRunning } = require('./services/provisioning');
  const { decrypt } = require('./services/crypto');
  try {
    await ensureNetwork();

    const rows = await prisma.database.findMany({
      where: { status: { not: 'deleted' } },
      include: { credentials: true },
    });

    // Write nginx stream configs first — this is the fast part and unblocks
    // customer database routing immediately. It doesn't depend on per-DB
    // container reconciliation.
    const n = await syncFromDatabaseRows(rows.map((r) => ({
      port: r.port, type: r.type, routing: r.routing, containerName: r.containerName, tlsEnabled: r.tlsEnabled,
    })));
    if (n > 0) await reloadNginx().catch(() => {});
    console.log(`[bootstrap] synced ${n} nginx stream blocks`);

    // Reconciling user-DB containers is SLOW (docker inspect per DB, and
    // recreating any that vanished can take seconds each). Don't block
    // backend startup on this — kick it off as a detached background job
    // so /healthz, /api/auth/login etc. are immediately serving requests
    // while reconciliation runs.
    setImmediate(async () => {
      for (const db of rows) {
        if (db.status !== 'active') continue;
        try {
          const cred = db.credentials[0];
          if (!cred) continue;
          const password = decrypt(cred.passwordEncrypted);
          const action = await ensureContainerRunning({ db, username: cred.username, password });
          if (action !== 'running') console.log(`[bootstrap:bg] ${db.dbName}: container ${action}`);
        } catch (err) {
          console.error(`[bootstrap:bg] failed to reconcile ${db.dbName}:`, err.message);
        }
      }
      console.log('[bootstrap:bg] container reconciliation complete');
    });

    // Redis ACL healer — once now (covers "Redis restarted while backend was
    // down"), then every 10 minutes (covers "Redis restarted while we're up").
    reprovisionAllRedisAcls()
      .then((n) => console.log(`[redis-acl] provisioned ${n} cache users`))
      .catch((err) => console.warn('[redis-acl] initial sweep failed:', err.message));
    setInterval(() => {
      reprovisionAllRedisAcls().catch(() => {});
    }, 10 * 60 * 1000).unref();
  } catch (err) {
    console.warn('[bootstrap] non-fatal init warning:', err.message);
  }
}

const PORT = Number(process.env.PORT) || 4000;
const server = app.listen(PORT, async () => {
  console.log(`[customdb-backend] listening on http://localhost:${PORT}`);
  await bootstrap();
});

const shutdown = async (signal) => {
  console.log(`\n[customdb-backend] ${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
