const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');
const { execFile } = require('child_process');
const { parse: csvParseStream } = require('csv-parse');
const AdmZip = require('adm-zip');
const { MongoClient } = require('mongodb');
const { Client: PgClient } = require('pg');

const execFileP = util.promisify(execFile);

const IDENT_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;

function validIdent(name) {
  return typeof name === 'string' && IDENT_RE.test(name);
}

function inferTargetFromFilename(originalName, fallback) {
  const base = path.basename(originalName, path.extname(originalName));
  const cleaned = base.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[^a-zA-Z]+/, '');
  return validIdent(cleaned) ? cleaned : fallback;
}

// Streamed newline count so progress bars have a total without buffering the
// file. Approximate when quoted fields contain embedded newlines — the UI
// clamps at 100%, so an estimate is fine. Subtracts the header row.
function countCsvRows(filePath) {
  return new Promise((resolve, reject) => {
    let count = 0;
    let lastByte = null;
    const stream = fs.createReadStream(filePath);
    stream.on('data', (buf) => {
      for (let i = 0; i < buf.length; i++) if (buf[i] === 10) count++;
      lastByte = buf[buf.length - 1];
    });
    stream.on('end', () => {
      if (lastByte !== null && lastByte !== 10) count++; // no trailing newline
      resolve(Math.max(0, count - 1));
    });
    stream.on('error', reject);
  });
}

