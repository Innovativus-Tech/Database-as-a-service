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

function assertMongoUri(uri) {
  if (typeof uri !== 'string' || !/^mongodb(\+srv)?:\/\//i.test(uri.trim())) {
    throw Object.assign(new Error('Source Mongo URL must start with mongodb:// or mongodb+srv://'), { status: 400 });
  }
  return uri.trim();
}

function dbNameFromMongoUri(uri) {
  const parsed = new URL(uri);
  const dbName = decodeURIComponent((parsed.pathname || '').replace(/^\/+/, '').split('/')[0] || '');
  if (!dbName) {
    throw Object.assign(new Error('Source Mongo URL must include a database name, for example mongodb+srv://.../newspro'), { status: 400 });
  }
  return dbName;
}

function cleanIndexSpec(index) {
  const { v, ns, ...spec } = index;
  return spec;
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

function listMongodumpDatabaseDirs(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '__MACOSX' && !entry.name.startsWith('.'))
    .filter((entry) => {
      const dir = path.join(root, entry.name);
      return fs.readdirSync(dir, { withFileTypes: true })
        .some((child) => child.isFile() && child.name.toLowerCase().endsWith('.bson'));
    })
    .map((entry) => entry.name);
}

function findMongodumpRoot(extractedRoot) {
  const directDbDirs = listMongodumpDatabaseDirs(extractedRoot);
  if (directDbDirs.length > 0) return extractedRoot;

  const dirs = fs.readdirSync(extractedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '__MACOSX' && !entry.name.startsWith('.'));

  for (const dir of dirs) {
    const candidate = path.join(extractedRoot, dir.name);
    if (listMongodumpDatabaseDirs(candidate).length > 0) return candidate;
  }

  return extractedRoot;
}

