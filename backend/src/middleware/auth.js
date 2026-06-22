const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../prisma');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload.jti) return res.status(401).json({ error: 'Invalid or expired token' });

    const session = await prisma.session.findUnique({ where: { jti: payload.jti } });
    if (!session || session.revokedAt) {
      return res.status(401).json({ error: 'Session has been revoked' });
    }

    // Best-effort, fire-and-forget — don't block the request on this write.
    prisma.session.update({
      where: { jti: payload.jti },
      data: { lastSeenAt: new Date() },
    }).catch(() => {});

    req.user = { id: payload.sub, email: payload.email };
    req.sessionJti = payload.jti;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function signToken(user, jti) {
  return jwt.sign(
    { sub: user.id, email: user.email, jti },
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

module.exports = { requireAuth, signToken, createSession };
