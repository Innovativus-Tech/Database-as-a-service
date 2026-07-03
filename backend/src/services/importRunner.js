const path = require('path');
const { Worker } = require('worker_threads');

// Spawns importWorker.js and resolves with the import result. Progress
// messages stream back via onProgress so the job store (and the dashboard's
// poll) sees live counts while the worker does the heavy lifting.
function runImport(args, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'importWorker.js'), {
      workerData: args,
      // Heap ceiling for the import itself. Without this, a pathological
      // file could balloon the worker until the kernel OOM-kills the WHOLE
      // backend container (taking every user's dashboard session with it).
      // With it, only the worker dies and the job reports a clean error.
      resourceLimits: {
        maxOldGenerationSizeMb: 1536,
        maxYoungGenerationSizeMb: 128,
      },
    });

    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    worker.on('message', (msg) => {
      if (msg.type === 'progress') {
        onProgress?.(msg.processed, msg.total);
      } else if (msg.type === 'done') {
        settle(resolve, msg.result);
      } else if (msg.type === 'error') {
        settle(reject, Object.assign(new Error(msg.message), { status: msg.status }));
      }
    });
    worker.on('error', (err) => settle(reject, err));
    worker.on('exit', (code) => {
      // A non-zero exit without a prior done/error message usually means the
      // worker was OOM-killed or crashed hard mid-parse.
      if (code !== 0) settle(reject, new Error(`Import worker exited unexpectedly (code ${code}) — the file may be too large to process`));
    });
  });
}

module.exports = { runImport };
