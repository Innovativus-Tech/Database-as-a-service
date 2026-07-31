// Mounts the ported PivotDB API onto the CustomDB Express app.
//
// Every route here is authenticated by CustomDB's own session middleware and
// scoped to the caller's workspace by the profile bridge — that pairing is
// what makes "log in once, get every feature" true. A user who signs in to the
// dashboard can immediately hit /api/migration-v2 or /api/backup with the same
// token they use for /api/databases.
//
// URL prefixes are kept identical to the standalone PivotDB server so the
// ported frontend pages need no endpoint rewrites.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { attachProfile } = require('../services/profileBridge');
const { createShimApp } = require('../pivot/adapter/fastify-express.js');

const { connectionRoutes } = require('../pivot/routes/connections.js');
const { exploreRoutes } = require('../pivot/routes/explore.js');
const { monitorRoutes } = require('../pivot/routes/monitor.js');
const { exportRoutes } = require('../pivot/routes/export.js');
const { cdcSyncRoutes } = require('../pivot/routes/cdc-sync.js');
const { backupRoutes } = require('../pivot/routes/backup.js');
const { alertRoutes } = require('../pivot/routes/alerts.js');
const { migrationRoutes } = require('../pivot/routes/migration.js');
const { migrationV2Routes } = require('../pivot/routes/migration-v2.js');

/**
 * The `authenticate` preHandler handed to ported routes as `app.authenticate`.
 *
 * Bridges Express-style (req, res, next) middleware into the shim's
 * (req, reply) contract, and runs both steps every ported route needs:
 * verify the CustomDB session, then resolve the caller's workspace id.
 */
function makeAuthenticate() {
  const run = (mw, req, res) =>
    new Promise((resolve, reject) => {
      mw(req, res, (err) => (err ? reject(err) : resolve()));
    });

  return async function authenticate(req, reply) {
    // requireAuth writes a 401 directly on the response when the token is bad;
    // the shim notices `reply.sent` and aborts the chain, matching Fastify.
    await run(requireAuth, req, req.res);
    if (req.res.headersSent) return;
    await run(attachProfile, req, req.res);

    // PivotDB handlers read `user.userId` and `user.profileId`; CustomDB's
    // middleware populates `user.id`. Mirror both so neither half needs edits.
    if (req.user) {
      req.user.userId = req.user.id;
      req.user.profileId = req.profileId;
    }
  };
}

/**
 * Build a router for one ported route module.
 *
 * The module is an `async (app) => {...}` function, but every statement that
 * registers a route runs synchronously before its first await — so the router
 * is fully populated by the time this returns. We still attach a catch so a
 * genuine failure surfaces instead of becoming an unhandled rejection.
 */
function mount(routeModule, authenticate, io) {
  const shim = createShimApp(authenticate);
  if (io) shim.io = io;
  Promise.resolve(routeModule(shim)).catch((err) => {
    console.error(`[pivot] failed to register ${routeModule.name}:`, err.message);
  });
  return shim.router;
}

/**
 * @param {import('socket.io').Server} [io] Socket.IO server for live monitoring
 * @returns {import('express').Router}
 */
function createPivotRouter(io) {
  const authenticate = makeAuthenticate();
  const router = express.Router();

  // Three modules share the /connections prefix upstream (CRUD, schema
  // exploration, and monitoring all hang off a connection id). Express runs
  // them in order and falls through on no match, so the layout is preserved.
  router.use('/connections', mount(connectionRoutes, authenticate, io));
  router.use('/connections', mount(exploreRoutes, authenticate, io));
  router.use('/connections', mount(monitorRoutes, authenticate, io));

  router.use('/export', mount(exportRoutes, authenticate, io));
  router.use('/cdc-sync', mount(cdcSyncRoutes, authenticate, io));
  router.use('/backup', mount(backupRoutes, authenticate, io));
  router.use('/alerts', mount(alertRoutes, authenticate, io));
  router.use('/migration', mount(migrationRoutes, authenticate, io));
  router.use('/migration-v2', mount(migrationV2Routes, authenticate, io));

  return router;
}

module.exports = { createPivotRouter };
