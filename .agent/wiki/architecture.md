# Architecture

> See also: [API Reference](./api-reference.md) · [Database Schema](./database-schema.md) · [Log Format](./log-format.md)

## System Overview

File Logger is a self-hosted log viewer. It watches structured log files from a `logs/` directory, ingests them into PostgreSQL incrementally, and serves a browser dashboard for search and visualization.

```
logs/ (bind-mounted)
  └── *.log / *.txt files
         │
         ▼
   [watcher.ts]         Async live tail — 4 MB chunks, setImmediate yield
         │              backfills on startup, then watches for new bytes
         ▼
   PostgreSQL
   ├── logs             Partitioned by month (logs_YYYY_MM)
   │   └── message_tsv  TSVECTOR generated column (GIN-indexed)
   └── ingestion_log    Per-file byte offset (prevents duplicate rows on restart)
         │
         ▼
   [server.ts]          Fastify HTTP server
    ├── /api/*          JSON API routes (async postgres queries)
    └── /               EJS-rendered dashboard
         │
         ▼
   Browser (vanilla JS + Chart.js)
```

Optional: `[ingest.ts]` — CLI one-shot batch re-ingestion (`yarn ingest`), also callable via `POST /api/ingest`.

## Components

### `src/server.ts`

Fastify HTTP server. Responsibilities:
- Call `initDb()` at startup (idempotent PostgreSQL DDL)
- Register `@fastify/view` (EJS engine, root = `src/views/`)
- Register `@fastify/static` (public assets at `/public/`)
- Mount API route plugins from `src/routes/`
- Serve the dashboard at `GET /` (EJS render with server-side file list and pre-selected file)
- Start the async file watcher via `await startWatcher({ logsDir })`

### `src/ingest.ts`

One-shot log parser. Entry points:
- `runIngest(options)` — exported async function, used by both CLI and the `POST /api/ingest` route
- `main()` — CLI wrapper that calls `runIngest()` and closes the pool

Parsing pipeline per file:
1. Read file line by line via `readline`
2. Match lines against `TS_RE` timestamp regex
3. Build a row object (plain text or pino JSON)
4. Call `ensurePartitionsForTimestamps()` before each batch insert
5. Bulk-insert rows into PostgreSQL (`sql(batch, ...cols)`, 10,000 rows/batch)
6. Upsert `ingestion_log` entry via `ON CONFLICT`

No FTS rebuild step needed — `message_tsv` is a generated column, always current.

### `src/watcher.ts`

Async live file watcher. `startWatcher(config)` is async — it calls `initDb()` then returns a `LogWatcher` instance that:
- On `start()`: reads `ingestion_log` to restore per-file byte offsets (prevents duplicates on restart)
- Uses `fs.watch` (recursive on macOS/Windows, per-dir on Linux)
- Falls back to polling every `POLL_MS` ms (default 5 s) for Docker bind-mounts
- Debounces file-change events (300 ms) then calls `_readChunked()`
- `_readChunked()` sets `isReading = true` and launches `_processChunks()` (fire-and-forget `void`)
- `_processChunks()` is a `while(true)` loop: reads 4 MB, parses lines, awaits `_insertRows()`, then `await new Promise(resolve => setImmediate(resolve))` to yield the event loop before the next chunk
- Trailing partial lines flushed after `FLUSH_MS` (5 s) via a debounced timer

### `src/db/index.ts`

Exports `sql` — a `postgres` (porsager v3) pool singleton. Connection resolved from `DATABASE_URL` or individual `POSTGRES_*` env vars. Pool: max 10 connections, 30 s idle timeout.

### `src/db/schema.ts`

Exports async `initDb()` — runs PostgreSQL DDL via `sql.unsafe()` (each statement separate). Creates `ingestion_log`, the partitioned `logs` parent table, and all indexes. Idempotent (`IF NOT EXISTS` throughout).

### `src/db/partitions.ts`

