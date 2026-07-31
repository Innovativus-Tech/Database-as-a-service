// Fastify → Express adapter.
//
// The PivotDB route modules were written against Fastify; the merged backend
// is Express. Rather than hand-rewrite ~2,000 lines of route handlers — pure
// churn, and a fresh opportunity to introduce bugs in code that already
// works — this shim presents the small slice of the Fastify instance API that
// those modules actually use, backed by an Express Router.
//
// The full surface they touch, measured across all 11 route files:
//   app.get/post/put/patch/delete(path, opts?, handler)
//   opts.preHandler: Array<(req, reply) => Promise<void>>
//   req.params / req.query / req.body / req.user
//   reply.code(n) / reply.header(k, v) / reply.send(payload)
//   returning a value from the handler = send it as JSON
//
// That's it. No reply.raw, no hijack, no SSE, no schema compilation.
//
// Keeping the route files close to their upstream form also means future
// PivotDB fixes can be pulled across with minimal conflict.

import type { Request, Response, NextFunction, RequestHandler } from 'express';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const express = require('express');

/** The `reply` object handed to ported handlers. */
export interface ShimReply {
  code(statusCode: number): ShimReply;
  status(statusCode: number): ShimReply;
  header(name: string, value: string): ShimReply;
  send(payload?: unknown): ShimReply;
  /** True once anything has been written — the shim uses this to decide
   *  whether a handler's return value still needs sending. */
  readonly sent: boolean;
}

export type ShimHandler = (req: Request, reply: ShimReply) => unknown;
export type PreHandler = (req: Request, reply: ShimReply) => unknown;
export interface RouteOpts { preHandler?: PreHandler[] }

/**
 * Recursively convert BigInt to Number so JSON.stringify won't throw.
 *
 * Fastify carried this as a global `preSerialization` hook in PivotDB's
 * server bootstrap. Several models (notably `BackupRun.sizeBytes`) are BigInt
 * in Prisma, and without this every backup listing 500s.
 */
function normalizeBigInt(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(normalizeBigInt);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = normalizeBigInt(v);
  }
  return out;
}

function makeReply(res: Response): ShimReply {
  let statusCode = 200;
  let sent = false;

  const reply: ShimReply = {
    get sent() { return sent || res.headersSent; },
    code(n: number) { statusCode = n; return reply; },
    status(n: number) { statusCode = n; return reply; },
    header(name: string, value: string) { res.setHeader(name, value); return reply; },
    send(payload?: unknown) {
      if (sent || res.headersSent) return reply;
      sent = true;
      // Fastify's reply.send() with no argument on a 204 sends an empty body.
      if (payload === undefined) res.status(statusCode).end();
      else res.status(statusCode).json(normalizeBigInt(payload));
      return reply;
    },
  };
  return reply;
}

/**
 * A Fastify-shaped facade over an Express Router.
 *
 * `authenticate` is supplied by the host application (the merged backend
 * passes CustomDB's session auth plus the profile bridge), so ported routes
 * keep writing `{ preHandler: [app.authenticate] }` and transparently get
 * CustomDB's single sign-on instead of PivotDB's old JWT plugin.
 */
export interface ShimApp {
  authenticate: PreHandler;
  // The unused type parameter mirrors Fastify's route generics
  // (`app.get<{ Params: { id: string } }>(...)`). Ported handlers still narrow
  // via `req.params as {...}`, so it only needs to be accepted, not applied.
  get<_T = unknown>(path: string, optsOrHandler: RouteOpts | ShimHandler, handler?: ShimHandler): void;
  post<_T = unknown>(path: string, optsOrHandler: RouteOpts | ShimHandler, handler?: ShimHandler): void;
  put<_T = unknown>(path: string, optsOrHandler: RouteOpts | ShimHandler, handler?: ShimHandler): void;
  patch<_T = unknown>(path: string, optsOrHandler: RouteOpts | ShimHandler, handler?: ShimHandler): void;
  delete<_T = unknown>(path: string, optsOrHandler: RouteOpts | ShimHandler, handler?: ShimHandler): void;
  /** Socket.IO server, attached by the host app for the monitor stream. */
  io?: unknown;
  /** The underlying Express router, for mounting. */
  router: RequestHandler;
}

export function createShimApp(authenticate: PreHandler): ShimApp {
  const router = express.Router();

  function register(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    optsOrHandler: RouteOpts | ShimHandler,
    maybeHandler?: ShimHandler,
  ) {
    const opts: RouteOpts = typeof optsOrHandler === 'function' ? {} : optsOrHandler;
    const handler: ShimHandler =
      typeof optsOrHandler === 'function' ? optsOrHandler : (maybeHandler as ShimHandler);

    router[method](path, async (req: Request, res: Response, next: NextFunction) => {
      const reply = makeReply(res);
      try {
        // Fastify aborts the chain as soon as a preHandler replies. Guards
        // like `requireAdmin` rely on exactly this: they send a 403 and the
        // route body must never run.
        for (const pre of opts.preHandler ?? []) {
          await pre(req, reply);
          if (reply.sent) return;
        }

        const result = await handler(req, reply);

        // A handler may either return a payload (Fastify auto-sends it) or
        // drive `reply` itself. Never both.
        if (!reply.sent && result !== undefined) reply.send(result);
        else if (!reply.sent) res.status(204).end();
      } catch (err) {
        // Hand off to the host app's error middleware rather than swallowing.
        next(err);
      }
    });
  }

  return {
    authenticate,
    get: (p, o, h) => register('get', p, o, h),
    post: (p, o, h) => register('post', p, o, h),
    put: (p, o, h) => register('put', p, o, h),
    patch: (p, o, h) => register('patch', p, o, h),
    delete: (p, o, h) => register('delete', p, o, h),
    router: router as RequestHandler,
  };
}

/**
 * Mount a ported PivotDB route module and return an Express router.
 *
 * @param routeModule the exported `xxxRoutes(app)` function
 * @param authenticate host-supplied auth preHandler
 */
export async function mountPivotRoutes(
  // Route modules are typed against FastifyInstance upstream; the shim is
  // structurally compatible for everything they use.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  routeModule: (app: any) => Promise<void> | void,
  authenticate: PreHandler,
): Promise<RequestHandler> {
  const app = createShimApp(authenticate);
  await routeModule(app);
  return app.router;
}
