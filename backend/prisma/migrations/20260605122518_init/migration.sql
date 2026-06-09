-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('free', 'pro');

-- CreateEnum
CREATE TYPE "DatabaseType" AS ENUM ('nosql', 'sql');

-- CreateEnum
CREATE TYPE "DatabaseStatus" AS ENUM ('provisioning', 'active', 'stopped', 'deleted');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "databases" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "dbName" TEXT NOT NULL,
    "type" "DatabaseType" NOT NULL,
    "port" INTEGER NOT NULL,
    "host" TEXT NOT NULL,
    "status" "DatabaseStatus" NOT NULL DEFAULT 'provisioning',
    "storageUsed" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConnectedAt" TIMESTAMP(3),

    CONSTRAINT "databases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credentials" (
    "id" UUID NOT NULL,
    "databaseId" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "databases_dbName_key" ON "databases"("dbName");

-- CreateIndex
CREATE UNIQUE INDEX "databases_port_key" ON "databases"("port");

-- CreateIndex
CREATE INDEX "databases_userId_idx" ON "databases"("userId");

-- CreateIndex
CREATE INDEX "credentials_databaseId_idx" ON "credentials"("databaseId");

-- AddForeignKey
ALTER TABLE "databases" ADD CONSTRAINT "databases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "databases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
