const { MongoClient } = require('mongodb');
const { Client: PgClient } = require('pg');

// MongoDB ──────────────────────────────────────────────────────────────────────

async function withMongo(connectionUrl, fn) {
  const client = new MongoClient(connectionUrl, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

async function listMongoCollections(connectionUrl, dbName) {
  return withMongo(connectionUrl, async (client) => {
    const db = client.db(dbName);
    const names = await db.listCollections({}, { nameOnly: true }).toArray();
    const out = [];
    for (const c of names) {
      if (c.name.startsWith('system.')) continue;
      const count = await db.collection(c.name).estimatedDocumentCount();
      out.push({ name: c.name, count });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  });
}

async function browseMongoCollection({ connectionUrl, dbName, collection, skip = 0, limit = 50, filter = {} }) {
  return withMongo(connectionUrl, async (client) => {
    const col = client.db(dbName).collection(collection);
    const [rows, total] = await Promise.all([
      col.find(filter).skip(skip).limit(limit).toArray(),
      col.countDocuments(filter),
    ]);
    return { total, skip, limit, rows };
  });
}

// PostgreSQL ──────────────────────────────────────────────────────────────────

const PG_IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
function validIdent(name) { return typeof name === 'string' && PG_IDENT_RE.test(name); }

async function withPg(connectionUrl, fn) {
  const client = new PgClient({ connectionString: connectionUrl, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function listPostgresTables(connectionUrl) {
  return withPg(connectionUrl, async (client) => {
    const sql = `
      SELECT c.relname AS name,
             c.reltuples::bigint AS estimated_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname NOT IN ('pg_catalog','information_schema')
      ORDER BY c.relname;`;
    const { rows } = await client.query(sql);

    // reltuples is -1 until ANALYZE runs. For freshly-imported tables that's
    // almost always the case, so fall back to a real COUNT(*) per table.
    const out = [];
    for (const r of rows) {
      let count = Number(r.estimated_count);
      if (count < 0) {
        const exact = await client.query(`SELECT COUNT(*)::bigint AS c FROM "${r.name}"`);
        count = Number(exact.rows[0].c);
      }
      out.push({ name: r.name, count });
    }
    return out;
  });
}

async function browsePostgresTable({ connectionUrl, table, skip = 0, limit = 50 }) {
  if (!validIdent(table)) {
    throw Object.assign(new Error('Invalid table name'), { status: 400 });
  }
  return withPg(connectionUrl, async (client) => {
    const colsRes = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1
        ORDER BY ordinal_position`,
      [table]
    );
    if (colsRes.rows.length === 0) {
      throw Object.assign(new Error('Table not found'), { status: 404 });
    }
    const columns = colsRes.rows.map((r) => r.column_name);

    const countRes = await client.query(`SELECT COUNT(*)::bigint AS c FROM "${table}"`);
    const total = Number(countRes.rows[0].c);

    const rowsRes = await client.query(
      `SELECT * FROM "${table}" LIMIT $1 OFFSET $2`,
      [Math.min(limit, 500), skip]
    );
    return { total, skip, limit, columns, rows: rowsRes.rows };
  });
}

module.exports = {
  listMongoCollections,
  browseMongoCollection,
  listPostgresTables,
  browsePostgresTable,
};
