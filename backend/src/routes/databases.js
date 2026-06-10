const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const multer = require('multer');
const prisma = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { getNextAvailablePort } = require('../services/portManager');
const { generateConnectionURL } = require('../services/urlGenerator');
const { encrypt, decrypt, randomToken } = require('../services/crypto');
const {
  createMongoContainer,
  createPostgresContainer,
  stopAndRemoveContainer,
  inspectContainer,
  getDirectorySize,
  removeDataDir,
  deriveNames,
} = require('../services/provisioning');
const { dispatchImport } = require('../services/dataImport');
const { addStreamBlock, removeStreamBlock, reloadNginx } = require('../services/nginxManager');
const {
  listMongoCollections,
  browseMongoCollection,
  listPostgresTables,
  browsePostgresTable,
} = require('../services/dataBrowser');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `cdb-upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

const router = express.Router();

const DB_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{2,39}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Guard for routes with :id — bail with 404 (don't reveal whether row exists)
// before Prisma gets a malformed UUID and throws.
function validIdOr404(req, res) {
  if (!UUID_RE.test(req.params.id || '')) {
    res.status(404).json({ error: 'Database not found' });
    return false;
  }
  return true;
}

function validateCreateBody(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const type = body?.type;
  if (!DB_NAME_RE.test(name)) {
    return { error: 'name must be 3-40 chars, start with a letter, and contain only letters/numbers/_/-' };
  }
  if (type !== 'nosql' && type !== 'sql') {
    return { error: 'type must be "nosql" or "sql"' };
  }
  return { name, type };
}

function publicShape(db) {
  return {
    id: db.id,
    name: db.dbName,
    type: db.type,
    host: db.host,
    port: db.port,
    status: db.status,
    storageUsed: Number(db.storageUsed),
    createdAt: db.createdAt,
    lastConnectedAt: db.lastConnectedAt,
  };
}

// For DBs created before the per-user naming change, containerName is null;
// fall back to the legacy derivation that uses only dbName.
function resolveNames(db) {
  if (db.containerName) {
    return deriveNames({ type: db.type, dbName: db.dbName, userId: db.userId });
  }
  return deriveNames({ type: db.type, dbName: db.dbName });
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/databases/create
// ──────────────────────────────────────────────────────────────────────────────
router.post('/create', requireAuth, async (req, res, next) => {
  const { error, name, type } = validateCreateBody(req.body);
  if (error) return res.status(400).json({ error });

  const existing = await prisma.database.findUnique({
    where: { userId_dbName: { userId: req.user.id, dbName: name } },
  });
  if (existing && existing.status !== 'deleted') {
    return res.status(409).json({ error: 'You already have a database with that name' });
  }

  const port = await getNextAvailablePort(type);
  const username = `cdb_${randomToken(6)}`;
  const password = randomToken(24);
  const host = process.env.VPS_HOST || 'localhost';
  const routing = 'nginx';
  const { containerName } = deriveNames({ type, dbName: name, userId: req.user.id });

  let database;
  try {
    database = await prisma.database.create({
      data: {
        userId: req.user.id,
        dbName: name,
        type,
        port,
        host,
        status: 'provisioning',
        containerName,
        routing,
        credentials: {
          create: { username, passwordEncrypted: encrypt(password) },
        },
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Port or name conflict, please retry' });
    }
    return next(err);
  }

  try {
    const fn = type === 'nosql' ? createMongoContainer : createPostgresContainer;
    await fn({ userId: req.user.id, dbName: name, port, username, password, routing });

    // Add nginx stream block + reload, so clients can reach the new container.
    const internalPort = type === 'nosql' ? 27017 : 5432;
    await addStreamBlock({ port, containerName, internalPort });
    await reloadNginx();

    const updated = await prisma.database.update({
      where: { id: database.id },
      data: { status: 'active' },
    });

    const connectionUrl = generateConnectionURL(type, { host, port, username, password, dbName: name });

    res.status(201).json({
      database: publicShape(updated),
      credentials: { username, password },
      connectionUrl,
    });
  } catch (err) {
    console.error('[databases/create] provisioning failed, rolling back:', err.message);
    try { await stopAndRemoveContainer(containerName); } catch (e) { console.error('cleanup:', e.message); }
    try { await removeStreamBlock(port); await reloadNginx(); } catch (e) { /* best-effort */ }
    await prisma.database.delete({ where: { id: database.id } }).catch(() => {});
    return res.status(500).json({ error: 'Failed to provision container', detail: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/databases  — list user's databases (no connection URL)
// ──────────────────────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const dbs = await prisma.database.findMany({
      where: { userId: req.user.id, status: { not: 'deleted' } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ databases: dbs.map(publicShape) });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/databases/:id  — details + decrypted connection URL
// ──────────────────────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res, next) => {
  if (!validIdOr404(req, res)) return;
  try {
    const db = await prisma.database.findFirst({
      where: { id: req.params.id, userId: req.user.id, status: { not: 'deleted' } },
      include: { credentials: true },
    });
    if (!db) return res.status(404).json({ error: 'Database not found' });

    const cred = db.credentials[0];
    const password = decrypt(cred.passwordEncrypted);
    const connectionUrl = generateConnectionURL(db.type, {
      host: db.host,
      port: db.port,
      username: cred.username,
      password,
      dbName: db.dbName,
    });

    res.json({
      database: publicShape(db),
      credentials: { username: cred.username, password },
      connectionUrl,
    });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/databases/:id/stats  — container state + disk usage
// ──────────────────────────────────────────────────────────────────────────────
router.get('/:id/stats', requireAuth, async (req, res, next) => {
  if (!validIdOr404(req, res)) return;
  try {
    const db = await prisma.database.findFirst({
      where: { id: req.params.id, userId: req.user.id, status: { not: 'deleted' } },
    });
    if (!db) return res.status(404).json({ error: 'Database not found' });

    const { containerName, dataDir } = resolveNames(db);
    const inspect = await inspectContainer(containerName);
    const storageBytes = await getDirectorySize(dataDir);

    await prisma.database.update({
      where: { id: db.id },
      data: { storageUsed: BigInt(storageBytes) },
    });

    res.json({
      id: db.id,
      name: db.dbName,
      port: db.port,
      status: db.status,
      container: inspect ? {
        state: inspect.State.Status,
        startedAt: inspect.State.StartedAt,
        running: inspect.State.Running,
        restartCount: inspect.RestartCount,
      } : null,
      storage: {
        bytes: storageBytes,
        human: humanBytes(storageBytes),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Helper: load DB with creds, build connection URL — used by browse routes.
async function loadDatabaseWithUrl(userId, id) {
  const db = await prisma.database.findFirst({
    where: { id, userId, status: 'active' },
    include: { credentials: true },
  });
  if (!db) return null;
  const cred = db.credentials[0];
  const password = decrypt(cred.passwordEncrypted);
  const connectionUrl = generateConnectionURL(db.type, {
    host: db.host, port: db.port, username: cred.username, password, dbName: db.dbName,
  });
  return { db, connectionUrl };
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/databases/:id/collections  — list collections / tables
// ──────────────────────────────────────────────────────────────────────────────
router.get('/:id/collections', requireAuth, async (req, res, next) => {
  if (!validIdOr404(req, res)) return;
  try {
    const loaded = await loadDatabaseWithUrl(req.user.id, req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Database not found or not active' });
    const { db, connectionUrl } = loaded;

    const collections = db.type === 'nosql'
      ? await listMongoCollections(connectionUrl, db.dbName)
      : await listPostgresTables(connectionUrl);

    res.json({ collections, type: db.type });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to list collections' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/databases/:id/collections/:name?skip=&limit=&filter=
//   filter (mongo only) is a URI-encoded JSON object: ?filter=%7B%22age%22%3A30%7D
// ──────────────────────────────────────────────────────────────────────────────
router.get('/:id/collections/:name', requireAuth, async (req, res, next) => {
  if (!validIdOr404(req, res)) return;
  try {
    const loaded = await loadDatabaseWithUrl(req.user.id, req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Database not found or not active' });
    const { db, connectionUrl } = loaded;
    const collection = req.params.name;
    const skip = Math.max(0, parseInt(req.query.skip || '0', 10) || 0);
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '50', 10) || 50));

    if (db.type === 'nosql') {
      let filter = {};
      if (req.query.filter) {
        try { filter = JSON.parse(req.query.filter); }
        catch { return res.status(400).json({ error: 'filter must be valid JSON' }); }
      }
      const result = await browseMongoCollection({
        connectionUrl, dbName: db.dbName, collection, skip, limit, filter,
      });
      return res.json({ name: collection, type: 'nosql', ...result });
    }

    const result = await browsePostgresTable({ connectionUrl, table: collection, skip, limit });
    res.json({ name: collection, type: 'sql', ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to browse collection' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/databases/:id/import  — multipart file upload, dispatches by ext
//   .json  → mongo insertMany
//   .csv   → mongo insertMany or pg auto-table
//   .zip   → mongorestore
//   .sql   → psql
// Query: ?target=name (collection or table). Defaults to filename stem.
// ──────────────────────────────────────────────────────────────────────────────
router.post('/:id/import', requireAuth, upload.single('file'), async (req, res, next) => {
  if (!validIdOr404(req, res)) {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
    return;
  }
  if (!req.file) return res.status(400).json({ error: 'Missing file (field name: "file")' });

  try {
    const db = await prisma.database.findFirst({
      where: { id: req.params.id, userId: req.user.id, status: 'active' },
      include: { credentials: true },
    });
    if (!db) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: 'Database not found or not active' });
    }

    const cred = db.credentials[0];
    const password = decrypt(cred.passwordEncrypted);
    const connectionUrl = generateConnectionURL(db.type, {
      host: db.host,
      port: db.port,
      username: cred.username,
      password,
      dbName: db.dbName,
    });
    const { containerName } = resolveNames(db);

    const result = await dispatchImport({
      db,
      credentials: { username: cred.username, password },
      connectionUrl,
      containerName,
      file: req.file,
      queryTarget: typeof req.query.target === 'string' ? req.query.target : undefined,
    });

    res.json({ ok: true, file: req.file.originalname, ...result });
  } catch (err) {
    const status = err.status || 500;
    console.error('[databases/:id/import]', err);
    res.status(status).json({ error: err.message || 'Import failed' });
  } finally {
    if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/databases/:id  — stop + remove container, drop data, delete row
// ──────────────────────────────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res, next) => {
  if (!validIdOr404(req, res)) return;
  try {
    const db = await prisma.database.findFirst({
      where: { id: req.params.id, userId: req.user.id, status: { not: 'deleted' } },
    });
    if (!db) return res.status(404).json({ error: 'Database not found' });

    const { containerName, dataDir } = resolveNames(db);

    try { await stopAndRemoveContainer(containerName); }
    catch (e) { console.error('[delete] container teardown:', e.message); }

    try { await removeDataDir(dataDir); }
    catch (e) { console.error('[delete] data dir cleanup:', e.message); }

    if (db.routing === 'nginx') {
      try { await removeStreamBlock(db.port); await reloadNginx(); }
      catch (e) { console.error('[delete] nginx cleanup:', e.message); }
    }

    // Cascade removes credentials too.
    await prisma.database.delete({ where: { id: db.id } });

    res.json({ ok: true, deleted: { id: db.id, name: db.dbName } });
  } catch (err) {
    next(err);
  }
});

function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  for (const u of units) {
    if (v < 1024) return `${v.toFixed(1)} ${u}`;
    v /= 1024;
  }
  return `${v.toFixed(1)} PB`;
}

module.exports = router;
