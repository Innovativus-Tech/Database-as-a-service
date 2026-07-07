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
                          ┌────────────────────────── VPS / Docker host ─┐
  browser ── https ────▶  │ frontend (Next.js :3030)                     │
                          │ backend  (Express :4000)──── docker.sock     │
  ALL mongo DBs, 1 port ▶ │ nginx TLS-SNI router (:27018)                │
   <db>-<id>.mongo.HOST   │   ├─ customdb-mongo-<user>-<db>  (mongo:7)   │
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
    (`<db>-<id8>.mongo.<VPS_HOST>`) resolving to the same IP; nginx terminates
    TLS on ONE shared port (`MONGO_PUBLIC_PORT`, default 27018) and routes by
    SNI to the right container — the same design as Atlas's
    `cluster0.xxxxx.mongodb.net`. **Requires a wildcard DNS record
    `*.mongo.<VPS_HOST>` → VPS IP.**
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
mongodb://cdb_xxxx:PASSWORD@mydb-3f9a2b1c.mongo.localhost:27018/mydb?authSource=admin&tls=true&tlsAllowInvalidCertificates=true
```

(`*.localhost` names resolve to 127.0.0.1 on modern systems, so SNI routing
works locally without DNS setup.)

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
   domain (e.g. `api.dbaas.example.com`) at the host, **plus a wildcard
   record `*.mongo.<VPS_HOST>` → VPS IP** (e.g. `*.mongo.dbaas.example.com`)
   — Mongo's single-port SNI routing hands out a unique hostname per
   database under that wildcard. Postgres connection strings use `VPS_HOST`
   verbatim, so that name must resolve publicly too.
2. **Environment** — copy `.env.example` → `.env` and set real values:

   | Variable | Purpose |
   |---|---|
   | `JWT_SECRET` | Session token signing + Redis credential derivation. Long random string. Rotating it logs everyone out and rotates every Redis cache password. |
   | `CREDENTIAL_ENC_KEY` | AES-256-GCM key for stored DB passwords. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
   | `META_DB_PASSWORD` | Platform Postgres password. |
   | `REDIS_PASSWORD` | Platform Redis password (public port 6380 — must be strong). |
   | `VPS_HOST` | Public hostname baked into every connection string. |
   | `FRONTEND_ORIGIN` | Dashboard origin, e.g. `https://dbaas.example.com`. CORS for the dashboard API is locked to this origin's registrable domain. |
   | `PUBLIC_API_URL` | Public backend URL, baked into the frontend at build time. |
   | `SMTP_URL` or `SMTP_HOST/PORT/USER/PASS` | Password-reset email. If unset, reset links are printed to backend logs. |
   | `DB_LIMIT`, `STORAGE_LIMIT_GB` | **Optional caps. Empty = unlimited (default).** |

3. **Ports** — only four data-plane ports total, regardless of how many
   databases exist: `3030` (or your proxy) for the dashboard, the API route,
   `MONGO_PUBLIC_PORT` (default `27018`) for ALL Mongo databases,
   `PG_PUBLIC_PORT` (default `5433`) for ALL Postgres databases, and `6380`
   (Redis). Capacity per type is bounded by the internal port-bookkeeping
   ranges (`NOSQL_PORT_MIN/MAX`, `SQL_PORT_MIN/MAX`, 100 each by default) —
   widening those needs no firewall or compose changes anymore.
4. **Deploy** — `docker compose up -d --build`. The backend runs
   `prisma migrate deploy` on start, reconciles user containers, rewrites
   the SNI routing map, and re-provisions Redis ACLs.
5. **Backups** — user data lives under `/data/<user>-<db>` on the host, the
   platform metadata in the `meta-db-data` volume. Snapshot both. (Per-DB
   dumps: `docker exec customdb-mongo-… mongodump`, or use the dashboard's
   import/export.)

## Connection strings

Every database gets two formats (dashboard → database → Overview):

- **Standard** — works with any tool, exactly like Atlas minus SRV records:
  - Mongo: `mongodb://USER:PASS@HOST:PORT/DB?authSource=admin&tls=true&tlsAllowInvalidCertificates=true`
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
