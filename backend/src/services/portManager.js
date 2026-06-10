const prisma = require('../prisma');

// Bounds must match the nginx `ports:` range in docker-compose.yml.
// Override via env (NOSQL_PORT_MIN/MAX, SQL_PORT_MIN/MAX) if you widen the range.
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
