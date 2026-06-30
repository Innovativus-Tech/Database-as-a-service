require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const prisma = require('./prisma');

const app = express();
app.set('trust proxy', 1);

// CORS — accept the configured frontend origin AND respond to preflight
// OPTIONS for any path with proper headers. The previous strict-origin config
// was rejecting browsers silently when FRONTEND_ORIGIN env var was missing
// or didn't exactly match the requested origin. Reflecting the request
// origin lets the SDK and the dashboard both work without coordination.
//
// `credentials: false` is correct for JWT-in-Authorization-header auth.
// We don't use cookies, so we don't need credentials mode.
const corsOptions = {
  origin: (origin, cb) => {
    // Always allow requests with no Origin header (server-to-server, curl).
    if (!origin) return cb(null, true);
    // Allow the configured frontend origin if set...
    if (process.env.FRONTEND_ORIGIN && origin === process.env.FRONTEND_ORIGIN) return cb(null, true);
    // ...and reflect any HTTPS origin under the same root domain. This
    // covers staging subdomains, the dashboard, and customer-app origins
    // calling the cache-config endpoint without us hard-coding each one.
    if (/^https:\/\/[a-z0-9.-]+$/i.test(origin)) return cb(null, true);
    // Localhost for dev.
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600, // browsers cache preflight result for 10 min, reducing OPTIONS hits
};
app.use(cors(corsOptions));
// Explicit preflight handler — some Express/cors versions require this
// to short-circuit OPTIONS before any other middleware runs. Even if the
// implicit cors() middleware also handles it, having this here is
// belt-and-suspenders for the login path.
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '1mb' }));
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

app.use('/api/auth', require('./routes/auth').router);
app.use('/api/databases', require('./routes/databases'));
app.use('/api', require('./routes/cacheConfig'));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

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
