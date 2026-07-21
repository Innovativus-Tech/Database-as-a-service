const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { authenticator } = require('otplib');
const qrcode = require('qrcode');
const prisma = require('../prisma');
const { createSession, requireAuth, invalidateSession } = require('../middleware/auth');
const {
  validate,
  signupSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  updateProfileSchema,
} = require('../validation/authSchemas');
const { sendPasswordResetEmail } = require('../services/email');
const {
  stopAndRemoveContainer,
  removeDataDir,
  resolveNames,
} = require('../services/provisioning');
const { removeStreamBlock, reloadNginx } = require('../services/nginxManager');

const router = express.Router();

// Google OAuth: GET /api/auth/google + /api/auth/google/callback
router.use(require('./googleAuth'));

const BCRYPT_ROUNDS = 12;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

// Plan limits. This deployment is self-hosted for one organization, so both
// default to UNLIMITED. Set DB_LIMIT / STORAGE_LIMIT_GB env vars to re-enable
// caps if the instance is ever opened up to outside users.
const FREE_DB_LIMIT = Number(process.env.DB_LIMIT) > 0 ? Number(process.env.DB_LIMIT) : Infinity;
const FREE_STORAGE_BYTES = Number(process.env.STORAGE_LIMIT_GB) > 0
  ? Number(process.env.STORAGE_LIMIT_GB) * 1024 * 1024 * 1024
  : Infinity;

// Real (valid-format) hash of a throwaway string, computed once at startup.
// Used to equalize response timing when the account doesn't exist — a
// malformed hash string makes bcrypt.compare bail out instantly, which is a
// measurable timing signal for user enumeration.
const DUMMY_HASH = bcrypt.hashSync('timing-equalization-dummy', BCRYPT_ROUNDS);

// Minimal in-memory rate limiter for unauthenticated, abusable endpoints
// (login brute force, forgot-password email spam). Single-process deployment,
// so a Map is enough — no Redis dependency for the hot auth path.
const rateBuckets = new Map(); // key -> [timestamps]
function rateLimit(key, maxHits, windowMs) {
  const now = Date.now();
  const hits = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= maxHits) return false;
  hits.push(now);
  rateBuckets.set(key, hits);
  return true;
}
// Sweep stale buckets so the Map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of rateBuckets) {
    if (hits.every((t) => now - t > 60 * 60 * 1000)) rateBuckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

