const path = require('path');
const fs = require('fs');
const Docker = require('dockerode');
const { networkName } = require('./dockerNetwork');
const { randomToken } = require('./crypto');

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

const MONGO_IMAGE = 'mongo:7.0';
// Custom Mongo role carrying just the `killop` action — see createMongoContainer.
const KILLOP_ROLE = 'customdbKillOp';
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
  const candidates = [
    `${containerName}.js`,
    `${containerName}.sql`,
    `${containerName}-ssl.sh`,
  ];
  for (const f of candidates) {
    await fs.promises.unlink(path.join(initScriptDir(), f)).catch((err) => {
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

// Per-container resource caps. Defaults are tuned for a small VPS hosting
// many user databases; override per env if you have a beefier host. Values
// are intentionally conservative: one tenant running a runaway aggregation
// can only burn its own quota, never starve the host or the platform DB.
//
// 1GB default chosen so Mongo 7.0 can comfortably boot with its WiredTiger
// cache + replication state + connection pool overhead. 512MB was too tight
// in practice — Mongo's cold-start memory spike crossed it and the container
// got OOM-killed silently mid-init.
const USER_DB_MEMORY_MB = Number(process.env.USER_DB_MEMORY_MB || 1024);
const USER_DB_CPU_QUOTA = Number(process.env.USER_DB_CPU_QUOTA || 0.5); // fraction of one CPU
const USER_DB_PIDS_LIMIT = Number(process.env.USER_DB_PIDS_LIMIT || 200);
const MONGO_WT_CACHE_GB = Number(process.env.MONGO_WT_CACHE_GB || 0.25);

// routing: "nginx"  → no host port binding, container only on customdb-network
// routing: "direct" → legacy behavior, container publishes its port on host
function buildHostConfig({ internalPort, port, bindPath, routing, extraBinds = [] }) {
  const cfg = {
    Binds: [bindPath, ...extraBinds],
    RestartPolicy: { Name: 'unless-stopped' },
    Memory: USER_DB_MEMORY_MB * 1024 * 1024,
    MemorySwap: USER_DB_MEMORY_MB * 1024 * 1024, // disable swap, OOM cleanly
    NanoCpus: Math.round(USER_DB_CPU_QUOTA * 1e9),
    PidsLimit: USER_DB_PIDS_LIMIT,
    // Disk I/O priority. 100 (of 1000 default) means user DB containers get
    // 1/10 the disk bandwidth weight of normal processes when disk is
    // contended. Critical for keeping login + meta-DB responsive while one
    // tenant runs a heavy bulk import. On idle disk this has zero effect —
    // it only kicks in under contention. Docker translates this to io.weight
    // on cgroup v2 systems automatically.
    BlkioWeight: 100,
    // CPU scheduling priority. Same idea, applied to CPU time: when both
    // platform and a user DB are competing for CPU, the user DB gets less.
    CpuShares: 256, // default is 1024
  };
  if (routing === 'direct') {
    cfg.PortBindings = { [`${internalPort}/tcp`]: [{ HostPort: String(port) }] };
  }
  return cfg;
}

function buildNetworkingConfig(routing) {
  if (routing === 'nginx' || routing === 'mongo-gateway') {
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
  // customer-facing user. That user gets readWriteAnyDatabase + dbAdminAnyDatabase
  // (not literal root) — full access to any database WITHIN this one container,
  // so a customer can self-service multiple Mongo databases ("schema folders")
  // on one connection, while still being fully isolated from every other
  // customer's own separate container.
  const rootUser = `root_${randomToken(6)}`;
  const rootPass = randomToken(24);
  // The user record itself must live in `admin` (matching the
  // ?authSource=admin every connection string uses).
  const initFile = path.join(initScriptDir(), `${name}.js`);
  await fs.promises.writeFile(initFile, [
    // Narrow custom role granting ONLY killop. The built-in role that confers
    // it is hostManager, which also grants shutdown/setParameter/unlock —
    // far more authority than "cancel a runaway query on my own database"
    // warrants. This keeps the Monitor page's kill button working without
    // handing out the ability to stop the server.
    `db.getSiblingDB('admin').createRole({`,
    `  role: '${KILLOP_ROLE}',`,
    `  privileges: [{ resource: { cluster: true }, actions: ['killop'] }],`,
    `  roles: [],`,
    `});`,
    `db.getSiblingDB('admin').createUser({`,
    `  user: '${username}',`,
    `  pwd: '${password}',`,
    `  roles: [`,
    `    { role: 'readWriteAnyDatabase', db: 'admin' },`,
    `    { role: 'dbAdminAnyDatabase', db: 'admin' },`,
    // clusterMonitor is what makes the Monitor page work against this
    // database. serverStatus / replSetGetStatus / currentOp / listDatabases
    // are all cluster-level reads that the two roles above do NOT grant —
    // without this the dashboard shows "not authorized on admin to execute
    // command { serverStatus: 1 }". It is a read-only monitoring role: no
    // write access, no user administration, no shutdown.
    `    { role: 'clusterMonitor', db: 'admin' },`,
    `    { role: '${KILLOP_ROLE}', db: 'admin' },`,
    `  ],`,
    `});`,
  ].join('\n'));

  const container = await docker.createContainer({
    Image: MONGO_IMAGE,
    name,
    // Mongo defaults to 50% of system RAM for its WiredTiger cache. With many
    // containers on one host that's catastrophic over-subscription, and
    // Docker's memory cgroup limit alone doesn't fix it (Mongo will get OOM
    // killed instead of self-throttling). Cap the cache explicitly here so
    // each container's footprint stays inside its allotted Memory cap.
    Cmd: ['mongod', '--auth', '--bind_ip_all', '--wiredTigerCacheSizeGB', String(MONGO_WT_CACHE_GB)],
    Healthcheck: {
      Test: ['CMD', 'mongosh', '--quiet', '--eval', "db.adminCommand('ping').ok"],
      Interval: 30_000_000_000, // 30s in nanoseconds
      Timeout:  5_000_000_000,
      Retries:  3,
      StartPeriod: 20_000_000_000,
    },
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

  // SSL bootstrap script — runs once on a fresh data dir, BEFORE init-user.sql
  // (filename prefixed `00-` to come first alphabetically in the entrypoint's
  // run order). Generates a self-signed cert as the postgres user, writes it
  // into PGDATA (so default ssl_cert_file/ssl_key_file paths find it), sets
  // the 0600 permission Postgres requires on the key, and writes `ssl = on`
  // to postgresql.auto.conf so the long-running server picks it up.
  //
  // Note: we DON'T pass `-c ssl=on` in Cmd, because the postgres entrypoint
  // applies Cmd args to the temp init-time server too — that server would
  // refuse to start (cert doesn't exist yet), and the init scripts would
  // never run. postgresql.auto.conf is read only by the long-running server.
  //
  // The TLS handshake is genuine Postgres SSL (handles its own STARTTLS
  // upgrade), so nginx in front can stay a pure TCP passthrough — no `ssl on`
  // directive at the nginx layer.
  const sslInitFile = path.join(initScriptDir(), `${name}-ssl.sh`);
  await fs.promises.writeFile(sslInitFile, [
    `#!/bin/sh`,
    `set -e`,
    `openssl req -new -x509 -days 3650 -nodes \\`,
    `  -out "$PGDATA/server.crt" \\`,
    `  -keyout "$PGDATA/server.key" \\`,
    `  -subj "/CN=customdb-pg-self-signed"`,
    `chmod 600 "$PGDATA/server.key"`,
    `chown postgres:postgres "$PGDATA/server.crt" "$PGDATA/server.key"`,
    `echo "ssl = on" >> "$PGDATA/postgresql.auto.conf"`,
  ].join('\n'));
  await fs.promises.chmod(sslInitFile, 0o755);

  // Tune Postgres caches to fit inside the per-container Memory budget.
  // shared_buffers ≈ 25% of container RAM, effective_cache_size ≈ 50%, both
  // expressed in MB. Without this, Postgres assumes it owns all host RAM
  // and over-caches across containers, leading to OOM kills under load.
  const pgSharedBuffersMB  = Math.max(32, Math.floor(USER_DB_MEMORY_MB * 0.25));
  const pgEffectiveCacheMB = Math.max(64, Math.floor(USER_DB_MEMORY_MB * 0.50));

  const container = await docker.createContainer({
    Image: POSTGRES_IMAGE,
    name,
    Cmd: [
      'postgres',
      '-c', `shared_buffers=${pgSharedBuffersMB}MB`,
      '-c', `effective_cache_size=${pgEffectiveCacheMB}MB`,
      '-c', 'max_connections=100',
      // ssl=on is set in postgresql.auto.conf by the SSL init script, not here.
      // The entrypoint applies Cmd to its temp init server too, which would
      // crash before the cert exists.
    ],
    Healthcheck: {
      Test: ['CMD-SHELL', `pg_isready -U "${rootUser}" -d "${dbName}"`],
      Interval: 30_000_000_000,
      Timeout:  5_000_000_000,
      Retries:  3,
      StartPeriod: 20_000_000_000,
    },
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
      extraBinds: [
        `${sslInitFile}:/docker-entrypoint-initdb.d/00-init-ssl.sh:ro`,
        `${initFile}:/docker-entrypoint-initdb.d/init-user.sql:ro`,
      ],
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

/**
 * Grant `clusterMonitor` to an existing Mongo database's customer user.
 *
 * Databases provisioned before the PivotDB merge were created with only
 * readWriteAnyDatabase + dbAdminAnyDatabase, because CustomDB had no
 * monitoring feature and never needed cluster-level reads. The Monitor page
 * calls serverStatus/replSetGetStatus/currentOp/listDatabases, all of which
 * require clusterMonitor — so on those older databases it fails with
 * "not authorized on admin to execute command { serverStatus: 1 }".
 *
 * The init script that creates the user only runs once, on a FRESH data dir,
 * so new-database fixes don't reach existing ones. This repairs them in place.
 *
 * The customer user can't grant itself a role (that needs userAdmin, which it
 * deliberately doesn't have), so we authenticate as the bootstrap root
 * credential. It was never stored anywhere, but it does still live in the
 * container's own Env — which is where we read it back from.
 *
 * Idempotent: grantRolesToUser is a no-op when the role is already held.
 *
 * @param {{containerName: string}} db
 * @param {string} username customer-facing user to grant the role to
 * @returns {Promise<'granted'|'skipped'>}
 */
async function ensureMongoMonitorRole(db, username) {
  if (!db.containerName) return 'skipped';

  const info = await docker.getContainer(db.containerName).inspect();
  if (!info?.State?.Running) return 'skipped';

  const env = Object.fromEntries(
    (info.Config?.Env || []).map((e) => {
      const i = e.indexOf('=');
      return [e.slice(0, i), e.slice(i + 1)];
    })
  );
  const rootUser = env.MONGO_INITDB_ROOT_USERNAME;
  const rootPass = env.MONGO_INITDB_ROOT_PASSWORD;
  // Containers created outside our provisioning path won't have these.
  if (!rootUser || !rootPass) return 'skipped';

  const { MongoClient } = require('mongodb');
  const uri = `mongodb://${encodeURIComponent(rootUser)}:${encodeURIComponent(rootPass)}`
    + `@${db.containerName}:27017/?authSource=admin`;

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  try {
    await client.connect();
    const admin = client.db('admin');

    // Create the killop role if this database predates it. Mongo raises
    // "Role already exists" (code 51002) on repeat calls — that is the
    // expected steady state, not a failure.
    try {
      await admin.command({
        createRole: KILLOP_ROLE,
        privileges: [{ resource: { cluster: true }, actions: ['killop'] }],
        roles: [],
      });
    } catch (err) {
      const code = err?.code;
      const already = code === 51002 || /already exists/i.test(err?.message || '');
      if (!already) throw err;
    }

    await admin.command({
      grantRolesToUser: username,
      roles: [
        { role: 'clusterMonitor', db: 'admin' },
        { role: KILLOP_ROLE, db: 'admin' },
      ],
    });
    return 'granted';
  } finally {
    await client.close().catch(() => {});
  }
}

module.exports = {
  createMongoContainer,
  createPostgresContainer,
  ensureMongoMonitorRole,
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
