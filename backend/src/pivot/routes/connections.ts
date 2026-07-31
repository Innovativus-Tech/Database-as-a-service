import { z } from 'zod';
import type { ShimApp as FastifyInstance } from '../adapter/fastify-express.js';
// CustomDB hashes with `bcrypt`; PivotDB used `bcryptjs`. The formats are
// interchangeable ($2a$/$2b$), so accounts imported from PivotDB verify fine.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bcrypt = require('bcrypt');
import {
  createConnection, listConnections, getConnection,
  updateConnection, deleteConnection, testConnection,
} from '../services/connection.service.js';
import { profileScope, requireAdmin } from '../plugins/auth.js';
import { prisma } from '../lib/prisma.js';

const PasswordSchema = z.string().min(8, 'Password must be at least 8 characters');

const CreateBody = z.object({
  name: z.string().min(1),
  // dbType defaults to mongodb so existing clients (no field sent) still work.
  dbType: z.enum(['mongodb', 'postgres', 'mysql']).default('mongodb'),
  uri: z.string().min(1),
  tags: z.array(z.string()).default([]),
  readOnly: z.boolean().default(false),
});

const UpdateBody = z.object({
  name: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  readOnly: z.boolean().optional(),
});

const InviteViewerBody = z.object({
  email: z.string().email(),
  password: PasswordSchema,
});

