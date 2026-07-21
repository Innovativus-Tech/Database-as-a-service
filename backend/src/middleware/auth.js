const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../prisma');
const { cache } = require('../services/cache');

const SESSION_CACHE_TTL_MS = 30_000;
const LAST_SEEN_THROTTLE_MS = 60_000;
const lastSeenSentAt = new Map(); // jti -> last write timestamp

function invalidateSession(jti) {
  cache.invalidate(`session:${jti}`);
  lastSeenSentAt.delete(jti);
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload.jti) return res.status(401).json({ error: 'Invalid or expired token' });

    // Burst of API calls for the same session = one Postgres lookup per 30s,
    // not one per request. Revocation (logout, password change, kick) calls
    // invalidateSession() to drop the cache immediately.
    const session = await cache.getOrLoad(`session:${payload.jti}`, SESSION_CACHE_TTL_MS, () =>
      prisma.session.findUnique({ where: { jti: payload.jti } })
    );
    if (!session || session.revokedAt) {
      cache.invalidate(`session:${payload.jti}`);
      return res.status(401).json({ error: 'Session has been revoked' });
    }

    // Throttle the lastSeenAt write to once-per-minute per session. Was
    // firing on every request, generating one Postgres UPDATE per API call.
    const lastWrite = lastSeenSentAt.get(payload.jti) || 0;
    if (Date.now() - lastWrite > LAST_SEEN_THROTTLE_MS) {
      lastSeenSentAt.set(payload.jti, Date.now());
      prisma.session.update({
        where: { jti: payload.jti },
        data: { lastSeenAt: new Date() },
      }).catch(() => {});
    }

    req.user = { id: payload.sub, email: payload.email, role: payload.role || 'user' };
    req.sessionJti = payload.jti;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Admin gate — always re-checks the role in Postgres rather than trusting the
// JWT claim, so demoting an admin takes effect immediately instead of when
// their 7-day token expires. Must run after requireAuth.
async function requireAdmin(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true },
    });
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

function signToken(user, jti) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role || 'user', jti },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// Creates a Session row + signs a JWT bound to its jti. Call on every
// successful login/signup so "Active sessions" reflects real, revocable state.
async function createSession(user, req) {
  const jti = crypto.randomUUID();
  await prisma.session.create({
    data: {
      userId: user.id,
      jti,
      userAgent: req.headers['user-agent']?.slice(0, 255) || null,
      ip: (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.ip || null,
    },
  });
  return signToken(user, jti);
}

module.exports = { requireAuth, requireAdmin, signToken, createSession, invalidateSession };
