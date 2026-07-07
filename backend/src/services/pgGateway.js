// Single-port Postgres gateway.
//
// Why this exists: Mongo multiplexes many databases onto one public port via
// TLS SNI at nginx, but Postgres can't — its TLS is a STARTTLS-style upgrade
// (plaintext SSLRequest packet → server answers 'S' → TLS handshake), so a
// TCP proxy never sees an SNI to route on. Instead, this gateway speaks just
// enough of the Postgres protocol to read the startup message, routes by the
// `user` parameter (every CustomDB database has a globally unique username),
// and then becomes a dumb byte pipe to that database's container. Real
// authentication still happens end-to-end between the client and the actual
// Postgres — the gateway never sees or checks the password.
//
// Wire flow per connection:
//   client → [SSLRequest]            → gateway answers 'S', upgrades to TLS
//   client → [StartupMessage user=X] → gateway looks up X → container
//   gateway → container:5432 (plaintext on the internal Docker network,
//             same as every other internal hop) → replay startup → pipe
//
// Known limitation: out-of-band CancelRequest packets carry only a PID +
// secret (no user), so they can't be routed and are dropped. Ctrl+C in psql
// falls back to closing the connection.

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const tls = require('tls');
const util = require('util');
const { execFile } = require('child_process');

const execFileP = util.promisify(execFile);

const SSL_REQUEST_CODE = 80877103;
const GSSENC_REQUEST_CODE = 80877104;
const CANCEL_REQUEST_CODE = 80877102;
const STARTUP_PROTOCOL_V3 = 196608;

const HANDSHAKE_TIMEOUT_MS = 15_000;
const MAX_STARTUP_PACKET_BYTES = 64 * 1024; // spec allows 10k params; be generous

// ── protocol helpers ─────────────────────────────────────────────────────────

// Promise-based exact-byte reader over a socket. Keeps whatever arrives past
// the requested bytes so it can be replayed to the upstream once routed.
function createReader(socket) {
  let buffer = Buffer.alloc(0);
  let pending = null;
  let ended = false;
  let error = null;

  const pump = () => {
    if (!pending) return;
    if (error) { const p = pending; pending = null; p.reject(error); return; }
    if (buffer.length >= pending.n) {
      const p = pending; pending = null;
      const out = buffer.subarray(0, p.n);
      buffer = buffer.subarray(p.n);
      p.resolve(out);
    } else if (ended) {
      const p = pending; pending = null;
      p.reject(new Error('connection closed during handshake'));
    }
  };

  const onData = (chunk) => { buffer = Buffer.concat([buffer, chunk]); pump(); };
  const onEnd = () => { ended = true; pump(); };
  const onError = (err) => { error = err; pump(); };
  socket.on('data', onData);
  socket.on('end', onEnd);
  socket.on('error', onError);

  return {
    readExact(n) {
      return new Promise((resolve, reject) => {
        pending = { n, resolve, reject };
        pump();
      });
    },
    // Bytes received beyond what was read — must be forwarded upstream.
    leftover() { return buffer; },
    detach() {
      socket.off('data', onData);
      socket.off('end', onEnd);
      socket.off('error', onError);
    },
  };
}

// One full length-prefixed packet: int32 total length (incl. itself) + body.
async function readPacket(reader) {
  const lenBuf = await reader.readExact(4);
  const len = lenBuf.readInt32BE(0);
  if (len < 8 || len > MAX_STARTUP_PACKET_BYTES) {
    throw new Error(`invalid startup packet length ${len}`);
  }
  const body = await reader.readExact(len - 4);
  return { raw: Buffer.concat([lenBuf, body]), code: body.readInt32BE(0), body };
}

// StartupMessage body after the 4-byte protocol: key\0value\0 ... \0
function parseStartupParams(body) {
  const params = {};
  let off = 4;
  while (off < body.length) {
    const keyEnd = body.indexOf(0, off);
    if (keyEnd < 0 || keyEnd === off) break; // final terminator
    const valEnd = body.indexOf(0, keyEnd + 1);
    if (valEnd < 0) break;
    params[body.toString('utf8', off, keyEnd)] = body.toString('utf8', keyEnd + 1, valEnd);
    off = valEnd + 1;
  }
  return params;
}

// Postgres ErrorResponse so psql/drivers print a real message instead of
// "connection reset".
function errorResponse(message, sqlState = '28000') {
  const fields = Buffer.concat([
    Buffer.from(`SFATAL\0`), Buffer.from(`VFATAL\0`),
    Buffer.from(`C${sqlState}\0`), Buffer.from(`M${message}\0`),
    Buffer.from([0]),
  ]);
  const out = Buffer.alloc(5 + fields.length);
  out.write('E', 0);
  out.writeInt32BE(4 + fields.length, 1);
  fields.copy(out, 5);
  return out;
}

