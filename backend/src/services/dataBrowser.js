const { MongoClient, ObjectId } = require('mongodb');
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

function toMongoId(id) {
  if (typeof id === 'string' && ObjectId.isValid(id) && String(new ObjectId(id)) === id) {
    return new ObjectId(id);
  }
  return id; // _id wasn't an ObjectId hex string — fall back to the raw value
}

async function updateMongoDocument({ connectionUrl, dbName, collection, id, doc }) {
  return withMongo(connectionUrl, async (client) => {
    const { _id, ...rest } = doc || {};
    const result = await client.db(dbName).collection(collection).updateOne(
      { _id: toMongoId(id) },
      { $set: rest }
    );
    if (result.matchedCount === 0) throw Object.assign(new Error('Document not found'), { status: 404 });
    return { ok: true };
  });
}

async function deleteMongoDocument({ connectionUrl, dbName, collection, id }) {
  return withMongo(connectionUrl, async (client) => {
    const result = await client.db(dbName).collection(collection).deleteOne({ _id: toMongoId(id) });
    if (result.deletedCount === 0) throw Object.assign(new Error('Document not found'), { status: 404 });
    return { ok: true };
  });
}

async function createMongoCollection(connectionUrl, dbName, name) {
  return withMongo(connectionUrl, async (client) => {
    await client.db(dbName).createCollection(name);
    return { ok: true };
  });
}

async function dropMongoCollection(connectionUrl, dbName, name) {
  return withMongo(connectionUrl, async (client) => {
    try {
      await client.db(dbName).collection(name).drop();
    } catch (err) {
      if (err.codeName !== 'NamespaceNotFound') throw err;
    }
    return { ok: true };
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

    // ctid (physical row id) lets the client edit/delete a specific row even
    // though most tables here have no declared primary key. It's only stable
    // for the lifetime of this page load (an UPDATE/VACUUM can change it).
    const rowsRes = await client.query(
      `SELECT *, ctid::text AS "__ctid" FROM "${table}" LIMIT $1 OFFSET $2`,
      [Math.min(limit, 500), skip]
    );
    return { total, skip, limit, columns, rows: rowsRes.rows };
  });
}

async function updatePostgresRow({ connectionUrl, table, ctid, values }) {
  if (!validIdent(table)) {
    throw Object.assign(new Error('Invalid table name'), { status: 400 });
  }
  return withPg(connectionUrl, async (client) => {
    const colsRes = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
      [table]
    );
    const validCols = new Set(colsRes.rows.map((r) => r.column_name));
    const setCols = Object.keys(values || {}).filter((c) => validCols.has(c));
    if (setCols.length === 0) {
      throw Object.assign(new Error('No valid columns to update'), { status: 400 });
    }
    const setSql = setCols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
    const params = setCols.map((c) => values[c]);
    params.push(ctid);
    const result = await client.query(
      `UPDATE "${table}" SET ${setSql} WHERE ctid = $${params.length}::tid`,
      params
    );
    if (result.rowCount === 0) throw Object.assign(new Error('Row not found'), { status: 404 });
    return { ok: true };
  });
}

async function deletePostgresRow({ connectionUrl, table, ctid }) {
  if (!validIdent(table)) {
    throw Object.assign(new Error('Invalid table name'), { status: 400 });
  }
  return withPg(connectionUrl, async (client) => {
    const result = await client.query(`DELETE FROM "${table}" WHERE ctid = $1::tid`, [ctid]);
    if (result.rowCount === 0) throw Object.assign(new Error('Row not found'), { status: 404 });
    return { ok: true };
  });
}

const PG_COLUMN_TYPES = new Set(['text', 'integer', 'bigint', 'boolean', 'timestamptz', 'numeric', 'double precision', 'jsonb']);

async function createPostgresTable({ connectionUrl, table, columns }) {
  if (!validIdent(table)) {
    throw Object.assign(new Error('Invalid table name'), { status: 400 });
  }
  if (!Array.isArray(columns) || columns.length === 0) {
    throw Object.assign(new Error('At least one column is required'), { status: 400 });
  }
  const defs = columns.map((c) => {
    if (!validIdent(c.name)) throw Object.assign(new Error(`Invalid column name: ${c.name}`), { status: 400 });
    if (!PG_COLUMN_TYPES.has(c.type)) throw Object.assign(new Error(`Invalid column type: ${c.type}`), { status: 400 });
    return `"${c.name}" ${c.type}`;
  });
  return withPg(connectionUrl, async (client) => {
    await client.query(`CREATE TABLE "${table}" (${defs.join(', ')})`);
    return { ok: true };
  });
}

async function dropPostgresTable({ connectionUrl, table }) {
  if (!validIdent(table)) {
    throw Object.assign(new Error('Invalid table name'), { status: 400 });
  }
  return withPg(connectionUrl, async (client) => {
    await client.query(`DROP TABLE IF EXISTS "${table}"`);
    return { ok: true };
  });
}

module.exports = {
  listMongoCollections,
  browseMongoCollection,
  updateMongoDocument,
  deleteMongoDocument,
  createMongoCollection,
  dropMongoCollection,
  listPostgresTables,
  browsePostgresTable,
  updatePostgresRow,
  deletePostgresRow,
  createPostgresTable,
  dropPostgresTable,
  PG_COLUMN_TYPES,
};
