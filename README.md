# CustomDB — Database as a Service

Self-hosted MongoDB + PostgreSQL as a service, in the style of MongoDB Atlas:
every database you create in the dashboard gets its **own isolated container**,
its **own credentials**, and a **standard connection string** that works with
mongosh, Compass, psql, and every official driver — plus an optional SDK
connection string with transparent Redis caching.

There are **no plan/tier limits by default** — database count and storage per
user are unlimited unless you explicitly set `DB_LIMIT` / `STORAGE_LIMIT_GB`.

## Architecture

```
                        ┌──────────────────────────── VPS / Docker host ─┐
  browser ── https ──▶  │ frontend (Next.js :3030)                       │
                        │ backend  (Express :4000)──── docker.sock       │
  mongosh/driver ─────▶ │ nginx TCP proxy (:27017, :5433-5532)           │
    mongodb://…:27017   │   ├─ customdb-mongo-<user>-<db>   (mongo:7)    │
    postgresql://…:5433 │   ├─ customdb-pg-<user>-<db>      (postgres:16)│
                        │   └─ … one container per database              │
  redis cache ────────▶ │ redis (:6380, per-DB ACL users)                │
                        │ meta-db (postgres:16, platform metadata)       │
                        └────────────────────────────────────────────────┘
```

- **backend** provisions one Docker container per user database (via the
  mounted Docker socket), writes nginx stream routing config, and hands out
  connection strings.
- **nginx** routes Mongo through a shared gateway port (`27017`) by SNI
  hostname (`<id>.mongo.<domain>`), so Mongo databases no longer consume one
  public port each. Legacy Mongo port blocks still work. Postgres still uses
  one public port per container because its STARTTLS handshake cannot be SNI
  routed the same way by this simple stream gateway.
- **redis** provides per-database cache users: each database gets an ACL user
  restricted to keys under `cdb:<dbId>:*`, with credentials derived
  deterministically from the platform secret (nothing stored). ACLs are
  re-asserted on backend boot and every 10 minutes, so a Redis restart
  self-heals.
- **meta-db** stores users, databases, credentials (AES-256-GCM encrypted),
  and sessions. Managed with Prisma migrations (run automatically on backend
  start).

## Quick start (local)

Requirements: Docker + Docker Compose v2. Run from the repo root:

```bash
cp .env.example .env        # fill in JWT_SECRET, CREDENTIAL_ENC_KEY, REDIS_PASSWORD
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

- Dashboard: http://localhost:3030
- API: http://localhost:4000
- Create a database in the dashboard → you get a connection string like:

```
mongodb://cdb_xxxx:PASSWORD@localhost:27018/mydb?authSource=admin&tls=true&tlsAllowInvalidCertificates=true
```

Test it exactly like an Atlas string:

```bash
mongosh "mongodb://cdb_xxxx:PASSWORD@localhost:27018/mydb?authSource=admin&tls=true&tlsAllowInvalidCertificates=true"
```

> The `docker-compose.local.yml` override handles the two things that differ
> from a VPS: it removes the Coolify-specific external network, and it maps the
> user-data root to `$PWD/data` with an identical path inside and outside the
> backend container (required because bind-mount paths are resolved by the
> Docker daemon on the **host**). Run compose from the repo root.

## Production deployment

Any Linux host with Docker works. The stock `docker-compose.yml` is written
for a Coolify-managed VPS (Traefik on the external `coolify` network routes
`https://api.<domain>` to the backend and the frontend serves on port 3030).
On a non-Coolify host, deploy with the local override or replace the `coolify`
network with your own reverse-proxy network.

1. **DNS** — point your dashboard domain (e.g. `dbaas.example.com`) and API
   domain (e.g. `api.dbaas.example.com`) at the host. Also point wildcard
   Mongo gateway DNS (e.g. `*.mongo.dbaas.example.com`) at the host.
