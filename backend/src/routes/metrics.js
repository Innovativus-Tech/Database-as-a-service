// Unauthenticated operational endpoints from the PivotDB half.
//
//   GET /metrics       Prometheus exposition (Mongo + SQL gauges)
//   GET /health/live   liveness — process is up
//   GET /health/ready  readiness — metadata DB and Redis both answer
//
// Deliberately outside the dashboard CORS policy and the auth middleware:
// Prometheus scrapes /metrics server-side with no browser or token involved,
// and container orchestrators probe /health/* the same way. Neither exposes
// customer data — /metrics carries aggregate gauges only.
//
// CustomDB's own `/healthz` (liveness) and `/health` (deep check) stay exactly
// as they were; these add the paths the PivotDB compose healthchecks use.

const express = require('express');
const { createShimApp } = require('../pivot/adapter/fastify-express.js');
const { metricsRoutes } = require('../pivot/routes/metrics.js');
const { healthRoutes } = require('../pivot/routes/health.js');

const router = express.Router();

// No-op authenticate: none of these routes declare a preHandler.
const noAuth = async () => {};

for (const mod of [metricsRoutes, healthRoutes]) {
  const shim = createShimApp(noAuth);
  Promise.resolve(mod(shim)).catch((err) =>
    console.error(`[metrics] failed to register ${mod.name}:`, err.message));
  router.use(shim.router);
}

module.exports = router;