function clientIp(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.ip || 'unknown';
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
    role: user.role,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    fullName: user.fullName,
    organizationName: user.organizationName,
    twoFactorEnabled: user.twoFactorEnabled,
    createdAt: user.createdAt,
  };
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getFrontendOrigin(req) {
  if (process.env.FRONTEND_ORIGIN) return process.env.FRONTEND_ORIGIN.replace(/\/+$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3030';
  return `${proto}://${host}`;
}

router.post('/signup', validate(signupSchema), async (req, res, next) => {
  try {
    // Signups mint sessions AND (later) real Docker containers — keep bots
    // from bulk-registering. Window matches the login limiter's shape.
    if (!rateLimit(`signup:${clientIp(req)}`, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many signups from this address. Try again later.' });
    }

    const { email, password, fullName, organizationName } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: { email, passwordHash, fullName, organizationName, displayName: fullName },
    });

    const token = await createSession(user, req);
    res.status(201).json({ user: publicUser(user), token });
  } catch (err) {
    next(err);
  }
});

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!rateLimit(`login:${clientIp(req)}`, 20, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many login attempts. Try again in a few minutes.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    if (user.twoFactorEnabled) {
      const code = req.body.totp || '';
      if (!code) return res.json({ twoFactorRequired: true });
      const valid = authenticator.check(code, user.twoFactorSecret);
      if (!valid) return res.status(401).json({ error: 'Invalid 2FA code' });
    }

    const token = await createSession(user, req);
    res.json({ user: publicUser(user), token });
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password', validate(forgotPasswordSchema), async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!rateLimit(`forgot:${clientIp(req)}`, 5, 15 * 60 * 1000) ||
        !rateLimit(`forgot-email:${email}`, 3, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many reset requests. Try again in a few minutes.' });
    }

    // Opportunistic cleanup — expired tokens have no value, don't let the
    // table grow forever.
    prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});

    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = hashResetToken(token);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

      await prisma.$transaction([
        prisma.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        }),
        prisma.passwordResetToken.create({
          data: { userId: user.id, tokenHash, expiresAt },
        }),
      ]);

      const resetUrl = `${getFrontendOrigin(req)}/reset-password?token=${encodeURIComponent(token)}`;
      // Fire-and-forget: a slow or failing SMTP server must not 500 this
      // request (that would reveal the account exists) or delay the response
      // (a timing signal for the same thing). Failures are logged with the
      // reset link so an operator can still hand it to the user.
      sendPasswordResetEmail({ to: user.email, resetUrl }).catch((err) => {
        console.error(`[password-reset] email send failed for ${user.email}: ${err.message}. Link: ${resetUrl}`);
      });
    } else {
      await bcrypt.compare('dummy-password', DUMMY_HASH);
    }

    res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', validate(resetPasswordSchema), async (req, res, next) => {
  try {
    if (!rateLimit(`reset:${clientIp(req)}`, 10, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    }

    const { token, password: newPassword } = req.body;

    const tokenHash = hashResetToken(token);
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date()) {
      return res.status(400).json({ error: 'Reset link is invalid or expired' });
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const activeSessions = await prisma.session.findMany({
      where: { userId: resetToken.userId, revokedAt: null },
      select: { jti: true },
    });

    await prisma.$transaction([
      prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
      prisma.passwordResetToken.updateMany({
        where: { userId: resetToken.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
      prisma.session.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    for (const s of activeSessions) invalidateSession(s.jti);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /api/auth/me — profile (display name, avatar)
// ──────────────────────────────────────────────────────────────────────────────
router.patch('/me', requireAuth, validate(updateProfileSchema), async (req, res, next) => {
  try {
    const data = {};
    if (req.body.displayName !== undefined) data.displayName = req.body.displayName || null;
    if (req.body.fullName !== undefined) data.fullName = req.body.fullName || null;
    if (req.body.organizationName !== undefined) data.organizationName = req.body.organizationName || null;
    if (req.body.avatarUrl !== undefined) data.avatarUrl = req.body.avatarUrl || null;
    const user = await prisma.user.update({ where: { id: req.user.id }, data });
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/password — change password, revoke other sessions
// ──────────────────────────────────────────────────────────────────────────────
router.post('/password', requireAuth, validate(changePasswordSchema), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    // Changing your password should kick out every other signed-in device.
    const otherSessions = await prisma.session.findMany({
      where: { userId: user.id, jti: { not: req.sessionJti }, revokedAt: null },
      select: { jti: true },
    });
    await prisma.session.updateMany({
      where: { userId: user.id, jti: { not: req.sessionJti }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    for (const s of otherSessions) invalidateSession(s.jti);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Sessions
// ──────────────────────────────────────────────────────────────────────────────
router.get('/sessions', requireAuth, async (req, res, next) => {
  try {
    const sessions = await prisma.session.findMany({
      where: { userId: req.user.id, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
    });
    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        current: s.jti === req.sessionJti,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const session = await prisma.session.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    invalidateSession(session.jti);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Two-factor authentication (TOTP)
// ──────────────────────────────────────────────────────────────────────────────
router.post('/2fa/setup', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (user.twoFactorEnabled) return res.status(409).json({ error: '2FA is already enabled' });

    const secret = authenticator.generateSecret();
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: secret } });

    const otpauthUrl = authenticator.keyuri(user.email, 'CustomDB', secret);
    const qrCode = await qrcode.toDataURL(otpauthUrl);

    res.json({ secret, otpauthUrl, qrCode });
  } catch (err) {
    next(err);
  }
});

router.post('/2fa/verify', requireAuth, async (req, res, next) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.twoFactorSecret) return res.status(400).json({ error: 'Run 2FA setup first' });

    const valid = authenticator.check(code, user.twoFactorSecret);
    if (!valid) return res.status(401).json({ error: 'Invalid code' });

    await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/2fa/disable', requireAuth, async (req, res, next) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.twoFactorEnabled) return res.status(400).json({ error: '2FA is not enabled' });

    const valid = authenticator.check(code, user.twoFactorSecret);
    if (!valid) return res.status(401).json({ error: 'Invalid code' });

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/auth/usage — plan limits + current usage, for the Plan & Billing tab
// ──────────────────────────────────────────────────────────────────────────────
router.get('/usage', requireAuth, async (req, res, next) => {
  try {
    const [user, dbs] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.user.id } }),
      prisma.database.findMany({ where: { userId: req.user.id, status: { not: 'deleted' } } }),
    ]);
    const storageUsed = dbs.reduce((acc, d) => acc + Number(d.storageUsed), 0);
    res.json({
      plan: user.plan,
      databaseCount: dbs.length,
      // Infinity doesn't survive JSON — null means "no limit" to the client.
      databaseLimit: Number.isFinite(FREE_DB_LIMIT) ? FREE_DB_LIMIT : null,
      storageUsed,
      storageLimit: Number.isFinite(FREE_STORAGE_BYTES) ? FREE_STORAGE_BYTES : null,
    });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/auth/me — delete account: tear down every owned container first,
// then delete the user row (cascades databases/credentials/sessions).
// ──────────────────────────────────────────────────────────────────────────────
router.delete('/me', requireAuth, async (req, res, next) => {
  try {
    if (req.body?.confirm !== 'CONFIRM') {
      return res.status(400).json({ error: 'Type CONFIRM to delete your account' });
    }

    const dbs = await prisma.database.findMany({
      where: { userId: req.user.id, status: { not: 'deleted' } },
    });

    for (const db of dbs) {
      const { containerName, dataDir } = resolveNames(db);
      try { await stopAndRemoveContainer(containerName); } catch (e) { console.error('[delete-account] container:', e.message); }
      try { await removeDataDir(dataDir); } catch (e) { console.error('[delete-account] data dir:', e.message); }
      if (db.routing === 'nginx' || db.routing === 'mongo-gateway') {
        try { await removeStreamBlock(db.port, db.host); } catch (e) { console.error('[delete-account] nginx:', e.message); }
      }
    }
    if (dbs.some((d) => d.routing === 'nginx' || d.routing === 'mongo-gateway')) {
      await reloadNginx().catch(() => {});
    }

    await prisma.user.delete({ where: { id: req.user.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, FREE_DB_LIMIT, FREE_STORAGE_BYTES };
