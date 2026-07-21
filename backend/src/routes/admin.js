// Admin-only API. Every route is behind requireAuth + requireAdmin (the role
// is re-checked in Postgres on each request, not trusted from the JWT).
const express = require('express');
const prisma = require('../prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireAdmin);

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

module.exports = router;
