const path = require('path');
const fs = require('fs');
const Docker = require('dockerode');
const { networkName } = require('./dockerNetwork');
const { randomToken } = require('./crypto');

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

const MONGO_IMAGE = 'mongo:7.0';
const POSTGRES_IMAGE = 'postgres:16';

function dataRoot() {
  return process.env.DATA_ROOT || '/data';
}

// Per-user-scoped names. Pass userId for new DBs.
// If userId is omitted, returns the legacy (Phase-3) name so old rows still work.
function deriveNames({ type, dbName, userId }) {
  const prefix = type === 'nosql' ? 'customdb-mongo' : 'customdb-pg';
  const slug = userId ? `${userId.replace(/-/g, '').slice(0, 8)}-${dbName}` : dbName;
  return {
    containerName: `${prefix}-${slug}`,
    dataDir: path.join(dataRoot(), slug),
  };
}

function ensureDataDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function initScriptDir() {
  return ensureDataDir(path.join(dataRoot(), '_init'));
}

// Removes the one-off init script (if any) left behind for a container. Safe
// to call even if neither extension exists (e.g. legacy root-scoped DBs).
async function removeInitScript(containerName) {
  for (const ext of ['js', 'sql']) {
    await fs.promises.unlink(path.join(initScriptDir(), `${containerName}.${ext}`)).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }
}

async function imageExists(image) {
  try {
    await docker.getImage(image).inspect();
    return true;
  } catch (err) {
    if (err.statusCode === 404) return false;
    throw err;
  }
}

function pullImage(image) {
  return new Promise((resolve, reject) => {
    docker.pull(image, (err, stream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (finishErr) => {
        if (finishErr) return reject(finishErr);
        resolve();
      });
    });
  });
}

async function ensureImage(image) {
  if (!(await imageExists(image))) {
    console.log(`[provisioning] pulling ${image} (first-time, may take a minute)`);
    await pullImage(image);
    console.log(`[provisioning] pulled ${image}`);
  }
}

// routing: "nginx"  → no host port binding, container only on customdb-network
// routing: "direct" → legacy behavior, container publishes its port on host
function buildHostConfig({ internalPort, port, bindPath, routing, extraBinds = [] }) {
  const cfg = {
    Binds: [bindPath, ...extraBinds],
    RestartPolicy: { Name: 'unless-stopped' },
  };
  if (routing === 'direct') {
    cfg.PortBindings = { [`${internalPort}/tcp`]: [{ HostPort: String(port) }] };
  }
  return cfg;
}

function buildNetworkingConfig(routing) {
  if (routing === 'nginx') {
    return { EndpointsConfig: { [networkName()]: {} } };
  }
  return undefined;
}

async function createMongoContainer({ userId, dbName, port, username, password, routing = 'nginx' }) {
  await ensureImage(MONGO_IMAGE);
  const { containerName: name, dataDir } = deriveNames({ type: 'nosql', dbName, userId });
  ensureDataDir(dataDir);

  // The root user below is a throwaway bootstrap credential — never stored or
  // handed to the customer. It only exists so Mongo's entrypoint can enable
  // --auth and run the init script once (on a fresh data dir) to create the
  // customer-facing user scoped to just `dbName` (not root over the whole
  // container). This is what stops a stray external connection from silently
  // creating sibling databases (e.g. "public", "defaultdb") that CustomDB
  // never sees.
  const rootUser = `root_${randomToken(6)}`;
  const rootPass = randomToken(24);
  const initFile = path.join(initScriptDir(), `${name}.js`);
  await fs.promises.writeFile(initFile, [
    `db.getSiblingDB('${dbName}').createUser({`,
    `  user: '${username}',`,
    `  pwd: '${password}',`,
    `  roles: [{ role: 'dbOwner', db: '${dbName}' }],`,
    `});`,
  ].join('\n'));

  const container = await docker.createContainer({
    Image: MONGO_IMAGE,
    name,
    Env: [
      `MONGO_INITDB_ROOT_USERNAME=${rootUser}`,
      `MONGO_INITDB_ROOT_PASSWORD=${rootPass}`,
    ],
    Labels: {
      'customdb.managed': 'true',
      'customdb.type': 'nosql',
      'customdb.dbName': dbName,
      'customdb.userId': userId || '',
      'customdb.routing': routing,
    },
    HostConfig: buildHostConfig({
      internalPort: 27017, port, bindPath: `${dataDir}:/data/db`, routing,
      extraBinds: [`${initFile}:/docker-entrypoint-initdb.d/init-user.js:ro`],
    }),
    NetworkingConfig: buildNetworkingConfig(routing),
    ExposedPorts: { '27017/tcp': {} },
  });

  await container.start();
  return { containerId: container.id, containerName: name, dataDir, routing };
}

