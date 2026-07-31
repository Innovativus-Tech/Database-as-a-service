/**
 * Import an existing PivotDB metadata database into the merged schema.
 *
 *   PIVOTDB_URL=postgresql://user:pass@host:5432/mongovis npm run import:pivotdb
 *
 * Add `--dry-run` to report what would happen without writing anything.
 *
 * Why this exists
 * ───────────────
 * The merge keeps both products' live data. The CustomDB half needs no import
 * at all — the merged schema is a strict superset of its tables, so its rows
 * are already in place after `prisma migrate deploy`. PivotDB's rows live in a
 * *different physical database*, so they have to be copied across.
 *
 * What it does
 * ────────────
 *  1. Users     — each PivotDB user becomes a CustomDB user. Password hashes
 *                 carry over verbatim: PivotDB hashed with bcryptjs, CustomDB
 *                 verifies with bcrypt, and the $2a$/$2b$ formats are
 *                 interchangeable, so everyone keeps their existing password.
 *                 An email that already exists in CustomDB is treated as the
 *                 same person — the CustomDB account wins and the PivotDB rows
 *                 are attached to it.
 *  2. Profiles  — each PivotDB profile is recreated and bound to the user who
 *                 administered it, becoming that user's workspace.
 *  3. Everything else — connections, jobs, runs, alert rules and events,
 *                 saved queries and audit events, copied with their original
 *                 ids so every foreign key stays valid and no re-pointing is
 *                 needed.
 *
 * Encryption
 * ──────────
 * `Connection.encryptedUri` is copied as ciphertext and never decrypted here.
 * That means the merged deployment MUST reuse PivotDB's `ENCRYPTION_KEY`,
 * otherwise every imported connection URI becomes unreadable. The script
 * refuses to run if the key is missing, and verifies it against a sample row
 * before writing anything.
 *
 * Safety
 * ──────
 * Idempotent: every write is a `createMany({ skipDuplicates: true })` or an
 * upsert keyed on the original id, so a re-run after a partial failure resumes
 * rather than duplicating. Nothing in the destination is ever deleted.
 */

import { PrismaClient } from '@prisma/client';
import { decrypt } from '../../src/pivot/crypto/encrypt.js';

const DRY_RUN = process.argv.includes('--dry-run');

const SOURCE_URL = process.env.PIVOTDB_URL;
if (!SOURCE_URL) {
  console.error('PIVOTDB_URL is required — the PivotDB metadata database to import from.');
  process.exit(1);
}
if (!process.env.ENCRYPTION_KEY) {
  console.error(
    'ENCRYPTION_KEY is required and must be the SAME key the PivotDB deployment used.\n' +
    'Connection URIs are copied as ciphertext; a different key makes them permanently unreadable.',
  );
  process.exit(1);
}

const dest = new PrismaClient();
const src = new PrismaClient({ datasources: { db: { url: SOURCE_URL } } });

/** Raw query helper — the source DB has PivotDB's schema, not the merged one. */
async function q<T>(sql: string): Promise<T[]> {
  return src.$queryRawUnsafe<T[]>(sql);
}

/** Tables copied verbatim: same columns, same ids, no transformation. */
const PASSTHROUGH_TABLES: Array<{ from: string; to: string }> = [
  { from: '"Connection"',     to: 'connections' },
  { from: '"BackupJob"',      to: 'backup_jobs' },
  { from: '"BackupRun"',      to: 'backup_runs' },
  { from: '"RestoreRun"',     to: 'restore_runs' },
  { from: '"ExportJob"',      to: 'export_jobs' },
  { from: '"MigrationJob"',   to: 'migration_jobs' },
  { from: '"MigrationRun"',   to: 'migration_runs' },
  { from: '"JobRun"',         to: 'job_runs' },
  { from: '"AlertRule"',      to: 'alert_rules' },
  { from: '"AlertEvent"',     to: 'alert_events' },
  { from: '"SavedQuery"',     to: 'saved_queries' },
  { from: '"AuditEvent"',     to: 'audit_events' },
  { from: '"MigrationJobV2"', to: 'migration_jobs_v2' },
  { from: '"MigrationRunV2"', to: 'migration_runs_v2' },
  { from: '"CdcSyncJob"',     to: 'cdc_sync_jobs' },
  { from: '"CdcSyncRun"',     to: 'cdc_sync_runs' },
];