function csvRecordStream(filePath) {
  return fs.createReadStream(filePath).pipe(
    csvParseStream({ columns: true, skip_empty_lines: true, trim: true })
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// JSON → MongoDB
// ──────────────────────────────────────────────────────────────────────────────
async function importJsonToMongo({ connectionUrl, dbName, collection, filePath, onProgress }) {
  const raw = await fs.promises.readFile(filePath, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (err) { throw Object.assign(new Error('Invalid JSON: ' + err.message), { status: 400 }); }

  const docs = Array.isArray(parsed) ? parsed : [parsed];
  if (docs.length === 0) return { count: 0, target: collection };
  onProgress?.(0, docs.length);

  const client = new MongoClient(connectionUrl);
  try {
    await client.connect();
    const col = client.db(dbName).collection(collection);
    let inserted = 0;
    const CHUNK = 500;
    for (let start = 0; start < docs.length; start += CHUNK) {
      const chunk = docs.slice(start, start + CHUNK);
      const result = await col.insertMany(chunk);
      inserted += result.insertedCount;
      onProgress?.(inserted, docs.length);
    }
    return { count: inserted, target: collection };
  } finally {
    await client.close().catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CSV → MongoDB (rows become documents)
// Streams the file through the parser in batches — a 200 MB CSV never has to
// fit in memory as one giant array (which used to OOM the container).
// ──────────────────────────────────────────────────────────────────────────────
async function importCsvToMongo({ connectionUrl, dbName, collection, filePath, onProgress }) {
  const totalEstimate = await countCsvRows(filePath);
  onProgress?.(0, totalEstimate || null);

  const client = new MongoClient(connectionUrl);
  try {
    await client.connect();
    const col = client.db(dbName).collection(collection);
    let inserted = 0;
    let batch = [];
    const CHUNK = 1000;
    // for-await pauses the parser stream between batches, so backpressure
    // keeps memory flat regardless of file size.
    for await (const record of csvRecordStream(filePath)) {
      batch.push(record);
      if (batch.length >= CHUNK) {
        const result = await col.insertMany(batch);
        inserted += result.insertedCount;
        batch = [];
        onProgress?.(inserted, totalEstimate || null);
      }
    }
    if (batch.length > 0) {
      const result = await col.insertMany(batch);
      inserted += result.insertedCount;
    }
    onProgress?.(inserted, totalEstimate || inserted || null);
    return { count: inserted, target: collection };
  } finally {
    await client.close().catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CSV → PostgreSQL (auto-create TEXT-column table)
// ──────────────────────────────────────────────────────────────────────────────
async function importCsvToPostgres({ connectionUrl, table, filePath, onProgress }) {
  const totalEstimate = await countCsvRows(filePath);
  onProgress?.(0, totalEstimate || null);

  const client = new PgClient({ connectionString: connectionUrl });
  await client.connect();
  try {
    let columns = null;
    let colsList = null;
    let chunkSize = 500;
    let inserted = 0;
    let batch = [];

    const flush = async () => {
      if (batch.length === 0) return;
      const values = [];
      const tuples = [];
      batch.forEach((row, idx) => {
        const offset = idx * columns.length;
        tuples.push(`(${columns.map((_, i) => `$${offset + i + 1}`).join(', ')})`);
        for (const c of columns) values.push(row[c] ?? null);
      });
      await client.query(
        `INSERT INTO "${table}" (${colsList}) VALUES ${tuples.join(', ')}`,
        values
      );
      inserted += batch.length;
      batch = [];
      onProgress?.(inserted, totalEstimate || null);
    };

    // Stream rows through the parser — table is created lazily from the first
    // record's keys, and batches flush as they fill so memory stays flat.
    for await (const record of csvRecordStream(filePath)) {
      if (!columns) {
        columns = Object.keys(record);
        for (const col of columns) {
          if (!validIdent(col)) {
            throw Object.assign(new Error(`Invalid CSV column name: "${col}". Must match ${IDENT_RE}`), { status: 400 });
          }
        }
        // Postgres caps bind parameters at 65535 per statement — size batches
        // so wide CSVs don't blow past it.
        chunkSize = Math.max(1, Math.min(1000, Math.floor(60000 / columns.length)));
        colsList = columns.map((c) => `"${c}"`).join(', ');
        const colsSql = columns.map((c) => `"${c}" TEXT`).join(', ');
        await client.query(`DROP TABLE IF EXISTS "${table}"`);
        await client.query(`CREATE TABLE "${table}" (${colsSql})`);
      }
      batch.push(record);
      if (batch.length >= chunkSize) await flush();
    }
    await flush();
    if (!columns) return { count: 0, target: table };
    onProgress?.(inserted, totalEstimate || inserted || null);
    return { count: inserted, target: table };
  } finally {
    await client.end().catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// mongodump .zip → MongoDB (via docker cp + docker exec mongorestore)
// ──────────────────────────────────────────────────────────────────────────────
async function importMongodumpZip({ containerName, mongoUser, mongoPassword, mongoDbName, filePath }) {
  // mongorestore runs INSIDE the container, so it must reach mongod via the
  // container's own loopback on the internal port (27017), not the host-side mapped port.
  const enc = encodeURIComponent;
  const internalUri = `mongodb://${enc(mongoUser)}:${enc(mongoPassword)}@127.0.0.1:27017/${enc(mongoDbName)}?authSource=admin`;
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cdb-mongodump-'));
  try {
    const zip = new AdmZip(filePath);
    zip.extractAllTo(tmpDir, /*overwrite*/ true);

    // mongorestore expects the dump root. Some zips wrap it in a "dump/" dir, some don't.
    const dumpRoot = (() => {
      const entries = fs.readdirSync(tmpDir);
      if (entries.length === 1) {
        const only = path.join(tmpDir, entries[0]);
        if (fs.statSync(only).isDirectory()) return only;
      }
      return tmpDir;
    })();

    const inContainerDir = '/tmp/customdb-restore';
    await execFileP('docker', ['exec', containerName, 'rm', '-rf', inContainerDir]);
    await execFileP('docker', ['exec', containerName, 'mkdir', '-p', inContainerDir]);
    await execFileP('docker', ['cp', dumpRoot + '/.', `${containerName}:${inContainerDir}`]);

    const { stdout, stderr } = await execFileP('docker', [
      'exec', containerName,
      'mongorestore', '--uri', internalUri, '--drop', inContainerDir,
    ]);
    await execFileP('docker', ['exec', containerName, 'rm', '-rf', inContainerDir]).catch(() => {});

    return { count: null, target: 'mongorestore', log: (stderr || stdout || '').slice(-2000) };
  } finally {
    fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// pg_dump .sql → PostgreSQL (via docker cp + docker exec psql)
// ──────────────────────────────────────────────────────────────────────────────
async function importPgDumpSql({ containerName, pgUser, pgPassword, pgDbName, filePath }) {
  const inContainerPath = '/tmp/customdb-restore.sql';
  await execFileP('docker', ['cp', filePath, `${containerName}:${inContainerPath}`]);
  try {
    const { stdout, stderr } = await execFileP('docker', [
      'exec',
      '-e', `PGPASSWORD=${pgPassword}`,
      containerName,
      'psql', '-v', 'ON_ERROR_STOP=1',
      '-h', '127.0.0.1', '-U', pgUser, '-d', pgDbName, '-f', inContainerPath,
    ]);
    return { count: null, target: 'psql', log: (stderr || stdout || '').slice(-2000) };
  } finally {
    await execFileP('docker', ['exec', containerName, 'rm', '-f', inContainerPath]).catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ──────────────────────────────────────────────────────────────────────────────
async function dispatchImport({ db, credentials, connectionUrl, containerName, file, queryTarget, onProgress }) {
  const ext = path.extname(file.originalname).toLowerCase();
  const fallback = ext === '.sql' ? 'sql_import' : 'import';
  const target = (queryTarget && validIdent(queryTarget))
    ? queryTarget
    : inferTargetFromFilename(file.originalname, fallback);

  if (!validIdent(target) && (ext === '.json' || ext === '.csv')) {
    throw Object.assign(new Error('Could not determine a valid target collection/table name. Pass ?target=name'), { status: 400 });
  }

  switch (ext) {
    case '.json':
      if (db.type !== 'nosql') throw Object.assign(new Error('.json imports require a NoSQL database'), { status: 400 });
      return { kind: 'json→mongo', ...await importJsonToMongo({
        connectionUrl, dbName: db.dbName, collection: target, filePath: file.path, onProgress,
      }) };

    case '.csv':
      if (db.type === 'nosql') {
        return { kind: 'csv→mongo', ...await importCsvToMongo({
          connectionUrl, dbName: db.dbName, collection: target, filePath: file.path, onProgress,
        }) };
      }
      return { kind: 'csv→postgres', ...await importCsvToPostgres({
        connectionUrl, table: target, filePath: file.path, onProgress,
      }) };

    case '.zip':
      if (db.type !== 'nosql') throw Object.assign(new Error('.zip mongodump imports require a NoSQL database'), { status: 400 });
      onProgress?.(0, null); // archive restores don't expose a row count up front
      return { kind: 'mongodump→mongo', ...await importMongodumpZip({
        containerName,
        mongoUser: credentials.username,
        mongoPassword: credentials.password,
        mongoDbName: db.dbName,
        filePath: file.path,
      }) };

    case '.sql':
      if (db.type !== 'sql') throw Object.assign(new Error('.sql pg_dump imports require a SQL database'), { status: 400 });
      onProgress?.(0, null);
      return { kind: 'pg_dump→postgres', ...await importPgDumpSql({
        containerName,
        pgUser: credentials.username,
        pgPassword: credentials.password,
        pgDbName: db.dbName,
        filePath: file.path,
      }) };

    default:
      throw Object.assign(new Error(`Unsupported file extension: ${ext}. Supported: .json .csv .zip .sql`), { status: 400 });
  }
}

module.exports = { dispatchImport };
