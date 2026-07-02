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
  ensureContainerRunning,
  resolveNames,
  getDirectorySize,
  removeDataDir,
  removeInitScript,
  deriveNames,
} = require('../services/provisioning');
const { runImport } = require('../services/importRunner');
const { cache } = require('../services/cache');
const { createJob: createImportJob, getJob: getImportJob, updateJob: updateImportJob, scheduleCleanup: scheduleImportJobCleanup } = require('../services/importJobs');
const { FREE_DB_LIMIT } = require('./auth');
const { addStreamBlock, removeStreamBlock, reloadNginx } = require('../services/nginxManager');
const {
  listMongoDatabases,
  createMongoDatabase,
  dropMongoDatabase,
  listMongoCollections,
  browseMongoCollection,
  updateMongoDocument,
  deleteMongoDocument,
  createMongoCollection,
  dropMongoCollection,
  listPostgresSchemas,
  createPostgresSchema,
  dropPostgresSchema,
  listPostgresTables,
  browsePostgresTable,
  updatePostgresRow,
  deletePostgresRow,
  createPostgresTable,
  dropPostgresTable,
  evictPoolsForHost,
  PG_COLUMN_TYPES,
} = require('../services/dataBrowser');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `cdb-upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

// Multer errors (oversized file, wrong field name) should read as client
// errors, not opaque 500s from the generic handler.
function uploadSingleFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large — imports are limited to 200 MB' });
      }
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    next();
  });
}

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
    tlsEnabled: !!db.tlsEnabled,
    createdAt: db.createdAt,
    lastConnectedAt: db.lastConnectedAt,
  };
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

  const ownedCount = await prisma.database.count({
    where: { userId: req.user.id, status: { not: 'deleted' } },
  });
  if (ownedCount >= FREE_DB_LIMIT) {
    return res.status(403).json({ error: `Free tier is limited to ${FREE_DB_LIMIT} databases. Delete one first.` });
  }

  const port = await getNextAvailablePort(type);
  const username = `cdb_${randomToken(6)}`;
  const password = randomToken(24);
  const host = process.env.VPS_HOST || 'localhost';
  const routing = 'nginx';
  const { containerName } = deriveNames({ type, dbName: name, userId: req.user.id });

  // Both engines now ship with TLS by default. Mongo terminates at nginx
  // (immediate TLS handshake on the wire); Postgres terminates inside its
  // own container (handles its STARTTLS-style upgrade dance natively).
  // Declared outside the try blocks so both the prisma.create and the
  // subsequent provisioning step (which run in separate try/catch scopes)
  // can see it.
  const tlsEnabled = true;

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
        tlsEnabled,
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
    await addStreamBlock({ port, containerName, internalPort, tlsEnabled, type });
    await reloadNginx();

    const updated = await prisma.database.update({
      where: { id: database.id },
      data: { status: 'active' },
    });

    const connectionUrl = generateConnectionURL(type, { host, port, username, password, dbName: name, tls: tlsEnabled });

    res.status(201).json({
      database: publicShape(updated),
      credentials: { username, password },
      connectionUrl,
    });
  } catch (err) {
    console.error('[databases/create] provisioning failed, rolling back:', err.message);
    try { await stopAndRemoveContainer(containerName); } catch (e) { console.error('cleanup:', e.message); }
    try { await removeInitScript(containerName); } catch (e) { /* best-effort */ }
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
// GET /api/databases/columnTypes — allowed Postgres column types for the create-table form
// Registered before /:id so "columnTypes" isn't swallowed as a database id.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/columnTypes', requireAuth, (req, res) => {
  res.json({ types: [...PG_COLUMN_TYPES] });
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
      tls: !!db.tlsEnabled,
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

    // The disk walk is by far the most expensive thing per request — for a
    // multi-GB Mongo data dir it can take seconds and the result barely
    // changes minute-to-minute. Cache it for 30s. Concurrent /stats calls
    // for the same database collapse to one walk (getOrLoad dedupes).
    const inspect = await cache.getOrLoad(
      `inspect:${containerName}`, 5_000,
      () => inspectContainer(containerName)
    );
    const storageBytes = await cache.getOrLoad(
      `storage:${db.id}`, 30_000,
      () => getDirectorySize(dataDir)
    );

    // Persist the freshly measured size — but only when we actually re-walked.
    // Throttling via the cache means we don't UPDATE Postgres every poll.
    if (Number(db.storageUsed) !== storageBytes) {
      prisma.database.update({
        where: { id: db.id },
        data: { storageUsed: BigInt(storageBytes) },
      }).catch(() => {});
    }

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

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/databases/:id/start  — bring the DB's container back up if it's
// stopped or was removed entirely (host reboot, manual `docker rm`, etc).
// ──────────────────────────────────────────────────────────────────────────────
router.post('/:id/start', requireAuth, async (req, res, next) => {
  if (!validIdOr404(req, res)) return;
  try {
    const db = await prisma.database.findFirst({
      where: { id: req.params.id, userId: req.user.id, status: 'active' },
      include: { credentials: true },
    });
    if (!db) return res.status(404).json({ error: 'Database not found or not active' });

    const cred = db.credentials[0];
    const password = decrypt(cred.passwordEncrypted);
    const action = await ensureContainerRunning({ db, username: cred.username, password });

    if (db.routing === 'nginx' && db.containerName) {
      const internalPort = db.type === 'nosql' ? 27017 : 5432;
      await addStreamBlock({ port: db.port, containerName: db.containerName, internalPort, tlsEnabled: !!db.tlsEnabled, type: db.type });
      await reloadNginx();
    }

    res.json({ ok: true, action });
  } catch (err) {
    console.error('[databases/:id/start]', err);
    res.status(500).json({ error: err.message || 'Failed to start container' });
  }
});

// Helper: load DB with creds, build BOTH a public connection URL (what we hand
// to the user, points at VPS_HOST:nginx-port) and an internal one (used by the
// backend's own MongoDB / PG drivers — they run inside the backend container
// and reach user DBs by container name on customdb-network).
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
    tls: !!db.tlsEnabled, // public URL → through nginx → TLS terminates at proxy
  });

  // For nginx-routed DBs we have the container name + the internal port (27017 / 5432).
  // For legacy direct-bind DBs containerName may be null; fall back to the public URL.
  // Internal hop is plaintext: it stays on the private customdb-network and
  // talks straight to the user-DB container, bypassing the nginx TLS layer.
  let internalUrl = connectionUrl;
  if (db.routing === 'nginx' && db.containerName) {
    const internalPort = db.type === 'nosql' ? 27017 : 5432;
    internalUrl = generateConnectionURL(db.type, {
      host: db.containerName,
      port: internalPort,
      username: cred.username,
      password,
      dbName: db.dbName,
      tls: false,
    });
  }

  return { db, connectionUrl, internalUrl, credentials: { username: cred.username, password } };
}

// The "schema" a request targets — a Mongo database name or a Postgres schema
// name. Defaults to this CustomDB database's own primary one (db.dbName for
// Mongo, "public" for Postgres) so every pre-existing call site that doesn't
// pass ?schema=/body.schema keeps working unchanged.
function resolveSchema(req, db) {
  const requested = typeof req.query.schema === 'string' ? req.query.schema
    : typeof req.body?.schema === 'string' ? req.body.schema
    : '';
  if (requested) return requested;
  return db.type === 'nosql' ? db.dbName : 'public';
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/databases/:id/schemas — list Mongo databases / Postgres schemas
//   available inside this one container.
// ──────────────────────────────────────────────────────────────────────────────
router.get('/:id/schemas', requireAuth, async (req, res) => {
  if (!validIdOr404(req, res)) return;
  try {
    const loaded = await loadDatabaseWithUrl(req.user.id, req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Database not found or not active' });
    const { db, internalUrl } = loaded;

    const schemas = db.type === 'nosql'
      ? await listMongoDatabases(internalUrl)
      : await listPostgresSchemas(internalUrl);

    res.json({ schemas, type: db.type, primary: db.type === 'nosql' ? db.dbName : 'public' });
  } catch (err) {
    console.error('[databases/:id/schemas]', err.code || err.name, err.message);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to list schemas' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/databases/:id/schemas — create a new Mongo database / Postgres schema
//   Mongo body: { name, firstCollection } — Mongo only materializes a database
//   once it has a real collection, so the first one is created in the same step.
//   Postgres body: { name } — CREATE SCHEMA, genuinely empty until you add tables.
// ──────────────────────────────────────────────────────────────────────────────
router.post('/:id/schemas', requireAuth, async (req, res) => {
  if (!validIdOr404(req, res)) return;
  try {
    const loaded = await loadDatabaseWithUrl(req.user.id, req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Database not found or not active' });
    const { db, internalUrl } = loaded;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!DB_NAME_RE.test(name)) {
      return res.status(400).json({ error: 'Name must be 3-40 chars, start with a letter, and contain only letters/numbers/_/-' });
    }

    if (db.type === 'nosql') {
      const firstCollection = typeof req.body?.firstCollection === 'string' ? req.body.firstCollection.trim() : '';
      if (!DB_NAME_RE.test(firstCollection)) {
        return res.status(400).json({ error: 'firstCollection must be 3-40 chars, start with a letter, and contain only letters/numbers/_/-' });
      }
      await createMongoDatabase(internalUrl, name, firstCollection);
    } else {
      await createPostgresSchema(internalUrl, name);
    }
    res.status(201).json({ ok: true, name });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to create schema' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/databases/:id/schemas/:name — drop an entire Mongo database /
//   Postgres schema, including everything inside it. Cannot drop the
//   database's own primary schema (Mongo: db.dbName, Postgres: "public").
// ──────────────────────────────────────────────────────────────────────────────
router.delete('/:id/schemas/:name', requireAuth, async (req, res) => {
  if (!validIdOr404(req, res)) return;
  try {
    const loaded = await loadDatabaseWithUrl(req.user.id, req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Database not found or not active' });
    const { db, internalUrl } = loaded;
    const name = req.params.name;
    const primary = db.type === 'nosql' ? db.dbName : 'public';
    if (name === primary) {
      return res.status(400).json({ error: `Can't drop the primary schema (${primary})` });
    }

    if (db.type === 'nosql') {
      await dropMongoDatabase(internalUrl, name);
    } else {
      await dropPostgresSchema(internalUrl, name);
    }
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to drop schema' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/databases/:id/collections?schema=  — list collections / tables
// ──────────────────────────────────────────────────────────────────────────────
router.get('/:id/collections', requireAuth, async (req, res, next) => {
  if (!validIdOr404(req, res)) return;
  try {
    const loaded = await loadDatabaseWithUrl(req.user.id, req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Database not found or not active' });
    const { db, internalUrl } = loaded;
    const schema = resolveSchema(req, db);

    const collections = db.type === 'nosql'
      ? await listMongoCollections(internalUrl, schema)
      : await listPostgresTables({ connectionUrl: internalUrl, schema });

    res.json({ collections, type: db.type, schema });
  } catch (err) {
    console.error('[databases/:id/collections]', err.code || err.name, err.message);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to list collections' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/databases/:id/collections — create an empty collection/table
//   Mongo body: { name, schema }
//   Postgres body: { name, schema, columns: [{ name, type }] }  (type from PG_COLUMN_TYPES)
// ──────────────────────────────────────────────────────────────────────────────
router.post('/:id/collections', requireAuth, async (req, res, next) => {
  if (!validIdOr404(req, res)) return;
  try {
    const loaded = await loadDatabaseWithUrl(req.user.id, req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Database not found or not active' });
    const { db, internalUrl } = loaded;
    const schema = resolveSchema(req, db);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!DB_NAME_RE.test(name)) {
      return res.status(400).json({ error: 'Name must be 3-40 chars, start with a letter, and contain only letters/numbers/_/-' });
    }

    if (db.type === 'nosql') {
      await createMongoCollection(internalUrl, schema, name);
    } else {
      await createPostgresTable({ connectionUrl: internalUrl, schema, table: name, columns: req.body?.columns });
    }
    res.status(201).json({ ok: true, name });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to create collection' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/databases/:id/collections/:name?schema= — drop an entire collection/table
// ──────────────────────────────────────────────────────────────────────────────
router.delete('/:id/collections/:name', requireAuth, async (req, res, next) => {
  if (!validIdOr404(req, res)) return;
  try {
    const loaded = await loadDatabaseWithUrl(req.user.id, req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Database not found or not active' });
    const { db, internalUrl } = loaded;
    const schema = resolveSchema(req, db);
    const collection = req.params.name;

    if (db.type === 'nosql') {
      await dropMongoCollection(internalUrl, schema, collection);
    } else {
      await dropPostgresTable({ connectionUrl: internalUrl, schema, table: collection });
    }
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to drop collection' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/databases/:id/collections/:name?schema=&skip=&limit=&filter=
//   filter (mongo only) is a URI-encoded JSON object: ?filter=%7B%22age%22%3A30%7D
// ──────────────────────────────────────────────────────────────────────────────
router.get('/:id/collections/:name', requireAuth, async (req, res, next) => {
  if (!validIdOr404(req, res)) return;
  try {
    const loaded = await loadDatabaseWithUrl(req.user.id, req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Database not found or not active' });
    const { db, internalUrl } = loaded;
    const schema = resolveSchema(req, db);
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
        connectionUrl: internalUrl, dbName: schema, collection, skip, limit, filter,
      });
      return res.json({ name: collection, type: 'nosql', ...result });
    }

    const result = await browsePostgresTable({ connectionUrl: internalUrl, schema, table: collection, skip, limit });
    res.json({ name: collection, type: 'sql', ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to browse collection' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT/DELETE /api/databases/:id/collections/:name/:docId?schema=
//   Mongo: :docId is the document's _id (hex ObjectId or raw string).
//   Postgres: :docId is the row's `ctid` (returned as __ctid by the browse
//   endpoint) — most imported tables have no declared primary key.
// ──────────────────────────────────────────────────────────────────────────────
router.put('/:id/collections/:name/:docId', requireAuth, async (req, res, next) => {
  if (!validIdOr404(req, res)) return;
  try {
    const loaded = await loadDatabaseWithUrl(req.user.id, req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Database not found or not active' });
    const { db, internalUrl } = loaded;
    const schema = resolveSchema(req, db);
    const collection = req.params.name;

    if (db.type === 'nosql') {
      if (typeof req.body !== 'object' || req.body === null) {
        return res.status(400).json({ error: 'Body must be a JSON object' });
      }
      await updateMongoDocument({
        connectionUrl: internalUrl, dbName: schema, collection, id: req.params.docId, doc: req.body,
      });
    } else {
      const values = req.body?.values;
      if (!values || typeof values !== 'object') {
        return res.status(400).json({ error: 'Body must be { values: { col: val, ... } }' });
      }
      await updatePostgresRow({ connectionUrl: internalUrl, schema, table: collection, ctid: req.params.docId, values });
    }
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to update document' });
  }
});

router.delete('/:id/collections/:name/:docId', requireAuth, async (req, res, next) => {
  if (!validIdOr404(req, res)) return;
  try {
    const loaded = await loadDatabaseWithUrl(req.user.id, req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Database not found or not active' });
    const { db, internalUrl } = loaded;
    const schema = resolveSchema(req, db);
    const collection = req.params.name;

    if (db.type === 'nosql') {
      await deleteMongoDocument({ connectionUrl: internalUrl, dbName: schema, collection, id: req.params.docId });
    } else {
      await deletePostgresRow({ connectionUrl: internalUrl, schema, table: collection, ctid: req.params.docId });
    }
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to delete document' });
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
// Starts the import in the background and returns a jobId immediately —
// the dashboard polls /:id/import/:jobId/status for real progress instead of
// blocking on one long request (imports of large files can take minutes).
router.post('/:id/import', requireAuth, uploadSingleFile, async (req, res, next) => {
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
    const { containerName } = resolveNames(db);

    // For JSON/CSV imports the backend's own driver does the insertMany — it
    // must reach the user DB via internal Docker DNS (container name on the
    // customdb-network), not the public URL which doesn't route from inside.
    // .zip and .sql imports use docker exec, so they don't need a network URL.
    // Internal hop is always plaintext (skips the nginx TLS layer); only the
    // public path through the proxy needs TLS for new (tlsEnabled) DBs.
    let connectionUrl;
    if (db.routing === 'nginx' && db.containerName) {
      const internalPort = db.type === 'nosql' ? 27017 : 5432;
      connectionUrl = generateConnectionURL(db.type, {
        host: db.containerName, port: internalPort,
        username: cred.username, password, dbName: db.dbName,
        tls: false,
      });
    } else {
      connectionUrl = generateConnectionURL(db.type, {
        host: db.host, port: db.port,
        username: cred.username, password, dbName: db.dbName,
        tls: !!db.tlsEnabled,
      });
    }

    const jobId = createImportJob();
    const file = req.file;
    const queryTarget = typeof req.query.target === 'string' ? req.query.target : undefined;

    // Deliberately not awaited — this runs after the response is sent.
    // The import executes in a worker thread (see importRunner/importWorker):
    // parsing a 200 MB upload is CPU-bound, and on the main thread it froze
    // the event loop, failed the /healthz healthcheck, and got the container
    // restarted mid-import — which is what made big imports "stick" and
    // kicked users to the login page. workerData is structured-cloned, so
    // only plain serializable fields go across.
    runImport(
      {
        db: { type: db.type, dbName: db.dbName },
        credentials: { username: cred.username, password },
        connectionUrl,
        containerName,
        file: { originalname: file.originalname, path: file.path },
        queryTarget,
      },
      (processed, total) => updateImportJob(jobId, { processed, total })
    )
      .then((result) => {
        updateImportJob(jobId, { status: 'done', result: { file: file.originalname, ...result } });
      })
      .catch((err) => {
        console.error('[databases/:id/import]', err);
        updateImportJob(jobId, { status: 'error', error: err.message || 'Import failed' });
      })
      .finally(() => {
        fs.promises.unlink(file.path).catch(() => {});
        scheduleImportJobCleanup(jobId);
      });

    res.status(202).json({ ok: true, jobId });
  } catch (err) {
    if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
    next(err);
  }
});

router.get('/:id/import/:jobId/status', requireAuth, async (req, res) => {
  if (!validIdOr404(req, res)) return;
  const job = getImportJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Import job not found or expired' });
  res.json({
    status: job.status,
    processed: job.processed,
    total: job.total,
    elapsedMs: Date.now() - job.startedAt,
    result: job.status === 'done' ? job.result : undefined,
    error: job.status === 'error' ? job.error : undefined,
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/databases/:id  — stop + remove container, drop data, delete row.
//
// IMPORTANT: this responds to the client BEFORE the teardown finishes. A
// multi-GB Mongo data dir can take 30+ seconds to fs.rm, and that walk used
// to block the response, which had three nasty side effects:
//   1. The dashboard's auto-refresh queries timed out, looked like 401,
//      bounced the user to /login.
//   2. fs.rm ate every libuv worker thread, queueing bcrypt.compare from
//      the next login behind it — login itself then took forever to return.
//   3. Disk I/O contention dragged the meta-DB Postgres down too.
//
// The fix here is two-fold: mark the row as deleted immediately (so it
// disappears from the user's list), respond, THEN do the slow teardown.
// We also bump UV_THREADPOOL_SIZE in docker-compose so even if a teardown
// IS using fs threads, login's bcrypt has plenty of capacity left.
// ──────────────────────────────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res, next) => {
  if (!validIdOr404(req, res)) return;
  try {
    const db = await prisma.database.findFirst({
      where: { id: req.params.id, userId: req.user.id, status: { not: 'deleted' } },
    });
    if (!db) return res.status(404).json({ error: 'Database not found' });

    const { containerName, dataDir } = resolveNames(db);

    // Cascade removes credentials too. Doing this FIRST means the row is
    // gone from the user's POV before the slow disk work even starts.
    await prisma.database.delete({ where: { id: db.id } });
    cache.invalidate(`inspect:${containerName}`);
    cache.invalidate(`storage:${db.id}`);
    cache.invalidate(`acl-provisioned:${db.id}`);
    // Drop any pooled MongoClient/PgClient pointing at this now-dead container
    // so background reconnect attempts don't keep retrying forever.
    if (db.containerName) evictPoolsForHost(db.containerName).catch(() => {});

    res.json({ ok: true, deleted: { id: db.id, name: db.dbName } });

    // Now do the actual filesystem + container teardown in the background.
    // setImmediate yields to the event loop so the response flushes first.
    // Errors only get logged — the user has already moved on.
    setImmediate(async () => {
      try {
        await stopAndRemoveContainer(containerName);
      } catch (e) { console.error('[delete:bg] container teardown:', e.message); }
      try {
        await removeDataDir(dataDir);
      } catch (e) { console.error('[delete:bg] data dir cleanup:', e.message); }
      try {
        await removeInitScript(containerName);
      } catch (e) { console.error('[delete:bg] init script cleanup:', e.message); }
      if (db.routing === 'nginx') {
        try { await removeStreamBlock(db.port); await reloadNginx(); }
        catch (e) { console.error('[delete:bg] nginx cleanup:', e.message); }
      }
      console.log(`[delete:bg] finished teardown of ${db.dbName} (${db.id})`);
    });
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