async function createPostgresContainer({ userId, dbName, port, username, password, routing = 'nginx' }) {
  await ensureImage(POSTGRES_IMAGE);
  const { containerName: name, dataDir } = deriveNames({ type: 'sql', dbName, userId });
  ensureDataDir(dataDir);

  // Same reasoning as createMongoContainer: POSTGRES_USER below is a
  // throwaway bootstrap superuser, never handed to the customer. The init
  // script (run once, only on a fresh data dir) creates the real
  // customer-facing role as the OWNER of just `dbName` — a plain role
  // without CREATEDB/SUPERUSER, so it can't create sibling databases in this
  // same container the way a superuser could.
  const rootUser = `root_${randomToken(6)}`;
  const rootPass = randomToken(24);
  const initFile = path.join(initScriptDir(), `${name}.sql`);
  await fs.promises.writeFile(initFile, [
    `CREATE USER "${username}" WITH PASSWORD '${password}';`,
    `GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${username}";`,
    `ALTER DATABASE "${dbName}" OWNER TO "${username}";`,
    `GRANT ALL ON SCHEMA public TO "${username}";`,
  ].join('\n'));

  const container = await docker.createContainer({
    Image: POSTGRES_IMAGE,
    name,
    Env: [
      `POSTGRES_USER=${rootUser}`,
      `POSTGRES_PASSWORD=${rootPass}`,
      `POSTGRES_DB=${dbName}`,
    ],
    Labels: {
      'customdb.managed': 'true',
      'customdb.type': 'sql',
      'customdb.dbName': dbName,
      'customdb.userId': userId || '',
      'customdb.routing': routing,
    },
    HostConfig: buildHostConfig({
      internalPort: 5432, port, bindPath: `${dataDir}:/var/lib/postgresql/data`, routing,
      extraBinds: [`${initFile}:/docker-entrypoint-initdb.d/init-user.sql:ro`],
    }),
    NetworkingConfig: buildNetworkingConfig(routing),
    ExposedPorts: { '5432/tcp': {} },
  });

  await container.start();
  return { containerId: container.id, containerName: name, dataDir, routing };
}

async function stopAndRemoveContainer(name) {
  const container = docker.getContainer(name);
  try {
    await container.stop({ t: 10 });
  } catch (err) {
    if (err.statusCode !== 304 && err.statusCode !== 404) throw err;
    // 304 = already stopped, 404 = doesn't exist
  }
  try {
    await container.remove({ v: false });
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
}

async function inspectContainer(name) {
  try {
    return await docker.getContainer(name).inspect();
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

async function startContainer(name) {
  const container = docker.getContainer(name);
  try {
    await container.start();
  } catch (err) {
    if (err.statusCode === 304) return; // already running
    throw err;
  }
}

// For DBs created before the per-user naming change, containerName is null;
// fall back to the legacy derivation that uses only dbName.
function resolveNames(db) {
  if (db.containerName) {
    return deriveNames({ type: db.type, dbName: db.dbName, userId: db.userId });
  }
  return deriveNames({ type: db.type, dbName: db.dbName });
}

// Make sure an active DB's container is actually up. Containers can disappear
// entirely (e.g. host reboot, manual `docker rm`, stack rebuild) since they're
// created by Dockerode outside Coolify's compose lifecycle and won't come back
// on their own. Their data dir is a host bind mount, not a named volume, so
// it survives container removal and recreating the container reattaches it.
async function ensureContainerRunning({ db, username, password }) {
  const { containerName: name } = resolveNames(db);
  const inspect = await inspectContainer(name);
  if (!inspect) {
    const fn = db.type === 'nosql' ? createMongoContainer : createPostgresContainer;
    await fn({ userId: db.userId, dbName: db.dbName, port: db.port, username, password, routing: db.routing || 'nginx' });
    return 'recreated';
  }
  if (!inspect.State.Running) {
    await startContainer(name);
    return 'started';
  }
  return 'running';
}

async function getDirectorySize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(full);
    } else if (entry.isFile()) {
      try {
        const st = await fs.promises.stat(full);
        total += st.size;
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
  }
  return total;
}

async function removeDataDir(dir) {
  // Hard refuse to rm anything outside DATA_ROOT — defense against bad input.
  const root = path.resolve(dataRoot());
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Refusing to remove ${resolved}: outside DATA_ROOT (${root})`);
  }
  await fs.promises.rm(resolved, { recursive: true, force: true });
}

module.exports = {
  createMongoContainer,
  createPostgresContainer,
  stopAndRemoveContainer,
  inspectContainer,
  startContainer,
  ensureContainerRunning,
  resolveNames,
  getDirectorySize,
  removeDataDir,
  removeInitScript,
  deriveNames,
};
