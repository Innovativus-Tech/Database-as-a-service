function enc(s) {
  return encodeURIComponent(s);
}

// Mongo with self-signed TLS: tls=true gives encryption; tlsAllowInvalidCertificates
// skips identity verification (cert is self-signed, no CA chain to validate against).
// Connection is still encrypted in transit — equivalent to Atlas's "tls=true" but
// without the cert-pinning guarantee.
//
// Host/port for PUBLIC URLs come from the database row: Mongo rows store
// their unique gateway hostname (m-xxxx.mongo.<domain>, all sharing one
// public port via nginx SNI routing); Postgres rows use VPS_HOST with the
// shared pgGateway port (see routes/databases.js publicPort()).
function generateMongoURL({ host, port, username, password, dbName, tls = false }) {
  const tlsParams = tls ? '&tls=true&tlsAllowInvalidCertificates=true' : '';
  return `mongodb://${enc(username)}:${enc(password)}@${host}:${port}/${enc(dbName)}?authSource=admin${tlsParams}`;
}

// Postgres sslmode=require: encrypts in transit, doesn't verify the server cert
// (correct mode for a self-signed cert). Use sslmode=verify-full only when
// you've issued a CA-signed cert and distributed the CA to clients.
function generatePostgresURL({ host, port, username, password, dbName, tls = false }) {
  const sslParam = tls ? '?sslmode=require' : '';
  return `postgresql://${enc(username)}:${enc(password)}@${host}:${port}/${enc(dbName)}${sslParam}`;
}

function generateConnectionURL(type, parts) {
  if (type === 'nosql') return generateMongoURL(parts);
  if (type === 'sql')   return generatePostgresURL(parts);
  throw new Error(`Unknown database type: ${type}`);
}

module.exports = { generateMongoURL, generatePostgresURL, generateConnectionURL };
