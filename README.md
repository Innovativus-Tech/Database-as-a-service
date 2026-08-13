# CustomDB — Database as a Service + Data Operations Platform

Self-hosted MongoDB + PostgreSQL as a service, in the style of MongoDB Atlas:
every database you create in the dashboard gets its **own isolated container**,
its **own credentials**, and a **standard connection string** that works with
mongosh, Compass, psql, and every official driver — plus an optional SDK
connection string with transparent Redis caching.

**It also operates databases, not just provisions them.** This repository is
the merge of two previously separate products — CustomDB (provisioning) and
PivotDB (operations) — into one application with one login:

| | |
|---|---|
| **Provision** | Isolated Mongo/Postgres containers, single-port gateways, per-DB Redis cache users, SDK |
| **Explore** | Browse schemas, run queries and aggregations, inspect documents and rows |
| **Migrate** | All 9 cross-engine directions (Mongo ↔ Postgres ↔ MySQL) with schema inference and type translation |
| **Sync (CDC)** | Continuous replication via PG logical replication, Mongo change streams, MySQL binlog |
| **Protect** | Scheduled backups with native engine tools, AES-256-GCM archives, one-click restore |
| **Monitor** | Engine-aware Grafana dashboards, live current-ops, slow queries, replication lag |
| **Alerts** | Threshold rules with duration debounce, email/webhook notifications |

The two halves are genuinely integrated, not bolted together:

* **One account.** You sign in once, at `/login`. There is no second login,
  no workspace picker. Sessions, 2FA, Google OAuth and password reset all
  come from the CustomDB side and cover every feature.
* **Every provisioned database is automatically a connection.** Create a
  database and it is immediately available in Explore, Migrate, Sync, Protect,
  Monitor and Alerts — nothing to copy, paste or re-enter. External
  Mongo/Postgres/MySQL servers can still be added by hand alongside them.
* **One process, one database, one deployment.** The operations engine runs
  inside the backend and shares its Prisma client; the console is served by
  the same Next.js dashboard under `/operate`.

There are **no plan/tier limits by default** — database count and storage per
user are unlimited unless you explicitly set `DB_LIMIT` / `STORAGE_LIMIT_GB`.

## Architecture

```
                          ┌────────────────────────── VPS / Docker host ─┐
  browser ── https ────▶  │ frontend (Next.js :3030)                     │
                          │ backend  (Express :4000)──── docker.sock     │
  ALL mongo DBs, 1 port ▶ │ nginx TLS-SNI router (:27017)                │
   m-xxxx.mongo.HOST      │   ├─ customdb-mongo-<user>-<db>  (mongo:7)   │
  ALL pg DBs, 1 port ───▶ │ backend pgGateway (:5433)                    │
   postgres://…HOST:5433  │   ├─ customdb-pg-<user>-<db>   (postgres:16) │
                          │   └─ … one container per database            │
  redis cache ──────────▶ │ redis (:6380, per-DB ACL users)              │
                          │ meta-db (postgres:16, platform metadata)     │
                          └──────────────────────────────────────────────┘
```

- **backend** provisions one Docker container per user database (via the
  mounted Docker socket), maintains the single-port routing tables, and hands
  out connection strings.
