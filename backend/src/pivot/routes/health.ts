import type { ShimApp as FastifyInstance } from '../adapter/fastify-express.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis.ping();
      return reply.send({ status: 'ok' });
    } catch (err) {
      return reply.code(503).send({ status: 'error', error: String(err) });
    }
  });
}
