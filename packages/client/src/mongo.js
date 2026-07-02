// CustomDBMongo — a thin caching wrapper around the official mongodb driver.
//
// Customer code looks like:
//   const db = new CustomDBMongo('customdb://USER:PASS@host:port/dbname');
//   const articles = await db.collection('articles').find({ topic }).toArray();
//
// Under the hood:
//   - parses the customdb:// URL, swaps it to mongodb://
//   - fetches Redis creds from /api/cache-config
//   - find/findOne/aggregate results are cached for ~60s
//   - insert/update/delete bump a per-collection "tag" so cached reads
//     for that collection become stale immediately

'use strict';

const { MongoClient } = require('mongodb');
const { parse } = require('./connectionString');
const { CacheLayer, hashQuery } = require('./cache');

// EJSON preserves ObjectId / Date / Binary etc. through the cache's string
// round-trip — with plain JSON a cache HIT would hand back `_id` as a hex
// string while a MISS returns a real ObjectId. Available in driver >= 5 via
// the re-exported BSON namespace; fall back to plain JSON if absent.
let ejsonSerializer = null;
try {
  const { BSON } = require('mongodb');
  if (BSON && BSON.EJSON) {
    ejsonSerializer = {
      stringify: (v) => BSON.EJSON.stringify(v, { relaxed: true }),
      parse: (s) => BSON.EJSON.parse(s, { relaxed: true }),
    };
  }
} catch { /* keep JSON fallback */ }

class CustomDBMongo {
  constructor(connectionString, options = {}) {
    const parsed = parse(connectionString);
    if (parsed.engine !== 'mongo') {
      throw new Error(`This connection string is for ${parsed.engine}; use CustomDBPostgres instead`);
    }
    this._parsed = parsed;
    this._cache = new CacheLayer({
      cacheConfigUrl: options.cacheConfigUrl || parsed.cacheConfigUrl,
      username: parsed.username,
      password: parsed.password,
      dbType: 'nosql',
      defaultTtl: options.defaultTtl,
      debug: options.debug,
      serializer: ejsonSerializer || undefined,
    });
    this._mongo = new MongoClient(parsed.driverUrl, options.mongoOptions || {});
    this._connectPromise = null;
  }

  async connect() {
    if (this._connectPromise) return this._connectPromise;
    // The cache connection is best-effort: if cache-config or Redis is down,
    // the SDK still works — every read just goes straight to Mongo (the
    // CacheLayer retries its connection in the background with a cooldown).
    // Only a Mongo connection failure is fatal here.
    this._connectPromise = Promise.all([
      this._mongo.connect(),
      this._cache.connect().catch(() => {}),
    ]).then(() => this);
    return this._connectPromise;
  }

  // Underlying mongodb Db handle (default db from the connection string,
  // or pass a name to switch). Use this for operations the wrapper doesn't
  // cover (createIndex, dropCollection, etc.) — these bypass the cache.
  db(name) {
    return this._mongo.db(name || this._parsed.dbName || undefined);
  }

  collection(name, options) {
    return new CachedCollection(this, name, options);
  }

  async close() {
    try { await this._mongo.close(); } catch {}
    await this._cache.disconnect();
  }

  // Manual cache control — most customers won't need these, but they're
  // useful when you've done a write via a path that bypassed the wrapper
  // (e.g., the raw driver) and need to nuke stale entries.
  async invalidateCollection(name) {
    await this._cache.bumpTag(`coll:${name}`);
  }
}

class CachedCollection {
  constructor(client, name, collectionOptions) {
    this._client = client;
    this._name = name;
    this._coll = client.db().collection(name, collectionOptions);
  }

  // The underlying mongodb collection, exposed in case the customer wants
  // a non-cached operation. Writes here bypass cache invalidation — call
  // client.invalidateCollection(name) manually if you do this.
  get raw() { return this._coll; }

  // -- CACHED READS ----------------------------------------------------

  async findOne(query, options) {
    return this._cached('findOne', { query, options }, () => this._coll.findOne(query, options));
  }

  // Returns an array, not a cursor — that's the trade-off for being cache-able.
  // Customers needing a cursor should use `.raw.find(...)`.
  async find(query, options = {}) {
    const { limit, skip, sort, projection } = options;
    return this._cached('find', { query, limit, skip, sort, projection }, async () => {
      let cursor = this._coll.find(query);
      if (projection) cursor = cursor.project(projection);
      if (sort) cursor = cursor.sort(sort);
      if (skip) cursor = cursor.skip(skip);
      if (limit) cursor = cursor.limit(limit);
      return cursor.toArray();
    });
  }

  async countDocuments(query, options) {
    return this._cached('count', { query, options }, () => this._coll.countDocuments(query, options));
  }

  async aggregate(pipeline, options) {
    return this._cached('agg', { pipeline, options }, () => this._coll.aggregate(pipeline, options).toArray());
  }

  // -- WRITES (bust the cache) -----------------------------------------

  async insertOne(doc, options) {
    const r = await this._coll.insertOne(doc, options);
    await this._bump();
    return r;
  }
  async insertMany(docs, options) {
    const r = await this._coll.insertMany(docs, options);
    await this._bump();
    return r;
  }
  async updateOne(filter, update, options) {
    const r = await this._coll.updateOne(filter, update, options);
    await this._bump();
    return r;
  }
  async updateMany(filter, update, options) {
    const r = await this._coll.updateMany(filter, update, options);
    await this._bump();
    return r;
  }
  async deleteOne(filter, options) {
    const r = await this._coll.deleteOne(filter, options);
    await this._bump();
    return r;
  }
  async deleteMany(filter, options) {
    const r = await this._coll.deleteMany(filter, options);
    await this._bump();
    return r;
  }
  async replaceOne(filter, replacement, options) {
    const r = await this._coll.replaceOne(filter, replacement, options);
    await this._bump();
    return r;
  }
  async findOneAndUpdate(filter, update, options) {
    const r = await this._coll.findOneAndUpdate(filter, update, options);
    await this._bump();
    return r;
  }
  async findOneAndDelete(filter, options) {
    const r = await this._coll.findOneAndDelete(filter, options);
    await this._bump();
    return r;
  }
  async findOneAndReplace(filter, replacement, options) {
    const r = await this._coll.findOneAndReplace(filter, replacement, options);
    await this._bump();
    return r;
  }

  // -- internals -------------------------------------------------------

  async _cached(op, payload, loader) {
    await this._client.connect();
    const tag = `coll:${this._name}`;
    const tagVersion = await this._client._cache.getTagVersion(tag);
    const key = `coll:${this._name}:v${tagVersion}:${op}:${hashQuery(payload)}`;
    return this._client._cache.getOrSet(key, undefined, loader);
  }

  async _bump() {
    await this._client._cache.bumpTag(`coll:${this._name}`);
  }
}

module.exports = { CustomDBMongo };
