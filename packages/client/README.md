# @customdb/client

Drop-in caching client for CustomDB. One connection string, transparent Redis caching, works with MongoDB and PostgreSQL.

## Install

```bash
# For MongoDB
npm install @customdb/client mongodb

# For PostgreSQL
npm install @customdb/client pg
```

## MongoDB

```js
const { CustomDBMongo } = require('@customdb/client');

const db = new CustomDBMongo(
  'customdb://USER:PASSWORD@m-xxxx.mongo.dbaas.innovativus.tech:27017/news_DB?tls=true&tlsAllowInvalidCertificates=true'
);

// Cached reads (~60s TTL by default)
const articles = await db.collection('articles').find({ published: true }).toArray();
const article = await db.collection('articles').findOne({ _id: '...' });
const count = await db.collection('articles').countDocuments({ topic: 'tech' });

// Writes — automatically invalidate the cache for that collection
await db.collection('articles').insertOne({ title: 'Hello' });
await db.collection('articles').updateOne({ _id }, { $set: { published: true } });

// Need the raw driver? Use .raw — bypasses cache
const cursor = db.collection('articles').raw.find({}).limit(10);
```

The connection string is the same one you got from CustomDB's dashboard, with `mongodb://` swapped to `customdb://`. The SDK handles cache config discovery automatically.

## PostgreSQL

```js
const { CustomDBPostgres } = require('@customdb/client');

const pg = new CustomDBPostgres({
  connectionString: 'customdb-pg://USER:PASSWORD@dbaas.innovativus.tech:5433/news_DB?sslmode=require'
});

// Cached SELECTs
const { rows } = await pg.query('SELECT * FROM articles WHERE published = $1', [true]);

// Writes — automatically invalidate cache for affected tables
await pg.query('UPDATE articles SET title = $1 WHERE id = $2', ['New', 42]);

// Raw query (no caching)
const { rows: stream } = await pg.raw('SELECT * FROM big_table');
```

## Connection string formats

| Engine     | Scheme            |
| ---------- | ----------------- |
| MongoDB    | `customdb://`     |
| PostgreSQL | `customdb-pg://`  |

Everything after the scheme is a standard URI — the SDK swaps the scheme back to `mongodb://` / `postgresql://` before handing it to the underlying driver.

## How the cache works

1. On first use, the SDK calls `GET /api/cache-config` on your CustomDB backend using HTTP Basic auth with your DB credentials.
2. The backend mints a **per-database Redis ACL user** that can only read/write keys matching `cdb:<your-db-id>:*`.
3. The SDK connects to Redis with these scoped credentials.
4. Reads check Redis first (sub-millisecond). On miss, fetch from the actual DB and cache for 60s.
5. Writes invalidate the relevant cache entries by bumping a per-collection/per-table version counter.

Customers don't share cache space, can't see each other's data, and don't need to know Redis exists.

## Configuration

```js
new CustomDBMongo(connectionString, {
  defaultTtl: 60,                      // seconds; default 60
  debug: true,                          // log cache hits/misses
  cacheConfigUrl: 'https://dbaas.innovativus.tech',  // override auto-detect
  mongoOptions: { /* passed to MongoClient */ },
});

new CustomDBPostgres({
  connectionString,
  defaultTtl: 60,
  debug: true,
  cacheConfigUrl: 'https://dbaas.innovativus.tech',
  poolOptions: { /* passed to pg.Pool */ },
});
```

## Cache invalidation

Writes through the SDK automatically invalidate. If you do a write outside the SDK (e.g. directly via the raw driver, or from another service), call:

```js
await db.invalidateCollection('articles');   // Mongo
await pg.invalidateTable('articles');         // Postgres
```

## Graceful degradation

If Redis is unreachable, every call falls through to the underlying DB. Performance degrades; correctness doesn't.
