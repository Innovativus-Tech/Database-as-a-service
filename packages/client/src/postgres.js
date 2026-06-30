// CustomDBPostgres — caching wrapper around `pg`.
//
//   const pg = new CustomDBPostgres({
//     connectionString: 'customdb-pg://USER:PASS@host:port/db?sslmode=require'
//   });
//   const { rows } = await pg.query('SELECT * FROM articles WHERE published = $1', [true]);
//
// Cached SELECTs are keyed by SQL text + parameter values + a per-table
// version counter. INSERT/UPDATE/DELETE on a table bumps the counter so
// every cached read against that table becomes stale instantly.
//
// SQL parsing: we use a small regex-based extractor for the common cases
// (single-table writes). It's intentionally conservative — anything it
// can't analyze cleanly is treated as "invalidate everything" by bumping
// a global tag. This trades some cache hit rate for correctness.

'use strict';

const { Pool } = require('pg');
const { parse } = require('./connectionString');
const { CacheLayer, hashQuery } = require('./cache');

class CustomDBPostgres {
  constructor(options) {
    if (typeof options === 'string') options = { connectionString: options };
    if (!options || !options.connectionString) {
      throw new Error('connectionString option is required');
    }

    const parsed = parse(options.connectionString);
    if (parsed.engine !== 'postgres') {
      throw new Error(`This connection string is for ${parsed.engine}; use CustomDBMongo instead`);
    }
    this._parsed = parsed;
    this._cache = new CacheLayer({
      cacheConfigUrl: options.cacheConfigUrl || parsed.cacheConfigUrl,
      username: parsed.username,
      password: parsed.password,
      dbType: 'sql',
      defaultTtl: options.defaultTtl,
      debug: options.debug,
    });

    // pg's TLS handling for self-signed certs needs an explicit ssl object;
    // sslmode=require alone gives different behavior between libpq and node-pg.
    const poolOptions = {
      connectionString: parsed.driverUrl,
      ssl: parsed.queryParams.sslmode === 'require'
        ? { rejectUnauthorized: false }
        : undefined,
      ...(options.poolOptions || {}),
    };
    this._pool = new Pool(poolOptions);
    this._connectPromise = null;
  }

  async connect() {
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = this._cache.connect().then(() => this);
    return this._connectPromise;
  }

  // Main entry point. `sql` is a SQL string; `params` is an array of
  // bound parameter values ($1, $2, ...).
  async query(sql, params) {
    await this.connect();
    const analysis = analyzeSql(sql);

    if (analysis.kind === 'select') {
      // Cache key includes the version of every table the SELECT reads from.
      // Bumping any of those tables invalidates this entry.
      const tagVersions = await Promise.all(
        analysis.tables.map((t) => this._cache.getTagVersion(`tbl:${t}`))
      );
      const versionSalt = tagVersions.join('|');
      const key = `sql:v${versionSalt}:${hashQuery({ sql, params: params || [] })}`;
      return this._cache.getOrSet(key, undefined, () => this._runRaw(sql, params));
    }

    // Write — execute first, then invalidate.
    const result = await this._runRaw(sql, params);
    await this._bumpForWrite(analysis);
    return result;
  }

  // Run the underlying pool.query without going through the cache. Useful
  // for streaming, transactions, etc.
  async raw(sql, params) {
    await this.connect();
    return this._runRaw(sql, params);
  }

  async _runRaw(sql, params) {
    return this._pool.query(sql, params);
  }

  async _bumpForWrite(analysis) {
    if (analysis.kind === 'unknown') {
      // Couldn't parse it confidently — wipe everything for safety.
      await this._cache.bumpTag('__all__');
      return;
    }
    for (const tbl of analysis.tables) {
      await this._cache.bumpTag(`tbl:${tbl}`);
    }
  }

  async invalidateTable(name) {
    await this._cache.bumpTag(`tbl:${name}`);
  }

  async close() {
    try { await this._pool.end(); } catch {}
    await this._cache.disconnect();
  }
}

// Light SQL classifier. Categorizes the statement and extracts the table
// names it touches. We only need this to be correct for "simple, common"
// SQL — anything fancy falls to 'unknown' and triggers global invalidation.
function analyzeSql(sql) {
  if (typeof sql !== 'string') return { kind: 'unknown', tables: [] };
  // Strip leading whitespace, comments
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();
  const head = stripped.slice(0, 10).toUpperCase();

  if (head.startsWith('SELECT') || head.startsWith('WITH ')) {
    const tables = extractTablesFromSelect(stripped);
    return { kind: 'select', tables };
  }

  // Write statements with a single primary target table
  const writePatterns = [
    /^INSERT\s+INTO\s+([a-zA-Z_][\w.]*)/i,
    /^UPDATE\s+(?:ONLY\s+)?([a-zA-Z_][\w.]*)/i,
    /^DELETE\s+FROM\s+(?:ONLY\s+)?([a-zA-Z_][\w.]*)/i,
    /^TRUNCATE\s+(?:TABLE\s+)?([a-zA-Z_][\w.]*)/i,
  ];
  for (const re of writePatterns) {
    const m = stripped.match(re);
    if (m) return { kind: 'write', tables: [normalizeTableName(m[1])] };
  }

  // DDL or anything else — assume worst case.
  return { kind: 'unknown', tables: [] };
}

// Pull table names out of a SELECT's FROM/JOIN clauses. Best-effort.
function extractTablesFromSelect(sql) {
  const tables = new Set();
  const re = /\b(?:FROM|JOIN)\s+([a-zA-Z_][\w.]*)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    tables.add(normalizeTableName(m[1]));
  }
  return [...tables];
}

function normalizeTableName(name) {
  // Drop schema prefix for cache key stability — UPDATE public.foo and
  // SELECT FROM foo (search_path=public) should hit the same cache tag.
  return name.toLowerCase().split('.').pop();
}

module.exports = { CustomDBPostgres, analyzeSql };