- **Single-port data plane** — no per-database port ranges on the host:
  - *Mongo*: every database gets a unique hostname
    (`m-<token>.mongo.<domain>`) resolving to the same IP; nginx terminates
    TLS on ONE shared port (`MONGO_GATEWAY_PORT`, default 27017) and routes
    by SNI to the right container — the same design as Atlas's
    `cluster0.xxxxx.mongodb.net`. **Requires a wildcard DNS record
    `*.mongo.<VPS_HOST>` → VPS IP.** Databases created before gateway
    routing are migrated automatically on backend boot (their old
    connection strings stop working — copy the new one from the dashboard).
  - *Postgres*: PG's STARTTLS-style handshake carries no SNI, so the backend
    runs a small protocol-aware gateway on ONE shared port (`PG_PUBLIC_PORT`,
    default 5433) that reads the startup message's username (globally unique
    per database) and pipes the connection to the right container. Auth still
    happens end-to-end against the real Postgres.
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
mongodb://cdb_xxxx:PASSWORD@m-ab12cd34.mongo.localhost:27017/mydb?authSource=admin&tls=true&tlsAllowInvalidCertificates=true
```

(`*.localhost` names resolve to 127.0.0.1 on modern systems, so SNI routing
works locally without DNS setup.)

Test it exactly like an Atlas string:

```bash
mongosh "mongodb://cdb_xxxx:PASSWORD@m-ab12cd34.mongo.localhost:27017/mydb?authSource=admin&tls=true&tlsAllowInvalidCertificates=true"
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
   | `MONGO_GATEWAY_ENABLED` | Set `false` to disable gateway routing for newly created Mongo DBs (not recommended — the legacy port ranges are no longer published). |
   | `PG_PUBLIC_PORT` | Shared public Postgres port (pgGateway). Default `5433`. |
   | `FRONTEND_ORIGIN` | Dashboard origin, e.g. `https://dbaas.example.com`. CORS for the dashboard API is locked to this origin's registrable domain. |
   | `PUBLIC_API_URL` | Public backend URL, baked into the frontend at build time. |
   | `SMTP_URL` or `SMTP_HOST/PORT/USER/PASS` | Password-reset email. If unset, reset links are printed to backend logs. |
   | `DB_LIMIT`, `STORAGE_LIMIT_GB` | **Optional caps. Empty = unlimited (default).** |

