require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const prisma = require('./prisma');

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  credentials: false,
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', message: err.message });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/databases', require('./routes/databases'));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

async function bootstrap() {
  const { ensureNetwork } = require('./services/dockerNetwork');
  const { syncFromDatabaseRows, reloadNginx } = require('./services/nginxManager');
  try {
    await ensureNetwork();
    const rows = await prisma.database.findMany({
      where: { status: { not: 'deleted' } },
      select: { port: true, type: true, routing: true, containerName: true },
    });
    const n = await syncFromDatabaseRows(rows);
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