// ── TLS cert (self-signed, transport encryption only — same trust model as
//    the Mongo path's nginx cert; clients use sslmode=require) ───────────────

async function generateSecureContext() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cdb-pggw-'));
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  try {
    await execFileP('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
      '-keyout', keyPath, '-out', certPath, '-subj', '/CN=customdb-pg-gateway',
    ]);
    const [key, cert] = await Promise.all([
      fs.promises.readFile(keyPath),
      fs.promises.readFile(certPath),
    ]);
    return tls.createSecureContext({ key, cert });
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── gateway ──────────────────────────────────────────────────────────────────

// resolveRoute(username) → { host, port } | null. Injected so tests can run
// the gateway against any Postgres without a meta-DB.
function createPgGateway({ resolveRoute, secureContext }) {
  const server = net.createServer((rawSocket) => {
    rawSocket.setNoDelay(true);
    rawSocket.setTimeout(HANDSHAKE_TIMEOUT_MS, () => rawSocket.destroy());
    handleConnection(rawSocket, { resolveRoute, secureContext }).catch(() => {
      rawSocket.destroy();
    });
  });
  return server;
}

async function handleConnection(rawSocket, { resolveRoute, secureContext }) {
  let socket = rawSocket;
  let reader = createReader(socket);

  // Pre-startup negotiation packets (SSL/GSS requests) — at most a few.
  for (let i = 0; i < 4; i++) {
    const packet = await readPacket(reader);

    if (packet.code === SSL_REQUEST_CODE) {
      if (!secureContext) {
        socket.write('N'); // no TLS available; client may retry plaintext
        continue;
      }
      socket.write('S');
      reader.detach();
      if (reader.leftover().length > 0) {
        // Client must wait for our 'S' before the TLS hello — pipelined
        // bytes here mean something non-compliant; bail.
        socket.destroy();
        return;
      }
      socket = new tls.TLSSocket(rawSocket, { isServer: true, secureContext });
      reader = createReader(socket);
      continue;
    }

    if (packet.code === GSSENC_REQUEST_CODE) {
      socket.write('N'); // GSSAPI encryption unsupported; client falls back
      continue;
    }

    if (packet.code === CANCEL_REQUEST_CODE) {
      socket.destroy(); // no user in the packet — unroutable, see header note
      return;
    }

    if (packet.code === STARTUP_PROTOCOL_V3) {
      const params = parseStartupParams(packet.body);
      const username = params.user;
      const route = username ? await resolveRoute(username) : null;
      if (!route) {
        socket.write(errorResponse(
          `no CustomDB database for user "${username || ''}" — check the username in your connection string`
        ));
        socket.end();
        return;
      }

      const upstream = net.connect(route.port, route.host);
      upstream.setNoDelay(true);
      upstream.on('connect', () => {
        rawSocket.setTimeout(0); // handshake done; long-lived session now
        upstream.write(packet.raw);
        const extra = reader.leftover();
        if (extra.length > 0) upstream.write(extra);
        reader.detach();
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.on('error', () => {
        socket.write(errorResponse('database container is unreachable — try again shortly', '57P03'));
        socket.end();
      });
      socket.on('close', () => upstream.destroy());
      upstream.on('close', () => socket.destroy());
      return;
    }

    socket.destroy(); // unknown protocol — not Postgres
    return;
  }
  socket.destroy(); // too many negotiation rounds
}

// Production wiring: route by looking the username up in the meta-DB.
// Cached briefly — one lookup per unique user per 30s, not per connection.
async function startPgGateway({ port }) {
  const prisma = require('../prisma');
  const { cache } = require('./cache');

  let secureContext = null;
  try {
    secureContext = await generateSecureContext();
  } catch (err) {
    console.warn('[pg-gateway] TLS cert generation failed — serving plaintext only (sslmode=require will fail):', err.message);
  }

  const resolveRoute = (username) =>
    cache.getOrLoad(`pg-route:${username}`, 30_000, async () => {
      const cred = await prisma.credential.findFirst({
        where: { username },
        include: { database: true },
      });
      const db = cred?.database;
      if (!db || db.type !== 'sql' || db.status !== 'active' || !db.containerName) return null;
      return { host: db.containerName, port: 5432 };
    });

  const server = createPgGateway({ resolveRoute, secureContext });
  server.on('error', (err) => {
    console.error('[pg-gateway] server error (single-port Postgres routing degraded):', err.message);
  });
  await new Promise((resolve) => server.listen(port, resolve));
  console.log(`[pg-gateway] routing all Postgres databases on :${port}`);
  return server;
}

// The PUBLIC port customers connect to (host side of the compose mapping).
// Default reuses the first port of the old published PG range so an upgraded
// VPS can't collide with anything else.
function pgPublicPort() {
  return Number(process.env.PG_PUBLIC_PORT) || 5433;
}

module.exports = { createPgGateway, startPgGateway, pgPublicPort };
