# Merged backend image.
#
# Two things changed when CustomDB absorbed PivotDB:
#
#   1. The source is now a TypeScript+JavaScript hybrid compiled to CommonJS
#      (see tsconfig.json), so there is a real build step and the entrypoint is
#      dist/index.js rather than src/index.js.
#
#   2. Backup/restore shells out to the NATIVE engine tools (mongodump,
#      pg_dump, mysqldump). Those aren't practical to install on Alpine at the
#      versions we need, so the image moved from node:20-alpine to
#      node:20-bookworm-slim. Prisma's binaryTargets in schema.prisma track
#      this — `debian-openssl-3.0.x`, not `linux-musl-openssl-3.0.x`.
#
# docker-cli is still required: the provisioning engine runs `docker exec` and
# `docker cp` against user database containers through the mounted socket.

# ---- Build stage ----------------------------------------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
# Dev dependencies are needed here (typescript, @types/*) to run the build.
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npx tsc -p tsconfig.json

# Drop dev dependencies so they aren't carried into the runtime image.
RUN npm prune --omit=dev


# ---- Production stage -----------------------------------------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app

# Engine client tools used by the Protect (backup/restore) and Move features.
#
# postgresql-client-17 explicitly, NOT Debian's stock v15: pg_dump refuses to
# dump a server newer than itself, and managed Postgres (Neon, RDS) is on 17 —
# with v15 every backup of those fails with "server version mismatch".
#
# mariadb's mysqldump (default-mysql-client) stands in for Oracle's, whose APT
# repo currently ships an expired GPG key. It's dump-compatible with MySQL 8.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg openssl && \
    install -d -m 0755 /etc/apt/keyrings && \
    \
    curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
      | gpg --dearmor -o /etc/apt/keyrings/mongodb-server-7.0.gpg && \
    echo "deb [ arch=amd64,arm64 signed-by=/etc/apt/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" \
      > /etc/apt/sources.list.d/mongodb-org-7.0.list && \
    \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list && \
    \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      docker.io \
      mongodb-database-tools \
      postgresql-client-17 \
      default-mysql-client && \
    apt-get purge -y gnupg && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

# Re-generate against this stage's OpenSSL/glibc. Same base image, so it's a
# fast no-op rebuild — but it guarantees the query engine matches.
RUN npx prisma generate

# Where backup archives land; docker-compose mounts a persistent volume here.
RUN mkdir -p /app/backups

ENV NODE_ENV=production
EXPOSE 4000

# migrate deploy is idempotent, so running it on every start is safe and
# removes the need for a separate post-deploy step.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
