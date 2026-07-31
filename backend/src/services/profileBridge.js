// Profile bridge — the single edge that joins the two merged halves.
//
// CustomDB authenticates a `User`. The ported PivotDB engine scopes every
// Connection, migration, CDC sync, backup, alert and saved query to a
// `Profile`. This module guarantees that every authenticated user has exactly
// one Profile of their own, created on first use.
//
// The concept is deliberately invisible in the product: a user signs up once
// in the dashboard and every PivotDB feature is already theirs. There is no
// second login, no workspace picker, no "create a profile" step.
//
// Teammates invited into someone else's workspace get `user.profileId` set to
// that Profile without owning it (`Profile.ownerUserId` stays pointed at the
// owner), which is how `profileRole: 'viewer'` read-only members work.

const prisma = require('../prisma');
const { cache } = require('./cache');

const PROFILE_CACHE_TTL_MS = 60_000;

function profileNameFor(user) {
  return user.organizationName || user.fullName || user.displayName || user.email;
}

/**
 * Resolve the Profile id for a user, creating it on first call.
 *
 * Concurrency: two simultaneous requests from a brand-new user would both see
 * `profileId === null` and both try to create. `Profile.ownerUserId` is UNIQUE,
 * so the loser's INSERT fails and we simply re-read the winner's row.
 *
 * @param {string} userId
 * @returns {Promise<string>} the profile id
 */
async function ensureProfileForUser(userId) {
  return cache.getOrLoad(`profile-of:${userId}`, PROFILE_CACHE_TTL_MS, async () => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, fullName: true, displayName: true,
        organizationName: true, profileId: true,
      },
    });
    if (!user) throw new Error('User not found');
    if (user.profileId) return user.profileId;

    // Already owns one but the denormalised pointer is missing (possible for
    // rows written by the data import) — repair rather than create a second.
    const owned = await prisma.profile.findUnique({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (owned) {
      await prisma.user.update({ where: { id: userId }, data: { profileId: owned.id } });
      return owned.id;
    }

    try {
      const profile = await prisma.profile.create({
        data: { name: profileNameFor(user), ownerUserId: userId },
        select: { id: true },
      });
      await prisma.user.update({ where: { id: userId }, data: { profileId: profile.id } });
      return profile.id;
    } catch (err) {
      // Lost the create race (unique violation on ownerUserId) — read the winner.
      const winner = await prisma.profile.findUnique({
        where: { ownerUserId: userId },
        select: { id: true },
      });
      if (winner) {
        await prisma.user.update({ where: { id: userId }, data: { profileId: winner.id } });
        return winner.id;
      }
      throw err;
    }
  });
}

function invalidateProfileCache(userId) {
  cache.invalidate(`profile-of:${userId}`);
}

/**
 * Express middleware: attaches `req.profileId` for the authenticated user.
 * Mount AFTER requireAuth on every route that touches PivotDB models.
 */
async function attachProfile(req, res, next) {
  try {
    req.profileId = await ensureProfileForUser(req.user.id);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * The Prisma `where` fragment that scopes a query to the caller's workspace.
 *
 * Platform admins (`role === 'admin'`) intentionally get an UNSCOPED view so
 * the existing /api/admin surface can inspect any tenant — mirroring how
 * PivotDB's `superadmin` role behaved.
 */
function profileScope(req) {
  if (req.user?.role === 'admin' && req.query?.allTenants === 'true') return {};
  return { profileId: req.profileId };
}

/** Read-only members may not mutate. Returns true if the request may proceed. */
function requireWriteAccess(req, res) {
  if (req.user?.profileRole === 'viewer') {
    res.status(403).json({ error: 'Your account has read-only access to this workspace' });
    return false;
  }
  return true;
}

module.exports = {
  ensureProfileForUser,
  invalidateProfileCache,
  attachProfile,
  profileScope,
  requireWriteAccess,
};
