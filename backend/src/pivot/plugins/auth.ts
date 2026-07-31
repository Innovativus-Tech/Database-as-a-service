// Auth helpers for the ported PivotDB routes.
//
// Upstream, this file registered @fastify/jwt and PivotDB's own user table.
// In the merged product CustomDB owns authentication outright — sessions,
// 2FA, Google OAuth, password reset — and a user who signs in there gets the
// PivotDB feature set with no second login.
//
// So the module keeps its exported names and signatures (route files import
// `profileScope` / `requireAdmin` / `requireSuperAdmin` unchanged) but resolves
// them against the CustomDB request shape populated by
// `middleware/auth.js` + `services/profileBridge.js`:
//
//   req.user      = { id, email, role }          ← requireAuth
//   req.profileId = <the user's workspace id>    ← attachProfile
//
// Role mapping from PivotDB's three-tier model:
//   superadmin → CustomDB `role === 'admin'`   (platform operator)
//   admin      → `profileRole === 'admin'`     (full control of own workspace)
//   viewer     → `profileRole === 'viewer'`    (read-only member)

import type { Request } from 'express';
import type { ShimReply } from '../adapter/fastify-express.js';

/**
 * Prisma `where` fragment restricting a query to the caller's workspace.
 *
 * Every PivotDB model is profile-scoped, so this is the tenancy boundary: two
 * CustomDB users can never see each other's connections, jobs, or alerts.
 */
export function profileScope(req: Request): Record<string, unknown> {
  const r = req;
  if (!r.profileId) {
    // attachProfile runs on every PivotDB route; reaching here means a route
    // was mounted without it. Fail closed rather than returning {} — an empty
    // scope would silently expose every tenant's rows.
    throw new Error('No workspace resolved for this request');
  }
  return { profileId: r.profileId };
}

/** Blocks read-only members from mutating. Returns false once a 403 is sent. */
export function requireAdmin(req: Request, reply: ShimReply): boolean {
  const r = req;
  if (r.user?.profileRole === 'viewer') {
    reply.code(403).send({ error: 'Your account has read-only access to this workspace' });
    return false;
  }
  return true;
}

/** Platform-operator gate — CustomDB's `role === 'admin'`. */
export function requireSuperAdmin(req: Request, reply: ShimReply): boolean {
  const r = req;
  if (r.user?.role !== 'admin') {
    reply.code(403).send({ error: 'Platform administrator access required' });
    return false;
  }
  return true;
}