async function listMongoCollectionCountsInContainer(containerName, uri, dbName) {
  const dbNameJson = JSON.stringify(dbName);
  const script = [
    `const target = db.getSiblingDB(${dbNameJson});`,
    `const names = target.getCollectionNames().filter((name) => !name.startsWith('system.')).sort();`,
    `print(JSON.stringify(names.map((name) => ({ name, count: target.getCollection(name).estimatedDocumentCount() }))));`,
  ].join('\n');
  const { stdout } = await execFileP('docker', ['exec', containerName, 'mongosh', uri, '--quiet', '--eval', script]);
  const line = stdout.trim().split('\n').filter(Boolean).pop() || '[]';
  return JSON.parse(line);
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
  // .json is the one format we must parse as a single in-memory blob
  // (JSON.parse). Past ~100 MB the string + parsed object graph can blow the
  // worker's heap. CSV and mongodump imports stream, so they carry the
  // full 200 MB budget — point big datasets at those instead of failing
  // opaquely with an OOM.
  const { size } = await fs.promises.stat(filePath);
  const MAX_JSON_BYTES = 100 * 1024 * 1024;
  if (size > MAX_JSON_BYTES) {
    throw Object.assign(
      new Error('.json imports are limited to 100 MB (the file must be parsed in memory). For larger datasets use .csv or a mongodump .zip — both stream.'),
      { status: 400 }
    );
  }
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
// Mongo URL → MongoDB (server-side database copy)
// ──────────────────────────────────────────────────────────────────────────────
async function importMongoUrlToMongo({ sourceMongoUri, targetConnectionUrl, targetDbName, onProgress }) {
  const sourceUri = assertMongoUri(sourceMongoUri);
  const sourceDbName = dbNameFromMongoUri(sourceUri);
  const sourceClient = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 10000 });
  const targetClient = new MongoClient(targetConnectionUrl, { serverSelectionTimeoutMS: 10000 });

  try {
    await sourceClient.connect();
    await targetClient.connect();

    const sourceDb = sourceClient.db(sourceDbName);
    const targetDb = targetClient.db(targetDbName);
    const collections = (await sourceDb.listCollections({}, { nameOnly: true }).toArray())
      .map((collection) => collection.name)
      .filter((name) => !name.startsWith('system.'))
      .sort();

    if (collections.length === 0) {
      throw Object.assign(new Error(`No collections found in source database "${sourceDbName}"`), { status: 400 });
    }

    const totals = new Map();
    let totalDocs = 0;
    for (const name of collections) {
      const count = await sourceDb.collection(name).estimatedDocumentCount();
      totals.set(name, count);
      totalDocs += count;
    }
    onProgress?.(0, totalDocs || null);

    let copied = 0;
    const copiedCollections = [];
    const BATCH = 1000;
    for (const name of collections) {
      const sourceCollection = sourceDb.collection(name);
      const targetCollection = targetDb.collection(name);
      await targetCollection.drop().catch((err) => {
        if (err?.codeName !== 'NamespaceNotFound') throw err;
      });

      let copiedInCollection = 0;
      let batch = [];
      const cursor = sourceCollection.find({}, { noCursorTimeout: true });
      try {
        for await (const doc of cursor) {
          batch.push(doc);
          if (batch.length >= BATCH) {
            const result = await targetCollection.insertMany(batch, { ordered: false });
            copied += result.insertedCount;
            copiedInCollection += result.insertedCount;
            batch = [];
            onProgress?.(copied, totalDocs || null);
          }
        }
      } finally {
        await cursor.close().catch(() => {});
      }
      if (batch.length > 0) {
        const result = await targetCollection.insertMany(batch, { ordered: false });
        copied += result.insertedCount;
        copiedInCollection += result.insertedCount;
        onProgress?.(copied, totalDocs || null);
      }
      if (copiedInCollection === 0 && totals.get(name) === 0) {
        await targetDb.createCollection(name).catch((err) => {
          if (err?.codeName !== 'NamespaceExists') throw err;
        });
      }
      const indexes = (await sourceCollection.listIndexes().toArray())
        .filter((index) => index.name !== '_id_')
        .map(cleanIndexSpec);
      if (indexes.length > 0) {
        await targetCollection.createIndexes(indexes);
      }
      copiedCollections.push({ name, count: copiedInCollection });
    }

    return {
      count: copied,
      target: targetDbName,
      source: sourceDbName,
      collections: copiedCollections,
    };
  } finally {
    await sourceClient.close().catch(() => {});
    await targetClient.close().catch(() => {});
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
    // Refresh planner stats immediately — the dashboard's table listing and
    // pagination totals read reltuples, which stays -1 (triggering fallback
    // scans) until the first ANALYZE.
    await client.query(`ANALYZE "${table}"`).catch(() => {});
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
  const internalUri = `mongodb://${enc(mongoUser)}:${enc(mongoPassword)}@127.0.0.1:27017/?authSource=admin`;
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cdb-mongodump-'));
  try {
    const zip = new AdmZip(filePath);

    // Zip-bomb guard: a 200 MB upload can decompress to hundreds of GB and
    // fill the host disk. Sum the declared uncompressed sizes before
    // extracting anything and refuse anything past the cap.
    const MAX_UNCOMPRESSED_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB
    const MAX_ENTRIES = 10_000;
    const entries = zip.getEntries();
    if (entries.length > MAX_ENTRIES) {
      throw Object.assign(new Error(`Archive has too many entries (${entries.length} > ${MAX_ENTRIES})`), { status: 400 });
    }
    const uncompressed = entries.reduce((sum, e) => sum + (e.header.size || 0), 0);
    if (uncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw Object.assign(new Error('Archive decompresses to more than 4 GB — too large to import via upload'), { status: 400 });
    }

    zip.extractAllTo(tmpDir, /*overwrite*/ true);

    // mongorestore expects the dump root. Some zips wrap it in a "dump/" dir,
    // and macOS archives can add metadata folders, so find the directory that
    // actually contains database folders with .bson collection files.
    const dumpRoot = findMongodumpRoot(tmpDir);

    const inContainerDir = '/tmp/customdb-restore';
    await execFileP('docker', ['exec', containerName, 'rm', '-rf', inContainerDir]);
    await execFileP('docker', ['exec', containerName, 'mkdir', '-p', inContainerDir]);
    await execFileP('docker', ['cp', dumpRoot + '/.', `${containerName}:${inContainerDir}`]);

    const dumpDbDirs = listMongodumpDatabaseDirs(dumpRoot);
    if (dumpDbDirs.length === 0) {
      throw Object.assign(new Error('Archive does not look like a mongodump: no database folders with .bson files were found'), { status: 400 });
    }

    const restoreArgs = ['exec', containerName, 'mongorestore', '--uri', internalUri, '--drop'];
    let restoredDatabase = mongoDbName;
    if (dumpDbDirs.length === 1) {
      // A single database dump should land in this CustomDB database's primary
      // name, so Browse Data and the generated connection string see it.
      // Single-database dumps are the common dashboard upload path. Restoring
      // the concrete database directory with --db is more reliable across
      // mongorestore versions than namespace rewrites against the dump root.
      restoreArgs.push('--db', mongoDbName, path.posix.join(inContainerDir, dumpDbDirs[0]));
    } else {
      restoredDatabase = 'multiple databases';
      restoreArgs.push(inContainerDir);
    }

    const { stdout, stderr } = await execFileP('docker', restoreArgs);
    await execFileP('docker', ['exec', containerName, 'rm', '-rf', inContainerDir]).catch(() => {});
    const verifyDatabase = mongoDbName;
    const restoredCollections = await listMongoCollectionCountsInContainer(containerName, internalUri, verifyDatabase);
    if (dumpDbDirs.length === 1 && restoredCollections.length === 0) {
      const sourceCollections = dumpDbDirs[0] !== verifyDatabase
        ? await listMongoCollectionCountsInContainer(containerName, internalUri, dumpDbDirs[0]).catch(() => [])
        : [];
      if (sourceCollections.length > 0) {
        throw Object.assign(
          new Error(`mongorestore wrote data to "${dumpDbDirs[0]}", but Browse Data is looking at "${verifyDatabase}".`),
          { status: 500 }
        );
      }
      throw Object.assign(new Error(`mongorestore finished, but no collections were found in "${verifyDatabase}". Log: ${(stderr || stdout || '').slice(-1000)}`), { status: 500 });
    }
    const verifiedCollections = dumpDbDirs.length === 1
      ? restoredCollections
      : (await Promise.all(dumpDbDirs.map(async (dbName) => {
          const collections = await listMongoCollectionCountsInContainer(containerName, internalUri, dbName);
          return collections.map((collection) => ({ ...collection, database: dbName }));
        }))).flat();
    if (verifiedCollections.length === 0) {
      throw Object.assign(new Error(`mongorestore finished, but no collections were found. Log: ${(stderr || stdout || '').slice(-1000)}`), { status: 500 });
    }
    const restoredCount = verifiedCollections.reduce((sum, collection) => sum + (collection.count || 0), 0);

    return {
      count: restoredCount,
      target: restoredDatabase,
      source: dumpDbDirs.length === 1 ? dumpDbDirs[0] : 'multiple databases',
      collections: verifiedCollections,
      log: (stderr || stdout || '').slice(-2000),
    };
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
  if (file?.sourceMongoUri) {
    if (db.type !== 'nosql') throw Object.assign(new Error('Mongo URL imports require a NoSQL database'), { status: 400 });
    return { kind: 'mongo-url→mongo', ...await importMongoUrlToMongo({
      sourceMongoUri: file.sourceMongoUri,
      targetConnectionUrl: connectionUrl,
      targetDbName: db.dbName,
      onProgress,
    }) };
  }

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
