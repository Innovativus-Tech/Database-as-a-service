// Google OAuth 2.0 sign-in (authorization-code flow, server side).
//
// GET  /api/auth/google           → redirect the browser to Google's consent screen
// GET  /api/auth/google/callback  → exchange the code, upsert the user, mint a
//                                   session JWT, and bounce back to the frontend
//
// The redirect URI goes through the frontend origin (the Next.js /api proxy
// forwards it here), so only ONE public origin needs to be registered in the
// Google Cloud console: {FRONTEND_ORIGIN}/api/auth/google/callback
//
// State is a stateless HMAC-signed nonce (keyed with JWT_SECRET) instead of a
// server-side session — this backend is deliberately cookie-free.

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const prisma = require('../prisma');
const { createSession } = require('../middleware/auth');

const router = express.Router();

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const STATE_TTL_MS = 10 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

function googleEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getFrontendOrigin(req) {
  if (process.env.FRONTEND_ORIGIN) return process.env.FRONTEND_ORIGIN.replace(/\/+$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3030';
  return `${proto}://${host}`;
}

function redirectUri(req) {
  return process.env.GOOGLE_REDIRECT_URI || `${getFrontendOrigin(req)}/api/auth/google/callback`;
}

function signState() {
  const payload = Buffer.from(JSON.stringify({ n: crypto.randomBytes(16).toString('hex'), t: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyState(state) {
  if (typeof state !== 'string') return false;
  const [payload, sig] = state.split('.');
  if (!payload || !sig) return false;
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { t } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return Date.now() - t < STATE_TTL_MS;
  } catch {
    return false;
  }
}

function loginRedirect(res, origin, error) {
  return res.redirect(`${origin}/login?error=${encodeURIComponent(error)}`);
}

router.get('/google', (req, res) => {
  if (!googleEnabled()) {
    return loginRedirect(res, getFrontendOrigin(req), 'Google sign-in is not configured');
  }
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state: signState(),
    prompt: 'select_account',
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
});

router.get('/google/callback', async (req, res, next) => {
  const origin = getFrontendOrigin(req);
  try {
    if (!googleEnabled()) return loginRedirect(res, origin, 'Google sign-in is not configured');
    if (req.query.error) return loginRedirect(res, origin, 'Google sign-in was cancelled');
    if (!verifyState(req.query.state)) return loginRedirect(res, origin, 'Sign-in session expired. Please try again.');

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) return loginRedirect(res, origin, 'Google sign-in failed');

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      console.error('[google-auth] token exchange failed:', tokenRes.status, await tokenRes.text().catch(() => ''));
      return loginRedirect(res, origin, 'Google sign-in failed. Please try again.');
    }
    const { id_token: idToken } = await tokenRes.json();
    if (!idToken) return loginRedirect(res, origin, 'Google sign-in failed. Please try again.');

    // The id_token came straight from Google's token endpoint over TLS in the
    // exchange above, so decoding the payload without a JWKS signature check
    // is safe here (per Google's own OIDC guidance for the code flow).
    const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());
    const googleId = claims.sub;
    const email = (claims.email || '').trim().toLowerCase();
    if (!googleId || !email || claims.email_verified !== true) {
      return loginRedirect(res, origin, 'Your Google account has no verified email');
    }

    let user = await prisma.user.findUnique({ where: { googleId } });
    if (!user) {
      const byEmail = await prisma.user.findUnique({ where: { email } });
      if (byEmail) {
        // Same verified email → link Google to the existing password account.
        user = await prisma.user.update({ where: { id: byEmail.id }, data: { googleId } });
      } else {
        // First-time Google signup. passwordHash is NOT NULL by schema, so mint
        // an unguessable random one — the user can set a real password later
        // via "Forgot password".
        const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), BCRYPT_ROUNDS);
        const fullName = (claims.name || '').trim().slice(0, 80) || null;
        user = await prisma.user.create({
          data: {
            email,
            passwordHash,
            googleId,
            fullName,
            displayName: fullName,
            avatarUrl: typeof claims.picture === 'string' ? claims.picture.slice(0, 1024) : null,
          },
        });
      }
    }

    const token = await createSession(user, req);
    // Token travels in the URL fragment — fragments never reach server logs
    // or proxies. The /auth/callback page reads it and stores the session.
    res.redirect(`${origin}/auth/callback#token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('[google-auth] callback error:', err);
    loginRedirect(res, origin, 'Google sign-in failed. Please try again.');
  }
});

module.exports = router;
