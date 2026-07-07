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

function gatewayMapDir() {
  return path.join(streamDir(), 'mongo-gateway');
}

function gatewayMapPath(host) {
  const safeHost = String(host).toLowerCase().replace(/[^a-z0-9.-]/g, '_');
  return path.join(gatewayMapDir(), `${safeHost}.map`);
}

function blockText({ port, containerName, internalPort, tlsEnabled = false, type = 'nosql' }) {
  // proxy_pass target MUST live in a variable, not a bare literal — nginx
  // resolves a literal hostname once at config-load time, and if that one
  // container is down, the whole nginx process fails to start/reload,
  // breaking routing for every other database. Holding it in a variable
  // defers resolution to connection time via the `resolver` directive, so a
  // single dead container only breaks its own route.
  //
  // TLS placement depends on the protocol:
  //   - Mongo (type === 'nosql'): terminate at nginx using the baked-in
  //     self-signed cert. Mongo's TLS handshake is immediate (TLS ClientHello
  //     is the first bytes on the wire), so nginx `ssl on` works.
  //   - Postgres (type === 'sql'): nginx stays a pure TCP passthrough; TLS
  //     terminates inside the Postgres container itself. Postgres uses a
  //     STARTTLS-style upgrade dance (plaintext SSLRequest packet → server
  //     responds 'S' → TLS handshake) which nginx `ssl on` can't speak.
  const nginxTerminatesTls = tlsEnabled && type === 'nosql';
  const sslDirectives = nginxTerminatesTls ? `
  ssl_certificate     /etc/nginx/tls/customdb.crt;
  ssl_certificate_key /etc/nginx/tls/customdb.key;` : '';
  const tlsTag = tlsEnabled ? (nginxTerminatesTls ? ' (TLS at nginx)' : ' (TLS in container)') : '';
  return `# customdb stream block for port ${port}${tlsTag}
server {
  listen ${port}${nginxTerminatesTls ? ' ssl' : ''};${sslDirectives}
  set $upstream_${port} ${containerName};
  proxy_pass $upstream_${port}:${internalPort};
  proxy_connect_timeout 5s;
  proxy_timeout 1h;
}
`;
}

function ensureStreamDir() {
  fs.mkdirSync(streamDir(), { recursive: true });
  fs.mkdirSync(gatewayMapDir(), { recursive: true });
}

async function addGatewayMap({ host, containerName, internalPort = 27017 }) {
  ensureStreamDir();
  await fs.promises.writeFile(
    gatewayMapPath(host),
    `${String(host).toLowerCase()} ${containerName}:${internalPort};\n`,
    'utf8',
  );
}

async function addStreamBlock({ port, host, containerName, internalPort, tlsEnabled = false, type = 'nosql', routing = 'nginx' }) {
  ensureStreamDir();
  if (routing === 'mongo-gateway') {
    await addGatewayMap({ host, containerName, internalPort });
    return;
  }
  await fs.promises.writeFile(configPath(port), blockText({ port, containerName, internalPort, tlsEnabled, type }), 'utf8');
}

async function removeStreamBlock(port, host) {
  await fs.promises.unlink(configPath(port)).catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  });
  if (host) {
    await fs.promises.unlink(gatewayMapPath(host)).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }
}

// Best-effort reload. This exec path only works when the nginx container
// keeps its compose container_name (plain docker compose). Orchestrators
// like Coolify generate their own names, so the exec misses — that's fine:
// the nginx image runs an inotify watcher (nginx/reload-watcher.sh) that
// reloads itself whenever a stream config changes, so routing still updates.
async function reloadNginx() {
  try {
    const { stderr } = await execFileP('docker', ['exec', nginxContainer(), 'nginx', '-s', 'reload']);
    return { reloaded: true, stderr };
  } catch (err) {
    if (/No such container/i.test(err.stderr || err.message)) {
      console.log(`[nginx] no container named ${nginxContainer()} (orchestrator-managed names?) — relying on nginx's in-container config watcher`);
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
  const gatewayEntries = await fs.promises.readdir(gatewayMapDir()).catch(() => []);
  for (const f of gatewayEntries) {
    if (f.endsWith('.map')) {
      await fs.promises.unlink(path.join(gatewayMapDir(), f)).catch(() => {});
    }
  }
  for (const r of rows) {
    if (!r.containerName) continue;
    const internalPort = r.type === 'nosql' ? 27017 : 5432;
    if (r.routing === 'mongo-gateway') {
      await addGatewayMap({ host: r.host, containerName: r.containerName, internalPort });
    } else if (r.routing === 'nginx') {
      await addStreamBlock({ port: r.port, containerName: r.containerName, internalPort, tlsEnabled: !!r.tlsEnabled, type: r.type });
    }
  }
  return rows.filter((r) => r.routing === 'nginx' || r.routing === 'mongo-gateway').length;
}

module.exports = {
  addStreamBlock,
  removeStreamBlock,
  addGatewayMap,
  reloadNginx,
  syncFromDatabaseRows,
  configPath,
  streamDir,
  gatewayMapPath,
};