3. **Ports** — the data plane stays a fixed set no matter how many databases
   exist: `3030` (or your proxy) for the dashboard, the API route,
   `MONGO_GATEWAY_PORT` (default `27017`) for ALL Mongo databases,
   `PG_PUBLIC_PORT` (default `5433`) for ALL Postgres databases, and `6380`
   (Redis). Grafana and Prometheus add no host ports at all: Prometheus is
   internal-only, and Grafana is routed through the reverse proxy like the
   dashboard and API (give it a domain and point `GRAFANA_PUBLIC_URL` at it —
   the Monitor page embeds it in an iframe, so it must resolve from the
   user's browser).
4. **Deploy** — `docker compose up -d --build`. The backend runs
   `prisma migrate deploy` on start, reconciles user containers, rewrites
   nginx stream configs, and re-provisions Redis ACLs.
5. **Backups** — user data lives under `/data/<user>-<db>` on the host, the
   platform metadata in the `meta-db-data` volume, and archives created by the
   Protect feature in the `backup-data` volume. Snapshot all three. (Per-DB
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
| `backend/` | Express API, Prisma schema, provisioning engine (Dockerode), import pipeline, nginx config manager |
| `backend/src/pivot/` | The ported operations engine: migration pipeline, CDC adapters, backup/restore, engine clients, BullMQ workers, and the routes that expose them |
| `backend/src/services/profileBridge.js` | The join between the two halves — gives every user a workspace on demand |
| `backend/src/services/connectionSync.js` | Auto-registers each provisioned database as a connection |
| `backend/prisma/import/` | Data-preserving importer for an existing PivotDB metadata database |
| `frontend/` | Next.js 14 dashboard (App Router) |
| `frontend/components/operate/` | The operations console (React Router SPA), mounted at `/operate` |
| `nginx/` | TCP stream proxy image + per-DB config dir (`stream.d/`) |
| `config/` | Prometheus scrape config + provisioned Grafana dashboards (mongo / pg / mysql) |
| `packages/client/` | `@customdb/client` SDK (Mongo + Postgres wrappers with Redis caching) |

### How the two halves are wired

```
                  ┌──────────── one Express process (:4000) ────────────┐
  /api/auth       │  CustomDB    sessions · 2FA · OAuth · reset         │
  /api/databases  │              provisioning (Dockerode) · gateways    │
                  │      │                                             │
                  │      │  User ──1:1──▶ Profile   ◀── the only join   │
                  │      ▼                    │                        │
  /api/connections│  Database ──mirrors──▶ Connection                   │
  /api/migration-v2│ (auto-registered)         │                        │
  /api/cdc-sync   │  PivotDB engine ◀──────────┘                        │
  /api/backup     │              BullMQ workers · Socket.IO · /metrics  │
  /api/alerts     └─────────────────────────────────────────────────────┘
```

* `Profile` is PivotDB's tenancy unit and stays the scope for every
  connection, job, rule and query. Each user transparently owns exactly one,
  created on first use — the concept never surfaces in the UI.
* A user's own `role` (`user` / `admin`) remains the platform-wide gate;
  `profileRole` (`admin` / `viewer`) controls read-only teammates invited into
  a workspace.

### Notes for maintainers

* **The backend is a TypeScript + JavaScript hybrid.** The CustomDB half is
  CommonJS `.js`; the ported engine is ESM-authored `.ts`. Both compile to
  CommonJS via `tsconfig.json` (`allowJs`), so they share one module graph and
  one Prisma client. Run `npm run build`; the entrypoint is `dist/index.js`.
* **The ported routes still look like Fastify.** `src/pivot/adapter/` is a
  ~150-line shim presenting the slice of Fastify's API those modules use, on
  top of an Express Router. This kept ~2,000 lines of working handlers
  unrewritten and lets upstream PivotDB fixes be pulled across cleanly.
* **The console is a React Router SPA inside Next.js.** `/operate/[[...slug]]`
  renders it client-side with `basename="/operate"`, so deep links and history
  work without rewriting the pages into App Router conventions.

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
- **Connection backfill**: on boot the backend mirrors any active database
  that has no connection yet. This is what upgrades databases created before
  the merge — they appear in the console automatically, no user action needed.
  It is idempotent and also repairs a registration that failed at create time.
- **Two encryption keys, different jobs**: `CREDENTIAL_ENC_KEY` (base64)
  encrypts provisioned-database passwords; `ENCRYPTION_KEY` (64-char hex)
  encrypts stored connection URIs; `BACKUP_ENCRYPTION_KEY` (64-char hex)
  encrypts backup archives. They are not interchangeable, and losing the
  backup key makes existing encrypted archives unrecoverable.
- **Jobs need Redis**: migration, sync, backup, restore and export run on
  BullMQ. Without `REDIS_URL` the backend still starts and everything else
  works — it logs that those features are disabled rather than crash-looping.
- **Intermittent "Gateway Timeout" on a public domain**: every publicly routed
  service (`backend`, `frontend`, `grafana`) sits on **two** networks — `coolify`
  (where Traefik lives) and `customdb-network` (where the DB containers live) —
  so each has two internal IPs. Traefik forwards to only one of them, and with
  no instruction it picks non-deterministically; if it picks the
  `customdb-network` IP it has no route to that subnet, the connection hangs,
  and after Traefik's 30 s dial timeout the browser gets a bare
  `Gateway Timeout`. The container looks healthy throughout, because the compose
  healthcheck dials `127.0.0.1` from inside the container and never crosses the
  broken path. The `traefik.docker.network=coolify` label on those three
  services pins the choice. **Any new service given a public domain must carry
  that label too.** To confirm a live incident: `docker inspect` the container
  and compare its `coolify` IP with the server address in Traefik's dashboard /
  `/api/rawdata` — a mismatch is this bug; if they match, look at timeouts on
  long uploads instead.

## Migrating existing deployments

Both products' data is preserved.

**CustomDB** needs no import. The merged schema is a strict superset of the
old one, so `prisma migrate deploy` (which the backend runs on start) adds the
new tables and columns without touching existing rows. The merge migration
contains no `DROP` statements.

**PivotDB** lives in a separate physical database, so its rows are copied:

```bash
cd backend
PIVOTDB_URL=postgresql://user:pass@old-host:5432/mongovis \
ENCRYPTION_KEY=<the PivotDB deployment's original key> \
  npm run import:pivotdb -- --dry-run     # report only, writes nothing
```

Drop `--dry-run` to apply. The importer:

* copies users, preserving password hashes — PivotDB hashed with `bcryptjs`
  and this backend verifies with `bcrypt`, and the formats are
  interchangeable, so everyone keeps their existing password;
* treats a matching email as the same person, keeping the CustomDB account
  (which may already own databases, 2FA and Google linkage) and attaching the
  PivotDB rows to it;
* recreates each profile as that user's workspace;
* copies connections, jobs, runs, alert rules, saved queries and audit events
  with their original ids, so every foreign key stays valid.

It is idempotent — a re-run after a partial failure resumes rather than
duplicating — and never deletes anything in the destination.

> ⚠ `ENCRYPTION_KEY` **must** be the key that PivotDB deployment used.
> Connection URIs are copied as ciphertext and never decrypted during import;
> a different key leaves every imported connection permanently unreadable.
> The importer verifies the key against a sample row and aborts before writing
> if it doesn't match.
