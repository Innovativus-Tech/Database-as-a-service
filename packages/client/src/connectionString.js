// Parses CustomDB connection strings into pieces the SDK uses:
//   customdb://USER:PASS@HOST:PORT/DBNAME[?queryParams]      → Mongo
//   customdb-pg://USER:PASS@HOST:PORT/DBNAME[?queryParams]   → Postgres
//
// The "customdb" scheme is intentional — it tells the SDK to do its caching
// work. If the user passed a plain mongodb:// URL the SDK would still connect,
// but wouldn't know how to reach /api/cache-config (no separate cache host),
// so we require the customdb scheme to enable caching mode.

'use strict';

const CUSTOMDB_MONGO_SCHEME = 'customdb:';
const CUSTOMDB_PG_SCHEME = 'customdb-pg:';

function parse(connectionString) {
  if (typeof connectionString !== 'string' || !connectionString) {
    throw new TypeError('Connection string is required');
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch (err) {
    throw new Error(`Invalid connection string: ${err.message}`);
  }

  let engine;
  if (url.protocol === CUSTOMDB_MONGO_SCHEME) engine = 'mongo';
  else if (url.protocol === CUSTOMDB_PG_SCHEME) engine = 'postgres';
  else {
    throw new Error(
      `Unsupported scheme "${url.protocol}". Use customdb:// for Mongo or customdb-pg:// for Postgres.`
    );
  }

  if (!url.username || !url.password) {
    throw new Error('Connection string must include username and password');
  }
  if (!url.hostname) {
    throw new Error('Connection string must include a host');
  }

  // Database name is the URL path with leading "/" stripped. Optional for
  // Mongo (you can switch dbs at runtime), required for Postgres.
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, '')) || null;
  if (engine === 'postgres' && !dbName) {
    throw new Error('Postgres connection string must include /databaseName');
  }

  // The cache-config endpoint lives behind the dashboard/API origin. The
  // frontend proxies /api/* to the backend, so the public dashboard host is a
  // valid cache-config base and avoids requiring a separate API subdomain.
  // Conventions:
  //   dbaas.<rest>:27018              → dbaas.<rest>
  //   m-xxxx.mongo.dbaas.<rest>:27017 → dbaas.<rest>
  // If we can't reliably guess, customer can override with cacheConfigUrl option.
  const cacheConfigUrl = guessCacheConfigUrl(url.hostname);

  // Build the *real* engine connection string (mongodb:// or postgresql://)
  // by swapping the scheme. Strip our custom customdb:// scheme so we hand a
  // standard URL to the underlying driver.
  const driverUrl = buildDriverUrl(engine, url);

  return {
    engine,
    driverUrl,
    cacheConfigUrl,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: url.hostname,
    port: url.port ? Number(url.port) : (engine === 'mongo' ? 27017 : 5432),
    dbName,
    queryParams: Object.fromEntries(url.searchParams),
  };
}

function guessCacheConfigUrl(host) {
  // Heuristic: dbaas.innovativus.tech → https://dbaas.innovativus.tech
  //            m-xxxx.mongo.dbaas.innovativus.tech → https://dbaas.innovativus.tech
  // Works for the standard CustomDB convention. If the customer has set
  // up a different topology, they pass { cacheConfigUrl } to the client.
  const mongoGatewayMatch = host.match(/^[^.]+\.mongo\.(.+)$/);
  if (mongoGatewayMatch) return `https://${mongoGatewayMatch[1]}`;
  if (host.startsWith('api.')) return `https://${host}`;
  if (host.startsWith('dbaas.')) return `https://${host}`;
  // Fallback: assume the same host serves /api via a proxy. Customer can override.
  return `https://${host}`;
}

function buildDriverUrl(engine, url) {
  // Reconstruct the URL for the underlying driver:
  //   Mongo:    mongodb://user:pass@host:port/db?tls=true&...
  //   Postgres: postgresql://user:pass@host:port/db?sslmode=require&...
  const auth = `${url.username}:${url.password}`;
  const hostPort = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  const path = url.pathname || '/';
  const search = url.search || '';
  if (engine === 'mongo') {
    return `mongodb://${auth}@${hostPort}${path}${search}`;
  }
  return `postgresql://${auth}@${hostPort}${path}${search}`;
}

module.exports = { parse };
