# File Logger — Project Summary

> This document follows the [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) format.
> Every section links to the detailed wiki page that covers it. Read this file first; follow links to go deeper.

---

## What is this?

**File Logger** is a self-hosted log viewer and visualization dashboard for structured log files. It:
1. **Ingests** `.log` files from a `logs/` directory into a local SQLite database
2. **Watches** those files for new entries (live tail) and adds them to the database within seconds
3. **Serves** a browser dashboard with search, filters, timeline charts, level distribution, HTTP stats, and a log table

There is no external database server, no cloud dependency, and no build step for the frontend. One `docker compose up` is enough to run it.

---

## Key Files

| File | Purpose |
|---|---|
| `src/server.ts` | Fastify HTTP server; mounts API routes and EJS views |
| `src/ingest.ts` | One-shot log parser; exports `runIngest()` used by CLI and `POST /api/ingest` |
| `src/watcher.ts` | Live file watcher; debounced `fs.watch` + polling fallback for Docker |
| `src/db/index.ts` | Read-only SQLite connection singleton (`getDb`, `resetDb`) |
| `src/db/schema.ts` | SQLite schema + `initDb()` |
| `src/routes/api.ts` | All `/api/*` Fastify routes |
| `src/views/index.ejs` | Main EJS layout; includes all partials |
| `src/public/js/app.js` | Client-side logic (tabs, charts, log table, ingest/download buttons) |
| `src/public/css/styles.css` | Dashboard styles |

---

## Architecture

→ See [wiki/architecture.md](.agent/wiki/architecture.md)

The system is three cooperating processes sharing a WAL-mode SQLite database:

- **Ingest** (one-shot or via API): reads log files, batches rows into SQLite, rebuilds FTS index
- **Watcher** (started by the server): tails files for new lines, inserts rows incrementally
- **Server** (Fastify): serves the dashboard page (EJS SSR) and JSON API (read-only queries)

The browser is a single-page app with three tabs (Dashboard, Charts, Logs). No frontend framework — vanilla JS + Chart.js.

---

## Log Format

→ See [wiki/log-format.md](.agent/wiki/log-format.md)

Every line must start with a timestamp:
```
2024-12-18 13:12 +00:00: <message>
```

Messages can be plain text (level inferred by keyword) or pino JSON (level, HTTP method/URL/status, response time extracted).

Continuation lines (stack traces) are appended to the parent entry.

---

## Database

→ See [wiki/database-schema.md](.agent/wiki/database-schema.md)

Two tables: `logs` (all entries) and `ingestion_log` (file tracking). One FTS5 virtual table for full-text search on log messages.

---

## API

→ See [wiki/api-reference.md](.agent/wiki/api-reference.md)

Key endpoints:
- `GET /api/logs` — paginated log search with FTS and filters
- `GET /api/stats/*` — aggregated stats (levels, timeline, HTTP status, top URLs)
- `POST /api/ingest` — trigger ingestion from the dashboard (button in the topbar)
- `GET /api/files/download` — download a raw log file

---

## Development

→ See [wiki/development.md](.agent/wiki/development.md)

```bash
npm install
npm run ingest   # parse logs/ into SQLite
npm run dev      # hot-reload dev server at http://localhost:3000
```

Key scripts: `build`, `start`, `dev`, `lint`, `format`, `ingest`, `ingest:force`, `ingest:check`

---

## Requirements

- Node.js 22.5+ (uses `node:sqlite` built-in module — no native addons required)
- Or Docker (no Node.js needed on the host)

---

## Tasks

→ See [tasks.md](./tasks.md) for the full step-by-step implementation checklist.
