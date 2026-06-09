function enc(s) {
  return encodeURIComponent(s);
}

function generateMongoURL({ host, port, username, password, dbName }) {
  return `mongodb://${enc(username)}:${enc(password)}@${host}:${port}/${enc(dbName)}?authSource=admin`;
}

function generatePostgresURL({ host, port, username, password, dbName }) {
  return `postgresql://${enc(username)}:${enc(password)}@${host}:${port}/${enc(dbName)}`;
}

function generateConnectionURL(type, parts) {
  if (type === 'nosql') return generateMongoURL(parts);
  if (type === 'sql')   return generatePostgresURL(parts);
  throw new Error(`Unknown database type: ${type}`);
}

module.exports = { generateMongoURL, generatePostgresURL, generateConnectionURL };
