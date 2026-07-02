const { MongoClient, ObjectId } = require('mongodb');
const { Client: PgClient, Pool: PgPool } = require('pg');

// Per-URL connection-pool reuse.
//
// Before this, every call to listMongoCollections / browseMongoCollection /
// etc. created a fresh MongoClient (or new PgClient), did a TCP handshake +
// auth, ran the query, and closed. The dashboard polls these endpoints from
// multiple panels in parallel on every page navigation — each navigation
// burned through ~10 handshakes per user DB, exhausting connection capacity
// at the user DB AND making each backend request ~50-100ms slower than it
// needed to be.
//
// Now: one shared MongoClient and one shared pg Pool per (URL) key,
// kept alive for the process lifetime. Connections inside each client/pool
// are still automatically managed by the driver.

const mongoClients = new Map(); // url -> MongoClient (already connected)
const pgPools      = new Map(); // url -> pg Pool

function getMongoClient(connectionUrl) {
  let client = mongoClients.get(connectionUrl);
  if (client) return client;
  client = new MongoClient(connectionUrl, {
    serverSelectionTimeoutMS: 5000,
    // The mongodb driver keeps an internal connection pool; we don't need
    // to do anything to "reuse" — just keep one client around per URL.
    maxPoolSize: 10,
    minPoolSize: 0,
  });
  // connect() is idempotent on the same client — first call opens, subsequent
  // ones are no-ops. We don't await here; the next driver op will await it.
  client.connect().catch((err) => {
    console.warn('[mongo] connect deferred for', connectionUrl.replace(/:[^:@/]+@/, ':***@'), '-', err.message);
  });
  mongoClients.set(connectionUrl, client);
  return client;
}

function getPgPool(connectionUrl) {
  let pool = pgPools.get(connectionUrl);
  if (pool) return pool;
  pool = new PgPool({
    connectionString: connectionUrl,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 60_000, // recycle idle conns after a minute
    max: 5,                    // cap per-user-DB connections from this process
  });
  pool.on('error', (err) => {
    console.warn('[pg pool] background error for', connectionUrl.replace(/:[^:@/]+@/, ':***@'), '-', err.code || err.message);
  });
  pgPools.set(connectionUrl, pool);
  return pool;
}

// MongoDB ──────────────────────────────────────────────────────────────────────

async function withMongo(connectionUrl, fn) {
  const client = getMongoClient(connectionUrl);
  await client.connect(); // idempotent on already-connected client
  return fn(client);
}

const MONGO_SYSTEM_DBS = new Set(['admin', 'config', 'local']);

async function listMongoDatabases(connectionUrl) {
  return withMongo(connectionUrl, async (client) => {
    const { databases } = await client.db().admin().listDatabases({ nameOnly: true });
    return databases
      .map((d) => d.name)
      .filter((name) => !MONGO_SYSTEM_DBS.has(name))
      .sort();
  });
}

// Mongo only materializes a database once it has at least one real collection
// in it, so "creating" one means creating its first collection in the same step.
async function createMongoDatabase(connectionUrl, dbName, firstCollection) {
  return withMongo(connectionUrl, async (client) => {
    await client.db(dbName).createCollection(firstCollection);
    return { ok: true };
  });
}

