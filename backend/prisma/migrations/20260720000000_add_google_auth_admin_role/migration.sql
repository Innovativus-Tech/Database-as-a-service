-- Google OAuth sign-in + admin role
CREATE TYPE "Role" AS ENUM ('user', 'admin');

ALTER TABLE "users" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'user';
ALTER TABLE "users" ADD COLUMN "googleId" TEXT;

CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");
