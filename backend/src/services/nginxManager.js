const fs = require('fs');
const path = require('path');
const util = require('util');
const { execFile } = require('child_process');

const execFileP = util.promisify(execFile);

function streamDir() {
  return process.env.NGINX_STREAM_DIR || path.resolve(__dirname, '../../../nginx/stream.d');
}

function nginxContainer() {
  return process.env.NGINX_CONTAINER || 'customdb-nginx';
}

function configPath(port) {
  return path.join(streamDir(), `customdb-${port}.conf`);
}

function blockText({ port, containerName, internalPort }) {
  return `# customdb stream block for port ${port}
server {
  listen ${port};
  proxy_pass ${containerName}:${internalPort};
  proxy_connect_timeout 5s;
  proxy_timeout 1h;
}
`;
}

function ensureStreamDir() {
  fs.mkdirSync(streamDir(), { recursive: true });
}

async function addStreamBlock({ port, containerName, internalPort }) {
  ensureStreamDir();
  await fs.promises.writeFile(configPath(port), blockText({ port, containerName, internalPort }), 'utf8');
}

async function removeStreamBlock(port) {
  await fs.promises.unlink(configPath(port)).catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  });
}

// Best-effort reload — succeeds silently if nginx isn't running locally.
async function reloadNginx() {
  try {
    const { stderr } = await execFileP('docker', ['exec', nginxContainer(), 'nginx', '-s', 'reload']);
    return { reloaded: true, stderr };
  } catch (err) {
    // If the container doesn't exist (Phase 7 dev without nginx running yet), that's OK.
    if (/No such container/i.test(err.stderr || err.message)) {
      console.warn(`[nginx] container ${nginxContainer()} not running; config written but not reloaded`);
      return { reloaded: false, reason: 'no-nginx-container' };
    }
    throw err;
  }
}

// Rebuild every stream config from current meta DB state. Useful on backend boot
// in case the nginx volume is fresh or the meta DB is out of sync.
async function syncFromDatabaseRows(rows) {
  ensureStreamDir();
  // Wipe existing customdb-*.conf files we own
  const existing = await fs.promises.readdir(streamDir()).catch(() => []);
  for (const f of existing) {
    if (f.startsWith('customdb-') && f.endsWith('.conf')) {
      await fs.promises.unlink(path.join(streamDir(), f)).catch(() => {});
    }
  }
  for (const r of rows) {
    if (r.routing !== 'nginx' || !r.containerName) continue;
    const internalPort = r.type === 'nosql' ? 27017 : 5432;
    await addStreamBlock({ port: r.port, containerName: r.containerName, internalPort });
  }
  return rows.filter((r) => r.routing === 'nginx').length;
}

module.exports = {
  addStreamBlock,
  removeStreamBlock,
  reloadNginx,
  syncFromDatabaseRows,
  configPath,
  streamDir,
};
