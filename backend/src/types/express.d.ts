// Request augmentation for the merged backend.
//
// `middleware/auth.js` (CustomDB session auth) and
// `services/profileBridge.js` (workspace resolution) attach these to every
// authenticated request. Declaring them here lets the ported PivotDB routes —
// which were written against Fastify's typed `req.user` — keep compiling
// unchanged.
//
// `user.id` is the CustomDB user id. PivotDB's handlers historically read
// `user.userId`, so both spellings are declared and populated; see
// middleware/auth.js.

import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        /** CustomDB user id. */
        id: string;
        /** Alias of `id`, kept for the ported PivotDB handlers. */
        userId: string;
        email: string;
        /** Platform-wide role: 'user' | 'admin'. */
        role: string;
        /** Workspace-level role: 'admin' | 'viewer'. */
        profileRole?: string;
        /** The caller's workspace id, mirrored from `req.profileId`. */
        profileId?: string | null;
      };
      /** Resolved by `attachProfile`; the tenancy boundary for PivotDB models. */
      profileId?: string;
      /** Session jti, set by `requireAuth`. */
      sessionJti?: string;
    }
  }
}

export {};