2. **Environment** — copy `.env.example` → `.env` and set real values:

   | Variable | Purpose |
   |---|---|
   | `JWT_SECRET` | Session token signing + Redis credential derivation. Long random string. Rotating it logs everyone out and rotates every Redis cache password. |
   | `CREDENTIAL_ENC_KEY` | AES-256-GCM key for stored DB passwords. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
   | `META_DB_PASSWORD` | Platform Postgres password. |
   | `REDIS_PASSWORD` | Platform Redis password (public port 6380 — must be strong). |
   | `VPS_HOST` | Public hostname baked into every connection string. |
   | `MONGO_GATEWAY_DOMAIN` | Wildcard-backed domain for new Mongo DBs, e.g. `mongo.dbaas.example.com`. |
   | `MONGO_GATEWAY_PORT` | Shared public Mongo gateway port. Default `27017`. |
   | `MONGO_GATEWAY_ENABLED` | Set `false` to use legacy per-port Mongo routing. |
   | `FRONTEND_ORIGIN` | Dashboard origin, e.g. `https://dbaas.example.com`. CORS for the dashboard API is locked to this origin's registrable domain. |
   | `PUBLIC_API_URL` | Public backend URL, baked into the frontend at build time. |
   | `SMTP_URL` or `SMTP_HOST/PORT/USER/PASS` | Password-reset email. If unset, reset links are printed to backend logs. |
   | `DB_LIMIT`, `STORAGE_LIMIT_GB` | **Optional caps. Empty = unlimited (default).** |

3. **Ports** — open `3030` (or your proxy), the API route, `27017` (Mongo
   gateway), `5433-5532` (Postgres), and `6380` (Redis) in the firewall.
   Keep `27018-27117` open only if you still have legacy Mongo databases
   created before gateway routing. Widen the Postgres range via
   `SQL_PORT_MIN/MAX` and keep it in sync with `docker-compose.yml`.
4. **Deploy** — `docker compose up -d --build`. The backend runs
   `prisma migrate deploy` on start, reconciles user containers, rewrites
   nginx stream configs, and re-provisions Redis ACLs.
5. **Backups** — user data lives under `/data/<user>-<db>` on the host, the
   platform metadata in the `meta-db-data` volume. Snapshot both. (Per-DB
   dumps: `docker exec customdb-mongo-… mongodump`, or use the dashboard's
   import/export.)

## Connection strings

Every database gets two formats (dashboard → database → Overview):

- **Standard** — works with any tool, exactly like Atlas minus SRV records:
  - Mongo: `mongodb://USER:PASS@DBHOST:27017/DB?authSource=admin&tls=true&tlsAllowInvalidCertificates=true`
  - Postgres: `postgresql://USER:PASS@HOST:PORT/DB?sslmode=require`
  - TLS is transport encryption with a self-signed cert (`tlsAllowInvalidCertificates` / `sslmode=require`). To get full
    identity verification like Atlas, install a CA-issued cert in
    `nginx/Dockerfile` and drop the invalid-cert flag.
- **SDK** — same URL with the `customdb://` (or `customdb-pg://`) scheme, for
  [`@customdb/client`](packages/client): the SDK discovers per-DB Redis
  credentials via `/api/cache-config` and caches reads (~60s TTL) with
  automatic invalidation on writes. If Redis is unreachable the SDK degrades
  to direct database access — never fails a query because the cache is down.

The Mongo user has `readWriteAnyDatabase` + `dbAdminAnyDatabase` inside its
container, so one connection can create/use many logical Mongo databases —
same as an Atlas cluster. Isolation between customers is at the container
level.

## Repo layout

| Path | What |
|---|---|
| `backend/` | Express API, Prisma schema, provisioning engine (Dockerode), import pipeline (worker threads), nginx config manager |
| `frontend/` | Next.js 14 dashboard (App Router) |
| `nginx/` | TCP stream proxy image + per-DB config dir (`stream.d/`) |
| `packages/client/` | `@customdb/client` SDK (Mongo + Postgres wrappers with Redis caching) |

## Operations notes

- **Healthchecks**: containers probe `/healthz` (liveness only — never touches
  the DB). `/health` does a real `SELECT 1` for humans/monitoring.
- **Resource isolation**: user DB containers are capped (1 GB RAM, 0.5 CPU,
  reduced I/O weight); platform services get OOM protection and 2× CPU shares,
  so a runaway tenant can't take down login. Tune via `USER_DB_MEMORY_MB`,
  `USER_DB_CPU_QUOTA`.
- **Imports**: `.json`/`.csv` (streamed inserts), mongodump `.zip`, pg_dump
  `.sql`. 200 MB upload cap, 4 GB decompressed cap, runs in a worker thread
  with job-status polling. CSV→Postgres **replaces** a same-named table.
- **Container recovery**: if a user DB container is removed (host reboot,
  manual `docker rm`), the backend recreates it from the surviving data dir on
  boot or via the dashboard's Restart button.
