// Public endpoints — single-port routing.
//
// Instead of publishing one host port per database (the old 27018-27117 /
// 5433-5532 ranges), every engine shares ONE public port:
//
//   Mongo:    each database gets a unique HOSTNAME under
//             *.mongo.<VPS_HOST> and nginx routes by TLS SNI to the right
//             container (same design as Atlas's cluster0.xxxxx.mongodb.net).
//             Requires a wildcard DNS record: *.mongo.<VPS_HOST> -> VPS IP.
//   Postgres: all databases share <VPS_HOST>:<PG_PUBLIC_PORT>; the backend's
//             pgGateway routes by the (globally unique) username in the
//             Postgres startup message, since PG's STARTTLS-style handshake
//             carries no SNI that nginx could route on.
//
// Defaults intentionally reuse the first ports of the old published ranges
// (27018 / 5433) so an upgraded deployment can't collide with anything else
// on the host. Override with MONGO_PUBLIC_PORT / PG_PUBLIC_PORT.

function mongoPublicPort() {
  return Number(process.env.MONGO_PUBLIC_PORT) || 27018;
}

function pgPublicPort() {
  return Number(process.env.PG_PUBLIC_PORT) || 5433;
}

// DNS-safe, human-readable, collision-free (8-hex id suffix) subdomain label.
// dbName may contain underscores/uppercase which are not valid in hostnames.
function mongoSniLabel(db) {
  const namePart = db.dbName.toLowerCase().replace(/_/g, '-');
  const idPart = db.id.replace(/-/g, '').slice(0, 8);
  return `${namePart}-${idPart}`;
}

function mongoSniHost(db) {
  const root = process.env.VPS_HOST || 'localhost';
  return `${mongoSniLabel(db)}.mongo.${root}`;
}

// The public host+port a customer connects to for a given database row.
function publicEndpoint(db) {
  if (db.type === 'nosql') {
    return { host: mongoSniHost(db), port: mongoPublicPort() };
  }
  return { host: process.env.VPS_HOST || 'localhost', port: pgPublicPort() };
}

function enc(s) {
  return encodeURIComponent(s);
}

// Mongo with self-signed TLS: tls=true gives encryption; tlsAllowInvalidCertificates
// skips identity verification (cert is self-signed, no CA chain to validate against).
// Connection is still encrypted in transit — equivalent to Atlas's "tls=true" but
// without the cert-pinning guarantee.
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

module.exports = {
  generateMongoURL,
  generatePostgresURL,
  generateConnectionURL,
  publicEndpoint,
  mongoSniHost,
  mongoSniLabel,
  mongoPublicPort,
  pgPublicPort,
};
