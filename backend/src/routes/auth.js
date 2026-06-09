const express = require('express');
const bcrypt = require('bcrypt');
const prisma = require('../prisma');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

const BCRYPT_ROUNDS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCredentials(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!EMAIL_RE.test(email)) return { error: 'Invalid email address' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters' };

  return { email, password };
}

router.post('/signup', async (req, res, next) => {
  try {
    const { error, email, password } = validateCredentials(req.body);
    if (error) return res.status(400).json({ error });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: { email, passwordHash },
      select: { id: true, email: true, plan: true, createdAt: true },
    });

    const token = signToken(user);
    res.status(201).json({ user, token });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { error, email, password } = validateCredentials(req.body);
    if (error) return res.status(400).json({ error });

    const user = await prisma.user.findUnique({ where: { email } });
    // Constant-ish response to avoid leaking whether email exists.
    if (!user) {
      await bcrypt.compare(password, '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    const token = signToken(user);
    res.json({
      user: { id: user.id, email: user.email, plan: user.plan, createdAt: user.createdAt },
      token,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, plan: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