Exports `ensurePartitionsForTimestamps(timestamps: number[])`. For each unique year+month in the input:
- If already in the module-level `Set<string>` cache, skip
- Otherwise: `CREATE TABLE IF NOT EXISTS logs_YYYY_MM PARTITION OF logs FOR VALUES FROM (...) TO (...)`
- Add to cache

Called before every batch insert in both watcher and ingest.

### `src/routes/`

Six Fastify plugins, each in its own file:

| File | Routes |
|---|---|
| `status.ts` | `GET /api/status` |
| `files.ts` | `GET /api/files`, `GET /api/files/download` |
| `logs.ts` | `GET /api/logs` |
| `stats.ts` | `GET /api/stats/summary`, `/levels`, `/timeline`, `/timeline-stacked`, `/urls`, `/http-status` |
| `ingest.ts` | `POST /api/ingest` |
| `utils.ts` | Shared filter fragment helpers |

All routes use `sql` from `src/db/index.ts` directly. Dynamic WHERE clauses use `WHERE 1=1 ${fileFilter(q.file)} ...` pattern with helpers returning `sql\`AND ...\`` fragments.

### `src/views/`

EJS templates. `index.ejs` is the shell; it `include`s partials:

```
index.ejs
  ├── partials/head.ejs        CSS link, Chart.js CDN
  ├── partials/topbar.ejs      Logo, file select, ingest/download buttons
  ├── partials/tabs.ejs        Tab navigation
  ├── partials/dashboard.ejs   Dashboard panel (timeline + level chart)
  ├── partials/charts-panel.ejs HTTP status + URL table
  ├── partials/logs-panel.ejs  Searchable log table
  ├── partials/modal.ejs       Log entry detail modal
  └── partials/statusbar.ejs   Bottom status bar
```

The server injects no JS globals — EJS server-renders the file list and selected file into the `<select>` dropdown, so `app.js` simply reads `document.getElementById('fileSelect').value` on init.

### `src/public/`

Static assets served at `/public/`:
- `css/styles.css` — all dashboard styles
- `js/app.js` — all client-side logic (vanilla JS, no framework)

## Data Flow — Page Load

1. Browser requests `GET /?file=CMS-API-error-1.log`
2. Server queries PostgreSQL for distinct log files
3. Server renders `index.ejs` with `{ files, selectedFile, dbReady }`
4. EJS topbar renders `<option selected>` for the selected file
5. Browser receives fully rendered HTML; `app.js` loads
6. `init()` reads `#fileSelect.value` → `state.file = 'CMS-API-error-1.log'`
7. `loadDashboard()` and `searchLogs(1)` fire with that file pre-filtered

## Data Flow — Ingest Button

1. User clicks "Ingest" in the topbar
2. `triggerIngest()` in `app.js` sends `POST /api/ingest`
3. Server calls `runIngest({ force, logsDir })`
4. Response `{ success: true, totalInserted: N }` returned to browser
5. `app.js` shows a toast and reloads the dashboard

## Technology Choices

| Concern | Choice | Reason |
|---|---|---|
| HTTP server | Fastify v5 | Faster than Express, TypeScript-first, schema validation |
| Templates | EJS | Minimal, no build step, server-side file list injection |
| Database | PostgreSQL 14+ | Scales past SQLite limits; monthly partitions for 15 GB+ datasets |
| Postgres client | `postgres` (porsager v3) | TypeScript-native, tagged template literals, built-in pool |
| FTS | `tsvector` generated column + GIN index | Always current, no rebuild step, `plainto_tsquery` for search |
| Partitioning | `PARTITION BY RANGE (timestamp_unix)` monthly | Drop old partitions instantly; queries scan only relevant months |
| Package manager | Yarn 4 (corepack) | Pinned via `packageManager` field; `nodeLinker: node-modules` |
| Client JS | Vanilla JS | No build step needed |
| Charts | Chart.js (CDN) | Mature, zero build config |
| Language | TypeScript | Type safety for query builders and route handlers |
| Lint | ESLint + typescript-eslint + prettier | Enforced via `eslint-plugin-prettier` as last config |
