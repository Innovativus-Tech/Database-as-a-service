// Audit log for the Operate console.
//
// PivotDB served this inline from its server bootstrap rather than a route
// module, so it had no file to port — this is that endpoint rebuilt against
// the merged model.
//
// The important difference: PivotDB returned every audit event to any signed-in
// user. Here the log is scoped to the caller's own workspace, so one tenant
// can't read another's activity. Platform admins can opt into the unscoped
// view with ?allTenants=true, matching the rest of the admin surface.

const express = require('express');
const prisma = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { attachProfile } = require('../services/profileBridge');

const router = express.Router();

router.get('/audit', requireAuth, attachProfile, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const skip = (page - 1) * pageSize;

    const where = {};
    if (req.query.action) where.action = String(req.query.action);
    if (req.query.actor) where.actor = String(req.query.actor);

    // AuditEvent has no profileId column — it records `actor` (an email or
    // user id). Scope by the workspace's members so the log stays tenant-safe
    // without a schema change that would strand existing PivotDB rows.
    const isPlatformAdmin = req.user.role === 'admin' && req.query.allTenants === 'true';
    if (!isPlatformAdmin) {
      const members = await prisma.user.findMany({
        where: { profileId: req.profileId },
        select: { id: true, email: true },
      });
      const actors = members.flatMap((m) => [m.id, m.email]);
      where.actor = where.actor && actors.includes(where.actor)
        ? where.actor
        : { in: actors };
    }

    const [events, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.auditEvent.count({ where }),
    ]);

    res.json({ events, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
