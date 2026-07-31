// Connection auto-registration — the payoff of merging the two products.
//
// Every database CustomDB provisions is mirrored into a `Connection` row, the
// unit the ported PivotDB engine operates on. The moment a user clicks
// "Create database", that database is already usable in Explore, Migrate,
// Sync, Protect (backup/restore), Monitor and Alerts. No copy-pasting a
// connection string into a second screen, no second credential to manage.
//
// Design notes
// ────────────
// * The stored URI is the INTERNAL one (container name on customdb-network,
//   plaintext), not the customer-facing gateway URL. The engine and its BullMQ
//   workers run inside the backend container, so the internal hop is both
//   faster and more reliable than going back out through the nginx TLS/SNI
//   gateway or the pgGateway. It never leaves the private network.
//
// * Managed connections are marked `managed: true`. The API refuses to let a
//   user edit or delete them directly — their lifetime is owned by the
//   database they mirror. Deleting the database deletes the connection.
//
// * Everything here is idempotent and best-effort. Auto-registration must
//   never be able to fail a provisioning request: a database that exists
//   without its mirror is a degraded state the boot-time backfill repairs,
//   whereas a failed provision is a user-visible error.

const prisma = require('../prisma');
const { decrypt } = require('./crypto');
const { encrypt: encryptUri } = require('../pivot/crypto/encrypt.js');
const { generateConnectionURL } = require('./urlGenerator');
const { ensureProfileForUser } = require('./profileBridge');

/** CustomDB's `DatabaseType` → PivotDB's `Connection.dbType`. */
function pivotDbType(type) {
  return type === 'nosql' ? 'mongodb' : 'postgres';
}

/** Container-internal port for an engine (what the container itself listens on). */
function internalPort(type) {
  return type === 'nosql' ? 27017 : 5432;
}

/**
 * Build the URI the engine should use to reach a provisioned database.
 *
 * Prefers the private-network container address. Falls back to the public
 * gateway URL for legacy rows that predate network routing and therefore have
 * no container name.
 */
function buildEngineUri(db, cred) {
  const password = decrypt(cred.passwordEncrypted);
  if (db.containerName) {
    return generateConnectionURL(db.type, {
      host: db.containerName,
      port: internalPort(db.type),
      username: cred.username,
      password,
      dbName: db.dbName,
      tls: false,
    });
  }
  return generateConnectionURL(db.type, {
    host: db.host,
    port: db.port,
    username: cred.username,
    password,
    dbName: db.dbName,
    tls: !!db.tlsEnabled,
  });
}

/**
 * Create or refresh the managed Connection mirroring a provisioned database.
 *
 * Idempotent: safe to call on create, on restart, on credential rotation, and
 * from the boot backfill. Returns the connection id, or null if the database
 * isn't in a mirrorable state.
 *
 * @param {string} databaseId
 * @returns {Promise<string|null>}
 */
async function syncConnectionForDatabase(databaseId) {
  const db = await prisma.database.findUnique({
    where: { id: databaseId },
    include: { credentials: true, user: { select: { id: true, email: true } } },
  });
  if (!db || db.status === 'deleted') return null;

  const cred = db.credentials[0];
  if (!cred) return null;

  const profileId = await ensureProfileForUser(db.userId);
  const uri = buildEngineUri(db, cred);

  // Existing mirror → refresh the URI in place (credentials or host may have
  // changed) and keep the same connection id, so any backup jobs, alert rules
  // or sync jobs the user already attached to it survive.
  if (db.connectionId) {
    const existing = await prisma.connection.findUnique({ where: { id: db.connectionId } });
    if (existing) {
      await prisma.connection.update({
        where: { id: db.connectionId },
        data: {
          name: db.dbName,
          encryptedUri: encryptUri(uri),
          dbType: pivotDbType(db.type),
          profileId,
          managed: true,
        },
      });
      return db.connectionId;
    }
    // Pointer dangles (connection deleted out from under us) — fall through
    // and mint a fresh one.
  }

  const conn = await prisma.connection.create({
    data: {
      name: db.dbName,
      encryptedUri: encryptUri(uri),
      dbType: pivotDbType(db.type),
      topology: 'standalone',
      tags: ['provisioned'],
      readOnly: false,
      createdBy: db.user?.email || db.userId,
      profileId,
      managed: true,
    },
    select: { id: true },
  });

  await prisma.database.update({
    where: { id: db.id },
    data: { connectionId: conn.id },
  });

  return conn.id;
}

/**
 * Drop the managed Connection for a database that's being deleted.
 *
 * Cascades in the schema take care of the dependent jobs/rules; we pause CDC
 * syncs first so their workers stop tailing an endpoint that's going away.
 */
async function removeConnectionForDatabase(databaseId) {
  const db = await prisma.database.findUnique({
    where: { id: databaseId },
    select: { connectionId: true },
  });
  if (!db?.connectionId) return;

  const id = db.connectionId;
  await prisma.cdcSyncJob
    .updateMany({
      where: { OR: [{ sourceConnId: id }, { destConnId: id }] },
      data: { enabled: false, pauseRequested: true },
    })
    .catch(() => {});
  await prisma.database
    .update({ where: { id: databaseId }, data: { connectionId: null } })
    .catch(() => {});
  await prisma.connection.delete({ where: { id } }).catch(() => {});
}

/**
 * Boot-time reconciliation.
 *
 * Mirrors any active database that has no managed Connection yet — which is
 * every database provisioned before this merge, plus any whose registration
 * failed at create time. Runs in the background on startup; never fatal.
 *
 * @returns {Promise<number>} how many connections were created or repaired
 */
async function backfillManagedConnections() {
  const rows = await prisma.database.findMany({
    where: { status: 'active', connectionId: null },
    select: { id: true, dbName: true },
  });

  let synced = 0;
  for (const row of rows) {
    try {
      if (await syncConnectionForDatabase(row.id)) synced++;
    } catch (err) {
      console.warn(`[connection-sync] ${row.dbName}: ${err.message}`);
    }
  }
  return synced;
}

module.exports = {
  syncConnectionForDatabase,
  removeConnectionForDatabase,
  backfillManagedConnections,
  buildEngineUri,
  pivotDbType,
};