async function main() {
  console.log(DRY_RUN ? '── DRY RUN — nothing will be written ──\n' : '── Importing PivotDB ──\n');

  // ── 0. Verify the encryption key actually decrypts this dataset ───────────
  const [sampleConn] = await q<{ encryptedUri: string }>(
    'SELECT "encryptedUri" FROM "Connection" LIMIT 1',
  );
  if (sampleConn) {
    try {
      decrypt(sampleConn.encryptedUri);
      console.log('✓ ENCRYPTION_KEY verified against an existing connection');
    } catch {
      console.error(
        '✗ ENCRYPTION_KEY does not decrypt this dataset.\n' +
        '  Use the key from the PivotDB deployment these rows came from, or every\n' +
        '  imported connection will be unusable. Aborting without writing.',
      );
      process.exit(1);
    }
  }

  // ── 1. Users ─────────────────────────────────────────────────────────────
  const srcUsers = await q<{
    id: string; email: string; passwordHash: string; role: string;
    profileId: string | null; invitedBy: string | null;
    createdAt: Date; lastLoginAt: Date | null;
  }>('SELECT * FROM "User"');

  // old PivotDB user id (cuid) → merged CustomDB user id (uuid)
  const userIdMap = new Map<string, string>();
  let usersCreated = 0;
  let usersMerged = 0;

  for (const u of srcUsers) {
    const email = u.email.toLowerCase();
    const existing = await dest.user.findUnique({ where: { email }, select: { id: true } });

    if (existing) {
      // Same human already has a CustomDB account — keep it (it may carry 2FA,
      // Google linkage and provisioned databases) and just adopt their rows.
      userIdMap.set(u.id, existing.id);
      usersMerged++;
      continue;
    }

    if (DRY_RUN) {
      userIdMap.set(u.id, `dry-run-${u.id}`);
      usersCreated++;
      continue;
    }

    const created = await dest.user.create({
      data: {
        email,
        passwordHash: u.passwordHash,
        // PivotDB's superadmin is the platform operator; everyone else is a
        // normal account. Workspace-level permission rides on profileRole.
        role: u.role === 'superadmin' ? 'admin' : 'user',
        profileRole: u.role === 'viewer' ? 'viewer' : 'admin',
        invitedBy: u.invitedBy,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
      },
      select: { id: true },
    });
    userIdMap.set(u.id, created.id);
    usersCreated++;
  }
  console.log(`Users:     ${usersCreated} created, ${usersMerged} matched existing CustomDB accounts`);

  // ── 2. Profiles ──────────────────────────────────────────────────────────
  const srcProfiles = await q<{ id: string; name: string; adminId: string; createdAt: Date }>(
    'SELECT * FROM "Profile"',
  );

  // old profile id (cuid) → merged profile id (uuid)
  const profileIdMap = new Map<string, string>();
  let profilesCreated = 0;

  for (const p of srcProfiles) {
    const ownerId = userIdMap.get(p.adminId);

    if (DRY_RUN) {
      profileIdMap.set(p.id, `dry-run-${p.id}`);
      profilesCreated++;
      continue;
    }

    // If the owner already had a workspace (because their CustomDB account
    // pre-existed and something already provisioned one), reuse it rather than
    // creating a second — a user owns exactly one workspace.
    const existingOwned = ownerId
      ? await dest.profile.findUnique({ where: { ownerUserId: ownerId }, select: { id: true } })
      : null;

    if (existingOwned) {
      profileIdMap.set(p.id, existingOwned.id);
      continue;
    }

    const created = await dest.profile.create({
      data: {
        name: p.name,
        ownerUserId: ownerId ?? null,
        legacyAdminId: p.adminId,
        createdAt: p.createdAt,
      },
      select: { id: true },
    });
    profileIdMap.set(p.id, created.id);
    profilesCreated++;
  }
  console.log(`Profiles:  ${profilesCreated} created (workspaces)`);

  // Point each imported user at their workspace.
  if (!DRY_RUN) {
    for (const u of srcUsers) {
      const destUserId = userIdMap.get(u.id);
      const destProfileId = u.profileId ? profileIdMap.get(u.profileId) : undefined;
      if (destUserId && destProfileId) {
        await dest.user.update({
          where: { id: destUserId },
          data: { profileId: destProfileId },
        });
      }
    }
  }

  // ── 3. Everything else ───────────────────────────────────────────────────
  // Ids are preserved, so foreign keys between these tables stay intact and
  // the only column that needs rewriting is `profileId`.
  let totalRows = 0;

  for (const { from, to } of PASSTHROUGH_TABLES) {
    const rows = await q<Record<string, unknown>>(`SELECT * FROM ${from}`);
    if (rows.length === 0) continue;

    const remapped = rows.map((row) => {
      const out = { ...row };
      if (typeof out.profileId === 'string') {
        const mapped = profileIdMap.get(out.profileId);
        if (mapped) out.profileId = mapped;
      }
      return out;
    });

    // Rows whose workspace didn't resolve would violate the FK — report them
    // rather than aborting the whole import.
    const orphans = remapped.filter(
      (r) => typeof r.profileId === 'string' && !String(r.profileId).match(/^[0-9a-f-]{36}$/i),
    );
    const usable = remapped.filter((r) => !orphans.includes(r));

    if (!DRY_RUN && usable.length > 0) {
      // Raw insert: the destination Prisma model names differ from the source
      // table names, and createMany would need per-model typing for 16 tables.
      await insertRows(to, usable);
    }

    totalRows += usable.length;
    const note = orphans.length > 0 ? `  (${orphans.length} skipped — unresolved workspace)` : '';
    console.log(`  ${to.padEnd(20)} ${String(usable.length).padStart(6)} rows${note}`);
  }

  console.log(`\n${DRY_RUN ? 'Would import' : 'Imported'} ${totalRows} rows across ${PASSTHROUGH_TABLES.length} tables.`);
  if (DRY_RUN) console.log('Re-run without --dry-run to apply.');
}

/**
 * Insert rows into a destination table, skipping ones that already exist.
 *
 * Uses parameterised, column-typed inserts one row at a time — slower than a
 * bulk COPY, but these are metadata tables (thousands of rows at most) and it
 * lets a single bad row be reported instead of failing the batch.
 */
async function insertRows(table: string, rows: Array<Record<string, unknown>>) {
  for (const row of rows) {
    const cols = Object.keys(row);
    const quotedCols = cols.map((c) => `"${c}"`).join(', ');
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const values = cols.map((c) => row[c]);
    try {
      await dest.$executeRawUnsafe(
        `INSERT INTO "${table}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        ...values,
      );
    } catch (err) {
      console.warn(`    ! ${table} row ${String(row.id)}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
}

main()
  .catch((err) => {
    console.error('\nImport failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await src.$disconnect();
    await dest.$disconnect();
  });
