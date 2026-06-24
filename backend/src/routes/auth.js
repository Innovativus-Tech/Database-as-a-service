const express = require('express');
const bcrypt = require('bcrypt');
const { authenticator } = require('otplib');
const qrcode = require('qrcode');
const prisma = require('../prisma');
const { createSession, requireAuth } = require('../middleware/auth');
const {
  stopAndRemoveContainer,
  removeDataDir,
  resolveNames,
} = require('../services/provisioning');
const { removeStreamBlock, reloadNginx } = require('../services/nginxManager');

const router = express.Router();

const BCRYPT_ROUNDS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FREE_DB_LIMIT = 5;
const FREE_STORAGE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

function validateCredentials(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!EMAIL_RE.test(email)) return { error: 'Invalid email address' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters' };

  return { email, password };
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    fullName: user.fullName,
    organizationName: user.organizationName,
    twoFactorEnabled: user.twoFactorEnabled,
    createdAt: user.createdAt,
  };
}

router.post('/signup', async (req, res, next) => {
  try {
    const { error, email, password } = validateCredentials(req.body);
    if (error) return res.status(400).json({ error });

    const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim().slice(0, 80) : '';
    const organizationName = typeof req.body?.organizationName === 'string' ? req.body.organizationName.trim().slice(0, 80) : '';
    if (!fullName) return res.status(400).json({ error: 'Full name is required' });
    if (!organizationName) return res.status(400).json({ error: 'Organization name is required' });

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

router.post('/login', async (req, res, next) => {
  try {
    const { error, email, password } = validateCredentials(req.body);
    if (error) return res.status(400).json({ error });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      await bcrypt.compare(password, '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    if (user.twoFactorEnabled) {
      const code = typeof req.body?.totp === 'string' ? req.body.totp.trim() : '';
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
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const data = {};
    if (typeof req.body?.displayName === 'string') {
      const name = req.body.displayName.trim().slice(0, 80);
      data.displayName = name || null;
    }
    if (typeof req.body?.fullName === 'string') {
      const name = req.body.fullName.trim().slice(0, 80);
      data.fullName = name || null;
    }
    if (typeof req.body?.organizationName === 'string') {
      const name = req.body.organizationName.trim().slice(0, 80);
      data.organizationName = name || null;
    }
    if (typeof req.body?.avatarUrl === 'string') {
      if (req.body.avatarUrl === '') {
        data.avatarUrl = null;
      } else {
        if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(req.body.avatarUrl)) {
          return res.status(400).json({ error: 'avatarUrl must be a base64 image data URL' });
        }
        if (req.body.avatarUrl.length > 600_000) {
          return res.status(400).json({ error: 'Image too large (max ~400KB)' });
        }
        data.avatarUrl = req.body.avatarUrl;
      }
    }
    const user = await prisma.user.update({ where: { id: req.user.id }, data });
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/password — change password, revoke other sessions
// ──────────────────────────────────────────────────────────────────────────────
router.post('/password', requireAuth, async (req, res, next) => {
  try {
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    // Changing your password should kick out every other signed-in device.
    await prisma.session.updateMany({
      where: { userId: user.id, jti: { not: req.sessionJti }, revokedAt: null },
      data: { revokedAt: new Date() },
    });

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
      databaseLimit: FREE_DB_LIMIT,
      storageUsed,
      storageLimit: FREE_STORAGE_BYTES,
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
      if (db.routing === 'nginx') {
        try { await removeStreamBlock(db.port); } catch (e) { console.error('[delete-account] nginx:', e.message); }
      }
    }
    if (dbs.some((d) => d.routing === 'nginx')) {
      await reloadNginx().catch(() => {});
    }

    await prisma.user.delete({ where: { id: req.user.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, FREE_DB_LIMIT, FREE_STORAGE_BYTES };
