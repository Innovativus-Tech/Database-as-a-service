const prisma = require('../prisma');

// Internal bookkeeping only since single-port routing: the public data plane
// is one shared Mongo port (nginx SNI) + one shared Postgres port (pgGateway),
// so these per-DB ports are never published on the host anymore. They remain
// allocated because the schema requires a unique port per database row and
// they'd be needed again if a deployment ever reverts to direct port binding.
// Override via env (NOSQL_PORT_MIN/MAX, SQL_PORT_MIN/MAX) to widen capacity
// (each range bounds how many databases of that type can exist).
const PORT_RANGES = {
  nosql: {
    min: Number(process.env.NOSQL_PORT_MIN) || 27018,
    max: Number(process.env.NOSQL_PORT_MAX) || 27117,
  },
  sql: {
    min: Number(process.env.SQL_PORT_MIN) || 5433,
    max: Number(process.env.SQL_PORT_MAX) || 5532,
  },
};

async function getNextAvailablePort(type) {
  const range = PORT_RANGES[type];
  if (!range) throw new Error(`Unknown database type: ${type}`);

  const taken = await prisma.database.findMany({
    where: { type, port: { gte: range.min, lte: range.max } },
    select: { port: true },
    orderBy: { port: 'asc' },
  });

  const takenSet = new Set(taken.map((d) => d.port));
  for (let p = range.min; p <= range.max; p++) {
    if (!takenSet.has(p)) return p;
  }
  throw new Error(`No available ${type} ports in range ${range.min}-${range.max}`);
}

module.exports = { getNextAvailablePort, PORT_RANGES };
