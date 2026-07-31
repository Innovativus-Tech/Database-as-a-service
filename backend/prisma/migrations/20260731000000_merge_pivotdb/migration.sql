-- AlterTable
ALTER TABLE "users" ADD COLUMN     "invitedBy" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "profileId" UUID,
ADD COLUMN     "profileRole" TEXT NOT NULL DEFAULT 'admin';

-- AlterTable
ALTER TABLE "databases" ADD COLUMN     "connectionId" TEXT;

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerUserId" UUID,
    "legacyAdminId" TEXT,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encryptedUri" TEXT NOT NULL,
    "dbType" TEXT NOT NULL DEFAULT 'mongodb',
    "topology" TEXT NOT NULL,
    "metadata" JSONB,
    "dbVersion" TEXT,
    "tags" TEXT[],
    "readOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "profileId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "managed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_jobs" (
    "id" TEXT NOT NULL,
    "profileId" UUID NOT NULL,
    "connectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "databases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "schedule" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "lastRunError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "sizeBytes" BIGINT,
    "filePath" TEXT,
    "databases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "errorMsg" TEXT,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restore_runs" (
    "id" TEXT NOT NULL,
    "backupRunId" TEXT NOT NULL,
    "targetConnectionId" TEXT NOT NULL,
    "profileId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "log" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restore_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "profileId" UUID NOT NULL,
    "exportType" TEXT NOT NULL DEFAULT 'collection',
    "database" TEXT NOT NULL,
    "collection" TEXT,
    "query" JSONB NOT NULL,
    "isPipeline" BOOLEAN NOT NULL DEFAULT false,
    "format" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "destination" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fileKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_jobs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceConnId" TEXT NOT NULL,
    "destConnId" TEXT NOT NULL,
    "profileId" UUID NOT NULL,
    "scope" JSONB NOT NULL,
    "options" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tempDirPath" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_runs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "phase" TEXT,
    "dumpSizeBytes" INTEGER,
    "counts" JSONB,
    "errorReport" JSONB,
    "logLines" TEXT[],

    CONSTRAINT "migration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "counts" JSONB,
    "errorReport" JSONB,
    "exportJobId" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL,
    "profileId" UUID NOT NULL,
    "connectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmail" TEXT,
    "notifyWebhook" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "firingStartedAt" TIMESTAMP(3),
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "profileId" UUID NOT NULL,
    "connectionId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "condition" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'firing',
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "note" TEXT,
    "notified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_queries" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "profileId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "database" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "isPipeline" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_jobs_v2" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "profileId" UUID NOT NULL,
    "sourceConnId" TEXT NOT NULL,
    "destConnId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "destType" TEXT NOT NULL,
    "sourceDatabase" TEXT,
    "destDatabase" TEXT,
    "schemaMapping" JSONB,
    "typeMappingRules" JSONB,
    "sampleSize" INTEGER NOT NULL DEFAULT 1000,
    "batchSize" INTEGER NOT NULL DEFAULT 1000,
    "parallelism" INTEGER NOT NULL DEFAULT 1,
    "dropExisting" BOOLEAN NOT NULL DEFAULT false,
    "failOnTypeConflict" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "migration_jobs_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_runs_v2" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "profileId" UUID NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'queued',
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "totalNamespaces" INTEGER NOT NULL DEFAULT 0,
    "succeededNs" INTEGER NOT NULL DEFAULT 0,
    "failedNs" INTEGER NOT NULL DEFAULT 0,
    "totalWritten" INTEGER NOT NULL DEFAULT 0,
    "totalSkipped" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "progress" JSONB,
    "warnings" JSONB,
    "errors" JSONB,
    "ddlPreview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_runs_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cdc_sync_jobs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "profileId" UUID NOT NULL,
    "sourceConnId" TEXT NOT NULL,
    "destConnId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "destType" TEXT NOT NULL,
    "sourceDatabase" TEXT,
    "destDatabase" TEXT,
    "namespaces" JSONB,
    "schemaMapping" JSONB,
    "typeMappingRules" JSONB,
    "bootstrap" TEXT NOT NULL DEFAULT 'snapshot',
    "snapshotState" TEXT NOT NULL DEFAULT 'pending',
    "cursor" JSONB,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "lastEventAt" TIMESTAMP(3),
    "lastError" TEXT,
    "pauseRequested" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cdc_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cdc_sync_runs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "profileId" UUID NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'bootstrapping',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "inserts" INTEGER NOT NULL DEFAULT 0,
    "updates" INTEGER NOT NULL DEFAULT 0,
    "deletes" INTEGER NOT NULL DEFAULT 0,
    "errorsCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "endCursor" JSONB,

    CONSTRAINT "cdc_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_ownerUserId_key" ON "profiles"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_legacyAdminId_key" ON "profiles"("legacyAdminId");

-- CreateIndex
CREATE INDEX "connections_profileId_idx" ON "connections"("profileId");

-- CreateIndex
CREATE INDEX "users_profileId_idx" ON "users"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "databases_connectionId_key" ON "databases"("connectionId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "databases" ADD CONSTRAINT "databases_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_jobs" ADD CONSTRAINT "backup_jobs_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_jobs" ADD CONSTRAINT "backup_jobs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "backup_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restore_runs" ADD CONSTRAINT "restore_runs_backupRunId_fkey" FOREIGN KEY ("backupRunId") REFERENCES "backup_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restore_runs" ADD CONSTRAINT "restore_runs_targetConnectionId_fkey" FOREIGN KEY ("targetConnectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restore_runs" ADD CONSTRAINT "restore_runs_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_sourceConnId_fkey" FOREIGN KEY ("sourceConnId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_destConnId_fkey" FOREIGN KEY ("destConnId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "migration_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_exportJobId_fkey" FOREIGN KEY ("exportJobId") REFERENCES "export_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "alert_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_queries" ADD CONSTRAINT "saved_queries_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_queries" ADD CONSTRAINT "saved_queries_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_jobs_v2" ADD CONSTRAINT "migration_jobs_v2_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_jobs_v2" ADD CONSTRAINT "migration_jobs_v2_sourceConnId_fkey" FOREIGN KEY ("sourceConnId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_jobs_v2" ADD CONSTRAINT "migration_jobs_v2_destConnId_fkey" FOREIGN KEY ("destConnId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_runs_v2" ADD CONSTRAINT "migration_runs_v2_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "migration_jobs_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cdc_sync_jobs" ADD CONSTRAINT "cdc_sync_jobs_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cdc_sync_jobs" ADD CONSTRAINT "cdc_sync_jobs_sourceConnId_fkey" FOREIGN KEY ("sourceConnId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cdc_sync_jobs" ADD CONSTRAINT "cdc_sync_jobs_destConnId_fkey" FOREIGN KEY ("destConnId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cdc_sync_runs" ADD CONSTRAINT "cdc_sync_runs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "cdc_sync_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

