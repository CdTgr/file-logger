# File Logger — Project Summary

> This document follows the [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) format.
> Every section links to the detailed wiki page that covers it. Read this file first; follow links to go deeper.

---

## What is this?

**File Logger** is a self-hosted log viewer and visualization dashboard for structured log files. It:
1. **Watches** `.log`/`.txt` files in a `logs/` directory — on startup the watcher backfills all existing content incrementally, then tails for new entries in real time
2. **Stores** entries in a PostgreSQL database with monthly range partitions on `timestamp_unix`
3. **Serves** a browser dashboard with search, filters, timeline charts, level distribution, HTTP stats, and a log table

No blocking ingest at startup — the server is available immediately. An optional CLI (`yarn ingest`) exists for manual full re-ingestion.

---

## Key Files

| File | Purpose |
|---|---|
| `src/server.ts` | Fastify HTTP server; calls `initDb()`, starts watcher, mounts API routes and EJS views |
| `src/ingest.ts` | One-shot log parser; exports `runIngest()` used by CLI and `POST /api/ingest` |
| `src/watcher.ts` | Async live file watcher; 4 MB chunked reads; `isReading` guard; debounced `fs.watch` + polling |
| `src/db/index.ts` | Exports `sql` — postgres pool singleton (porsager v3) |
| `src/db/schema.ts` | Async `initDb()` — creates `ingestion_log`, partitioned `logs` table, indexes |
| `src/db/partitions.ts` | `ensurePartitionsForTimestamps()` — creates monthly partitions on demand, cached in a `Set` |
| `src/routes/index.ts` | Registers all route plugins under `registerApiRoutes()` |
| `src/routes/utils.ts` | Returns `sql\`...\`` fragments: `fileFilter`, `levelFilter`, `fromFilter`, `toFilter`, `bucketExpr` |
| `src/views/index.ejs` | Main EJS layout; includes all partials |
| `src/public/js/app.js` | Client-side logic (tabs, charts, log table, ingest/download buttons) |
| `src/public/css/styles.css` | Dashboard styles |

---

## Architecture

→ See [wiki/architecture.md](./wiki/architecture.md)

The system has two cooperating processes sharing a PostgreSQL database:

- **Watcher** (started by the server at boot): backfills existing log files in 4 MB chunks, then tails for new lines; inserts rows via postgres bulk insert; updates `ingestion_log.file_size` offset to prevent duplicates on restart
- **Server** (Fastify): calls `initDb()`, starts the watcher, serves the dashboard page (EJS SSR) and JSON API

An optional **Ingest** CLI (`yarn ingest`) does a full synchronous re-parse of all files — useful for historical data or forced re-ingestion.

The browser is a single-page app with three tabs (Dashboard, Charts, Logs). Vanilla JS + Chart.js, no frontend framework.

---

## Log Format

→ See [wiki/log-format.md](./wiki/log-format.md)

Every line must start with a timestamp:
```
2024-12-18 13:12 +00:00: <message>
```

Messages can be plain text (level inferred by keyword) or pino JSON (level, HTTP method/URL/status, response time extracted).

Continuation lines (stack traces) are appended to the parent entry.

---

## Database

→ See [wiki/database-schema.md](./wiki/database-schema.md)

PostgreSQL with two tables: `logs` (partitioned by month on `timestamp_unix`) and `ingestion_log` (file offset tracking). Full-text search via a `message_tsv TSVECTOR GENERATED ALWAYS AS` column with a GIN index.

---

## API

→ See [wiki/api-reference.md](./wiki/api-reference.md)

Key endpoints:
- `GET /api/logs` — paginated log search with full-text search (`plainto_tsquery`) and filters
- `GET /api/stats/*` — aggregated stats (levels, timeline, HTTP status, top URLs)
- `POST /api/ingest` — trigger re-ingestion from the dashboard (button in the topbar)
- `GET /api/files/download` — download a raw log file

---

## Development

→ See [wiki/development.md](./wiki/development.md)

```bash
corepack enable      # activate Yarn v4
yarn install
yarn dev             # hot-reload dev server at http://localhost:3000
```

Key scripts: `build`, `start`, `dev`, `lint`, `format`, `ingest`, `ingest:force`, `ingest:check`

---

## Requirements

- Node.js 22.5+, Yarn 4 (corepack-managed), PostgreSQL 14+
- Or Docker (no local dependencies needed)

---

## Tasks

→ See [tasks.md](./tasks.md) for the full step-by-step implementation checklist.
