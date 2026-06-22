require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const prisma = require('./prisma');

const app = express();
app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  credentials: false,
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

// Root path — answer 200 OK so Coolify-Traefik's default healthcheck doesn't
// mark the container unhealthy (it probes / by default and 404 = drop the route).
app.get('/', (req, res) => {
  res.json({ service: 'customdb-backend', status: 'ok' });
});

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

    // Dockerode-created DB containers live outside Coolify's compose lifecycle
    // (only the 4 compose-declared services are tracked), so they don't come
    // back on their own after a host reboot or stack rebuild. Reconcile every
    // active DB's container on every boot.
    for (const db of rows) {
      if (db.status !== 'active') continue;
      try {
        const cred = db.credentials[0];
        if (!cred) continue;
        const password = decrypt(cred.passwordEncrypted);
        const action = await ensureContainerRunning({ db, username: cred.username, password });
        if (action !== 'running') console.log(`[bootstrap] ${db.dbName}: container ${action}`);
      } catch (err) {
        console.error(`[bootstrap] failed to reconcile ${db.dbName}:`, err.message);
      }
    }

    const n = await syncFromDatabaseRows(rows.map((r) => ({
      port: r.port, type: r.type, routing: r.routing, containerName: r.containerName,
    })));
    if (n > 0) await reloadNginx();
    console.log(`[bootstrap] synced ${n} nginx stream blocks`);
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
