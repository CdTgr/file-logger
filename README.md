# File Logger

A self-hosted log viewer and visualization dashboard for structured log files. Ingests logs into PostgreSQL for fast querying, watches files for live updates, and serves a browser-based dashboard with search, filters, and charts.

## Features

- **Live ingestion** — server starts instantly; watcher backfills existing files in the background and tails for new entries in real time
- **Full-text search** — PostgreSQL `tsvector`-powered keyword search across all log messages
- **Filters** — filter by date range, log level (TRACE / DEBUG / INFO / WARN / ERROR / FATAL), and keyword
- **Multi-file support** — switch between log files via a dropdown; all files are ingested automatically
- **Charts** — log volume over time (stacked by level), level distribution, HTTP status breakdown, top request paths
- **Stack trace bundling** — multi-line stack traces are attached to their parent log entry
- **PostgreSQL-backed** — monthly range partitions keep queries fast as data grows; no manual maintenance
- **Docker-ready** — single `docker compose up` command

## Quick Start

### Local

Requires a running PostgreSQL instance (default connection: `postgres://logger:logger@localhost:5432/logger`).

```bash
corepack enable         # activate Yarn v4 (once)
yarn install
yarn dev                # dashboard at http://localhost:3000
```

The watcher starts automatically and backfills any existing files in `logs/`. To manually re-ingest:

```bash
yarn ingest             # parse logs/ into PostgreSQL (skips unchanged files)
```

### Docker

```bash
docker compose up -d
```

Starts a `postgres:17-alpine` container and the logger service. The logger waits for Postgres to be healthy before starting, then the watcher picks up all log files automatically — no blocking ingest step.

## Project Structure

```
├── src/
│   ├── server.ts          Fastify server entry point
│   ├── ingest.ts          One-shot log parser (CLI + POST /api/ingest)
│   ├── watcher.ts         Live file watcher (fs.watch + polling fallback)
│   ├── db/
│   │   ├── index.ts       postgres pool singleton (exports `sql`)
│   │   ├── schema.ts      PostgreSQL DDL + async initDb()
│   │   └── partitions.ts  Monthly partition management
│   ├── routes/            Fastify route plugins (status, files, logs, stats, ingest)
│   ├── views/             EJS templates
│   └── public/            Static assets (CSS, client JS)
├── logs/                  Drop log files here (bind-mounted in Docker)
├── dist/                  TypeScript compiled output (gitignored)
├── Dockerfile
├── docker-compose.yml
└── .yarnrc.yml
```

## Log Format

File Logger parses lines in this format, produced by pino and similar loggers:

```
2024-12-18 13:12 +00:00: {"level":30,"time":...,"msg":"Server started"}
2024-12-18 13:15 +00:00: TypeError: Cannot read property 'id' of undefined
    at handler (/app/routes/user.js:42:18)
    at process.processTicksAndRejections
```

- Lines starting with a timestamp are treated as new log entries
- Continuation lines (stack traces, extra context) are bundled into the preceding entry
- JSON lines from pino are parsed to extract `level`, `msg`, HTTP method/URL/status, response time, pid, and hostname

## Scripts

| Command | Description |
| --- | --- |
| `yarn dev` | Dev server with hot-reload at http://localhost:3000 |
| `yarn build` | Compile TypeScript to `dist/` |
| `yarn start` | Run compiled production server |
| `yarn lint` | Lint TypeScript source |
| `yarn format` | Format source files with Prettier |
| `yarn ingest` | Parse all files in `logs/` into PostgreSQL. Skips unchanged files. |
| `yarn ingest:force` | Re-ingest all files from scratch. |
| `yarn ingest:check` | Show ingestion status without writing anything. |

## Configuration

All options are environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | derived | Full PostgreSQL connection string. Takes priority over individual vars. |
| `POSTGRES_USER` | `logger` | Used to build connection string if `DATABASE_URL` is not set |
| `POSTGRES_PASSWORD` | `logger` | Used to build connection string if `DATABASE_URL` is not set |
| `POSTGRES_HOST` | `localhost` | Used to build connection string if `DATABASE_URL` is not set |
| `POSTGRES_PORT` | `5432` | Used to build connection string if `DATABASE_URL` is not set |
| `POSTGRES_DB` | `logger` | Used to build connection string if `DATABASE_URL` is not set |
| `LOGS_DIR` | `./logs` | Directory containing `.log`/`.txt` files to watch |
| `PORT` | `3000` | HTTP port |
| `POLL_MS` | `5000` | Watcher polling interval in ms. Set to `0` to disable. Useful in Docker where bind-mount events may not propagate. |

## Docker Details

`docker-compose.yml` defines two services:

- **`postgres`** — `postgres:17-alpine` with a `pg-data` named volume for persistence; health-checked via `pg_isready`
- **`file-logger`** — waits for `postgres` to be healthy before starting; mounts `./logs` → `/app/logs`

To reset the database:

```bash
docker compose down -v   # removes the pg-data volume
docker compose up -d
```

## Requirements

- Node.js 22.5+, Yarn 4 (via corepack), and PostgreSQL 14+
- Or Docker (no local dependencies needed)
