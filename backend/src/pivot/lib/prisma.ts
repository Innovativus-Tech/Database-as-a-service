// Single Prisma client for the whole merged backend.
//
// PivotDB used to own its own PrismaClient instance here. In the merged
// backend the CustomDB half already creates one in `src/prisma.js`, and two
// clients in one process means two connection pools against the same metadata
// database — double the connections, and transactions started through one
// client are invisible to the other.
//
// So this module is now a thin re-export of that singleton. Every
// `import { prisma } from '../lib/prisma.js'` across the ported PivotDB engine
// keeps working unchanged and shares the CustomDB pool.
import type { PrismaClient } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const prisma: PrismaClient = require('../../prisma');
