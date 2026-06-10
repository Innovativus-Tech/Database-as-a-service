-- Phase 4 + Phase 7 schema catch-up:
--   * dbName uniqueness changes from global to per-user
--   * containerName column added (unique, nullable) so we can store the real Docker
--     container name independent of the dbName-based legacy derivation
--   * routing column added — null = legacy direct port binding, "nginx" = via nginx proxy

-- Drop the global @unique on dbName
ALTER TABLE "databases" DROP CONSTRAINT IF EXISTS "databases_dbName_key";

-- Add containerName (nullable, unique)
ALTER TABLE "databases" ADD COLUMN "containerName" TEXT;
CREATE UNIQUE INDEX "databases_containerName_key" ON "databases"("containerName");

-- Add routing
ALTER TABLE "databases" ADD COLUMN "routing" TEXT;

-- New composite unique on (userId, dbName)
CREATE UNIQUE INDEX "databases_userId_dbName_key" ON "databases"("userId", "dbName");
