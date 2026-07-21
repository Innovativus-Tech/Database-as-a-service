// Admin-only API. Every route is behind requireAuth + requireAdmin (the role
// is re-checked in Postgres on each request, not trusted from the JWT).
//
// The /databases/* endpoints give the admin READ-ONLY visibility into any
// user's provisioned database — list them, browse schemas/collections, and
// page through actual stored rows/documents. They reuse the same data-browser
// helpers the owner-facing routes use, but via loadDatabaseWithUrl(null, id)
// which skips the ownership filter (allowed here because this whole router is
// gated behind requireAdmin). No create/update/delete is exposed to admin —
// this is a visibility panel, not a control panel.
const express = require('express');
const prisma = require('../prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const databasesRouter = require('./databases');
const {
  listMongoDatabasesWithPrimary,
  listMongoCollections,
  browseMongoCollection,
  listPostgresSchemas,
  listPostgresTables,
  browsePostgresTable,
} = require('../services/dataBrowser');

const { loadDatabaseWithUrl, resolveSchema, publicShape } = databasesRouter;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = express.Router();

router.use(requireAuth, requireAdmin);

function validIdOr404(req, res) {
  if (!UUID_RE.test(req.params.id || '')) {
    res.status(404).json({ error: 'Database not found' });
    return false;
  }
  return true;
}

// GET /api/admin/stats — platform-wide counters for the admin dashboard.
router.get('/stats', async (req, res, next) => {
  try {
    const [userCount, dbs, sessionCount] = await Promise.all([
      prisma.user.count(),
      prisma.database.findMany({
        where: { status: { not: 'deleted' } },
        select: { status: true, type: true, storageUsed: true },
      }),
      prisma.session.count({ where: { revokedAt: null } }),
    ]);
    res.json({
      users: userCount,
      activeSessions: sessionCount,
      databases: {
        total: dbs.length,
        active: dbs.filter((d) => d.status === 'active').length,
        sql: dbs.filter((d) => d.type === 'sql').length,
        nosql: dbs.filter((d) => d.type === 'nosql').length,
      },
      storageUsed: dbs.reduce((acc, d) => acc + Number(d.storageUsed), 0),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/users — all users with database counts, newest first.
router.get('/users', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        plan: true,
        fullName: true,
        organizationName: true,
        googleId: true,
        twoFactorEnabled: true,
        createdAt: true,
        _count: { select: { databases: { where: { status: { not: 'deleted' } } } } },
      },
    });
    res.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        plan: u.plan,
        fullName: u.fullName,
        organizationName: u.organizationName,
        googleLinked: Boolean(u.googleId),
        twoFactorEnabled: u.twoFactorEnabled,
        createdAt: u.createdAt,
        databaseCount: u._count.databases,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/databases — every provisioned database across all users, with
// its owner attached. Optional ?userId= filter to scope to one account.
router.get('/databases', async (req, res, next) => {
  try {
    const where = { status: { not: 'deleted' } };
    if (typeof req.query.userId === 'string' && UUID_RE.test(req.query.userId)) {
      where.userId = req.query.userId;
    }
    const dbs = await prisma.database.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, email: true, fullName: true, organizationName: true } } },
    });
    res.json({
      databases: dbs.map((d) => ({
        ...publicShape(d),
        owner: {
          id: d.user.id,
          email: d.user.email,
          fullName: d.user.fullName,
          organizationName: d.user.organizationName,
        },
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/databases/:id/schemas — Mongo databases / Postgres schemas.
router.get('/databases/:id/schemas', async (req, res) => {
  if (!validIdOr404(req, res)) return;
  try {
    const loaded = await loadDatabaseWithUrl(null, req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Database not found or not active' });
    const { db, internalUrl } = loaded;

    const schemas = db.type === 'nosql'
      ? await listMongoDatabasesWithPrimary(internalUrl, db.dbName)
      : await listPostgresSchemas(internalUrl);

    res.json({ schemas, type: db.type, primary: db.type === 'nosql' ? db.dbName : 'public' });
  } catch (err) {
    console.error('[admin/databases/:id/schemas]', err.code || err.name, err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to list schemas' });
  }
});

// GET /api/admin/databases/:id/collections?schema= — collections / tables.
router.get('/databases/:id/collections', async (req, res) => {
  if (!validIdOr404(req, res)) return;
  try {
    const loaded = await loadDatabaseWithUrl(null, req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Database not found or not active' });
    const { db, internalUrl } = loaded;
    const schema = resolveSchema(req, db);

    const collections = db.type === 'nosql'
      ? await listMongoCollections(internalUrl, schema)
      : await listPostgresTables({ connectionUrl: internalUrl, schema });

    res.json({ collections, type: db.type, schema });
  } catch (err) {
    console.error('[admin/databases/:id/collections]', err.code || err.name, err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to list collections' });
  }
});

// GET /api/admin/databases/:id/collections/:name?schema=&skip=&limit=&filter=
// Read-only paging through the actual stored documents/rows.
router.get('/databases/:id/collections/:name', async (req, res) => {
  if (!validIdOr404(req, res)) return;
  try {
    const loaded = await loadDatabaseWithUrl(null, req.params.id);
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
    console.error('[admin/databases/:id/collections/:name]', err.code || err.name, err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to browse collection' });
  }
});

module.exports = router;
