// Worker-thread entry point for data imports.
//
// Imports run here — NOT on the main event loop — because parsing a large
// upload (JSON.parse on a 200 MB file, unzipping a mongodump archive) is
// CPU-bound and synchronous. When it ran on the main thread it froze the
// whole backend for the duration: /healthz stopped answering, Docker's
// healthcheck struck out, the container got restarted mid-import, and every
// dashboard session looked "logged out". In a worker, the main loop keeps
// serving auth + status polls while the import crunches.
const { parentPort, workerData } = require('worker_threads');
const { dispatchImport } = require('./dataImport');

dispatchImport({
  ...workerData,
  onProgress: (processed, total) => parentPort.postMessage({ type: 'progress', processed, total }),
})
  .then((result) => parentPort.postMessage({ type: 'done', result }))
  .catch((err) => parentPort.postMessage({
    type: 'error',
    message: err.message || 'Import failed',
    status: err.status || 500,
  }));
