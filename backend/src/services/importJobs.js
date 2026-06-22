const crypto = require('crypto');

// In-memory job store. A single backend process is the whole deployment here,
// so this is fine — jobs don't need to survive a restart, and the dashboard
// only ever polls a job right after starting it.
const jobs = new Map();

function createJob() {
  const id = crypto.randomUUID();
  jobs.set(id, {
    id,
    status: 'running', // running | done | error
    processed: 0,
    total: null, // null = indeterminate (archive-based imports don't report row counts)
    startedAt: Date.now(),
    result: null,
    error: null,
  });
  return id;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (job) Object.assign(job, patch);
}

function scheduleCleanup(id, ms = 10 * 60 * 1000) {
  const t = setTimeout(() => jobs.delete(id), ms);
  if (t.unref) t.unref();
}

module.exports = { createJob, getJob, updateJob, scheduleCleanup };