async function dropMongoDatabase(connectionUrl, dbName) {
  return withMongo(connectionUrl, async (client) => {
    await client.db(dbName).dropDatabase();
    return { ok: true };
  });
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

// The browse filter arrives as plain JSON, which can't express ObjectId — so
// a filter like {"_id": "665f1c..."} would never match documents whose _id is
// a real ObjectId. Coerce 24-hex _id strings (including inside $in/$eq/$ne)
// the way Compass/Atlas do.
function coerceMongoFilterIds(filter) {
  if (!filter || typeof filter !== 'object' || !('_id' in filter)) return filter;
  const coerce = (v) => (typeof v === 'string' ? toMongoId(v) : v);
  const idVal = filter._id;
  let coerced = idVal;
  if (typeof idVal === 'string') {
    coerced = coerce(idVal);
  } else if (idVal && typeof idVal === 'object' && !Array.isArray(idVal)) {
    coerced = { ...idVal };
    for (const op of ['$eq', '$ne']) {
      if (typeof coerced[op] === 'string') coerced[op] = coerce(coerced[op]);
    }
    for (const op of ['$in', '$nin']) {
      if (Array.isArray(coerced[op])) coerced[op] = coerced[op].map(coerce);
    }
  }
  return { ...filter, _id: coerced };
}

async function browseMongoCollection({ connectionUrl, dbName, collection, skip = 0, limit = 50, filter = {} }) {
  return withMongo(connectionUrl, async (client) => {
    const col = client.db(dbName).collection(collection);
    const query = coerceMongoFilterIds(filter);
    const [rows, total] = await Promise.all([
      col.find(query).skip(skip).limit(limit).toArray(),
      col.countDocuments(query),
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

function qualify(schema, table) { return `"${schema}"."${table}"`; }

async function withPg(connectionUrl, fn) {
  // Use a pooled client — the pool handles connect/release automatically.
  // `client` here is a PoolClient with the same API as a Client.
  const pool = getPgPool(connectionUrl);
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

const PG_SYSTEM_SCHEMAS_RE = /^(pg_catalog|information_schema|pg_toast|pg_temp_\d+|pg_toast_temp_\d+)$/;

async function listPostgresSchemas(connectionUrl) {
  return withPg(connectionUrl, async (client) => {
    const { rows } = await client.query(
      `SELECT schema_name FROM information_schema.schemata
        WHERE schema_name !~ $1
        ORDER BY schema_name`,
      [PG_SYSTEM_SCHEMAS_RE.source]
    );
    return rows.map((r) => r.schema_name);
  });
}

async function createPostgresSchema(connectionUrl, schema) {
  if (!validIdent(schema)) {
    throw Object.assign(new Error('Invalid schema name'), { status: 400 });
  }
  return withPg(connectionUrl, async (client) => {
    await client.query(`CREATE SCHEMA "${schema}"`);
    return { ok: true };
  });
}

async function dropPostgresSchema(connectionUrl, schema) {
  if (!validIdent(schema)) {
    throw Object.assign(new Error('Invalid schema name'), { status: 400 });
  }
  return withPg(connectionUrl, async (client) => {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    return { ok: true };
  });
}

async function listPostgresTables({ connectionUrl, schema = 'public' }) {
  return withPg(connectionUrl, async (client) => {
    const sql = `
      SELECT c.relname AS name,
             c.reltuples::bigint AS estimated_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname = $1
      ORDER BY c.relname;`;
    const { rows } = await client.query(sql, [schema]);

    // reltuples is -1 until ANALYZE runs. For freshly-imported tables that's
    // almost always the case, so fall back to a real COUNT(*) per table.
    const out = [];
    for (const r of rows) {
      let count = Number(r.estimated_count);
      if (count < 0) {
        const exact = await client.query(`SELECT COUNT(*)::bigint AS c FROM ${qualify(schema, r.name)}`);
        count = Number(exact.rows[0].c);
      }
      out.push({ name: r.name, count });
    }
    return out;
  });
}

async function browsePostgresTable({ connectionUrl, schema = 'public', table, skip = 0, limit = 50 }) {
  if (!validIdent(schema) || !validIdent(table)) {
    throw Object.assign(new Error('Invalid schema or table name'), { status: 400 });
  }
  return withPg(connectionUrl, async (client) => {
    const colsRes = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema=$1 AND table_name=$2
        ORDER BY ordinal_position`,
      [schema, table]
    );
    if (colsRes.rows.length === 0) {
      throw Object.assign(new Error('Table not found'), { status: 404 });
    }
    const columns = colsRes.rows.map((r) => r.column_name);

    const countRes = await client.query(`SELECT COUNT(*)::bigint AS c FROM ${qualify(schema, table)}`);
    const total = Number(countRes.rows[0].c);

    // ctid (physical row id) lets the client edit/delete a specific row even
    // though most tables here have no declared primary key. It's only stable
    // for the lifetime of this page load (an UPDATE/VACUUM can change it).
    const rowsRes = await client.query(
      `SELECT *, ctid::text AS "__ctid" FROM ${qualify(schema, table)} LIMIT $1 OFFSET $2`,
      [Math.min(limit, 500), skip]
    );
    return { total, skip, limit, columns, rows: rowsRes.rows };
  });
}

async function updatePostgresRow({ connectionUrl, schema = 'public', table, ctid, values }) {
  if (!validIdent(schema) || !validIdent(table)) {
    throw Object.assign(new Error('Invalid schema or table name'), { status: 400 });
  }
  return withPg(connectionUrl, async (client) => {
    const colsRes = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2`,
      [schema, table]
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
      `UPDATE ${qualify(schema, table)} SET ${setSql} WHERE ctid = $${params.length}::tid`,
      params
    );
    if (result.rowCount === 0) throw Object.assign(new Error('Row not found'), { status: 404 });
    return { ok: true };
  });
}

async function deletePostgresRow({ connectionUrl, schema = 'public', table, ctid }) {
  if (!validIdent(schema) || !validIdent(table)) {
    throw Object.assign(new Error('Invalid schema or table name'), { status: 400 });
  }
  return withPg(connectionUrl, async (client) => {
    const result = await client.query(`DELETE FROM ${qualify(schema, table)} WHERE ctid = $1::tid`, [ctid]);
    if (result.rowCount === 0) throw Object.assign(new Error('Row not found'), { status: 404 });
    return { ok: true };
  });
}

const PG_COLUMN_TYPES = new Set(['text', 'integer', 'bigint', 'boolean', 'timestamptz', 'numeric', 'double precision', 'jsonb']);

async function createPostgresTable({ connectionUrl, schema = 'public', table, columns }) {
  if (!validIdent(schema) || !validIdent(table)) {
    throw Object.assign(new Error('Invalid schema or table name'), { status: 400 });
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
    await client.query(`CREATE TABLE ${qualify(schema, table)} (${defs.join(', ')})`);
    return { ok: true };
  });
}

async function dropPostgresTable({ connectionUrl, schema = 'public', table }) {
  if (!validIdent(schema) || !validIdent(table)) {
    throw Object.assign(new Error('Invalid schema or table name'), { status: 400 });
  }
  return withPg(connectionUrl, async (client) => {
    await client.query(`DROP TABLE IF EXISTS ${qualify(schema, table)}`);
    return { ok: true };
  });
}

// Drop any cached connections pointing at a given container host. Call this
// when a user database is deleted so background reconnect attempts don't
// keep retrying forever against a container that's been removed.
// Matches by hostname inside the URL (credentials/db-name vary, host doesn't).
async function evictPoolsForHost(hostname) {
  if (!hostname) return;
  const hostMatch = (url) => {
    try { return new URL(url).hostname === hostname; } catch { return false; }
  };
  for (const [url, client] of mongoClients) {
    if (hostMatch(url)) {
      mongoClients.delete(url);
      client.close().catch(() => {});
    }
  }
  for (const [url, pool] of pgPools) {
    if (hostMatch(url)) {
      pgPools.delete(url);
      pool.end().catch(() => {});
    }
  }
}

module.exports = {
  listMongoDatabases,
  createMongoDatabase,
  dropMongoDatabase,
  listMongoCollections,
  browseMongoCollection,
  updateMongoDocument,
  deleteMongoDocument,
  createMongoCollection,
  dropMongoCollection,
  listPostgresSchemas,
  createPostgresSchema,
  dropPostgresSchema,
  listPostgresTables,
  browsePostgresTable,
  updatePostgresRow,
  deletePostgresRow,
  createPostgresTable,
  dropPostgresTable,
  evictPoolsForHost,
  PG_COLUMN_TYPES,
};
