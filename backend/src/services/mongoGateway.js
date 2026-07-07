// Shared-port Mongo gateway helpers.
//
// Every Mongo database is served through ONE public port: the client
// connects to a unique per-database hostname (m-<token>.<gateway domain>)
// and nginx routes by TLS SNI to the right container (see
// nginx/nginx.conf's $mongo_gateway_target map). The hostname is minted at
// provisioning time and PERSISTED on the database row's `host` column — it
// is not derivable, so treat the row as the source of truth.
//
// Requires a wildcard DNS record: *.<gateway domain> → VPS IP
// (default gateway domain is mongo.<VPS_HOST>).

const { randomToken } = require('./crypto');

function mongoGatewayEnabled() {
  return process.env.MONGO_GATEWAY_ENABLED !== 'false';
}

function mongoGatewayDomain() {
  const explicit = (process.env.MONGO_GATEWAY_DOMAIN || '').trim();
  if (explicit) return explicit.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
  const host = (process.env.VPS_HOST || 'localhost').replace(/\/+$/, '').toLowerCase();
  return `mongo.${host}`;
}

function mongoGatewayPort() {
  return Number(process.env.MONGO_GATEWAY_PORT) || 27017;
}

// Mint a fresh unique gateway hostname for a new (or migrated) database.
function mongoGatewayHost() {
  return `m-${randomToken(8).toLowerCase()}.${mongoGatewayDomain()}`;
}

function isNetworkRouted(db) {
  return db.routing === 'nginx' || db.routing === 'mongo-gateway';
}

module.exports = {
  mongoGatewayEnabled,
  mongoGatewayDomain,
  mongoGatewayPort,
  mongoGatewayHost,
  isNetworkRouted,
};
