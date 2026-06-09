const prisma = require('../prisma');

const PORT_RANGES = {
  nosql: { min: 27018, max: 27999 },
  sql:   { min: 5433,  max: 5999  },
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