export async function connectionRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate] }, async (req) => {
    const scope = profileScope(req);
    return listConnections(scope);
  });

  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = CreateBody.parse(req.body);
    const user = req.user!;
    if (!user.profileId) return reply.code(400).send({ error: 'No profile assigned' });
    try {
      const conn = await createConnection({ ...body, createdBy: user.email, profileId: user.profileId });
      return reply.code(201).send(conn);
    } catch (err) {
      return reply.code(400).send({ error: String(err) });
    }
  });

  app.get('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const scope = profileScope(req);
    const conn = await getConnection(id, scope);
    if (!conn) return reply.code(404).send({ error: 'Not found' });
    return conn;
  });

  app.put('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = UpdateBody.parse(req.body);
    const scope = profileScope(req);
    try {
      return await updateConnection(id, body, scope);
    } catch {
      return reply.code(404).send({ error: 'Not found' });
    }
  });

  app.delete('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const user = req.user!;
    const scope = profileScope(req);
    try {
      await deleteConnection(id, user.email, scope);
      return reply.code(204).send();
    } catch {
      return reply.code(404).send({ error: 'Not found' });
    }
  });

  app.post('/:id/test', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await testConnection(id);
    } catch (err) {
      return reply.code(400).send({ error: String(err) });
    }
  });

  // ── Schema discovery (Phase 0 of cross-engine migration) ───────────────────
  // Returns a uniform shape across mongodb / postgres / mysql so the Migrate
  // wizard can render the same tree component for any source.
  app.get('/:id/schema', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { database, sampleSize } = req.query as { database?: string; sampleSize?: string };
    const scope = profileScope(req);

    const conn = await prisma.connection.findFirst({ where: { id, ...scope } });
    if (!conn) return reply.code(404).send({ error: 'Not found' });

    try {
      const { discoverConnectionSchema } = await import('../services/discovery.service.js');
      const namespaces = await discoverConnectionSchema(id, {
        database,
        sampleSize: sampleSize ? Number(sampleSize) : undefined,
      });
      return { dbType: conn.dbType, namespaces };
    } catch (err) {
      return reply.code(500).send({ error: String(err) });
    }
  });

  // List databases visible to this connection's credential.
  // Used by the Migrate wizard's "pick a database" step.
  app.get('/:id/databases', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const scope = profileScope(req);
    const conn = await prisma.connection.findFirst({ where: { id, ...scope } });
    if (!conn) return reply.code(404).send({ error: 'Not found' });
    try {
      const { listConnectionDatabases } = await import('../services/discovery.service.js');
      const databases = await listConnectionDatabases(id);
      return { dbType: conn.dbType, databases };
    } catch (err) {
      return reply.code(500).send({ error: String(err) });
    }
  });

  // ── SQL rows fetch (Phase 2A) ──────────────────────────────────────────────
  // Used by the SqlExplorer on the Explore page. Refuses Mongo connections
  // because Mongo has its own `/explore/*` endpoints with richer filtering.
  app.get('/:id/sql/tables/:database/:table/rows', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id, database, table } = req.params as { id: string; database: string; table: string };
    const { limit = '50', offset = '0' } = req.query as { limit?: string; offset?: string };
    const scope = profileScope(req);

    const conn = await prisma.connection.findFirst({ where: { id, ...scope } });
    if (!conn) return reply.code(404).send({ error: 'Not found' });
    if (conn.dbType === 'mongodb') {
      return reply.code(400).send({ error: 'Use /explore endpoints for MongoDB connections' });
    }

    try {
      const { fetchSqlRows } = await import('../services/discovery.service.js');
      return await fetchSqlRows(id, { database, name: table }, {
        limit: Number(limit), offset: Number(offset),
      });
    } catch (err) {
      return reply.code(500).send({ error: String(err) });
    }
  });

  // ── SQL monitor snapshot (Phase 2B) ────────────────────────────────────────
  // Returns the SqlMonitorSnapshot for a Postgres or MySQL connection.
  // Mongo connections must use the existing /monitor/snapshot endpoint.
  app.get('/:id/sql/monitor/snapshot', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const scope = profileScope(req);

    const conn = await prisma.connection.findFirst({ where: { id, ...scope } });
    if (!conn) return reply.code(404).send({ error: 'Not found' });
    if (conn.dbType === 'mongodb') {
      return reply.code(400).send({ error: 'Use /monitor/snapshot for MongoDB connections' });
    }

    try {
      const { getSqlMonitorSnapshot } = await import('../services/sql-monitor.service.js');
      return await getSqlMonitorSnapshot(id);
    } catch (err) {
      // AggregateError (DNS / TCP multi-attempt failure) has an empty .message;
      // unwrap the first inner error so the UI shows the real cause.
      let msg: string;
      if (err instanceof AggregateError && err.errors?.length) {
        msg = (err.errors[0] as Error).message ?? String(err.errors[0]);
      } else {
        msg = (err as Error).message ?? String(err);
      }
      return reply.code(500).send({ error: `Cannot connect to ${conn.dbType} server: ${msg}` });
    }
  });

  // ── Team members ───────────────────────────────────────────────────────────
  //
  // PivotDB's original auth routes (/auth/status, /auth/login, /auth/register)
  // and its superadmin profile CRUD lived here. In the merged product CustomDB
  // owns authentication — a user signs in once at /api/auth and already has
  // this entire feature set — so those routes are gone.
  //
  // What remains is the genuinely useful part: inviting a read-only teammate
  // into YOUR workspace. Scoping is implicit (always the caller's own
  // workspace), so the old "can only invite to your own profile" checks and
  // the cross-tenant profile listing are no longer reachable states.

  app.get('/team', { preHandler: [app.authenticate] }, async (req) => {
    const { profileId } = profileScope(req) as { profileId: string };
    return prisma.user.findMany({
      where: { profileId },
      select: {
        id: true, email: true, fullName: true, profileRole: true,
        createdAt: true, lastLoginAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  });

  app.post('/team', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const parsed = InviteViewerBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }
    const { profileId } = profileScope(req) as { profileId: string };
    const actor = req.user as { id: string };
    const { email, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);
    try {
      const viewer = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          passwordHash,
          role: 'user',
          profileRole: 'viewer',
          profileId,
          invitedBy: actor.id,
        },
        select: { id: true, email: true, profileRole: true },
      });
      return reply.code(201).send(viewer);
    } catch {
      return reply.code(409).send({ error: 'An account with that email already exists' });
    }
  });

  app.delete('/team/:userId', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { userId } = req.params as { userId: string };
    const { profileId } = profileScope(req) as { profileId: string };

    // Only invited read-only members can be removed this way. The workspace
    // owner is never deletable here — that is account deletion, which lives
    // behind /api/auth and tears down their databases too.
    const member = await prisma.user.findFirst({
      where: { id: userId, profileId, profileRole: 'viewer' },
      select: { id: true },
    });
    if (!member) return reply.code(404).send({ error: 'Team member not found' });

    await prisma.user.delete({ where: { id: member.id } });
    return reply.code(204).send();
  });
}
