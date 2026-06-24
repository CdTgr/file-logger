# Architecture

> See also: [API Reference](./api-reference.md) · [Database Schema](./database-schema.md) · [Log Format](./log-format.md)

## System Overview

File Logger is a self-hosted log viewer. It ingests structured log files from a `logs/` directory into SQLite, then serves a browser dashboard for search and visualization.

```
logs/ (bind-mounted)
  └── *.log files
         │
         ▼
   [ingest.ts]          One-shot batch ingestion
   [watcher.ts]         Live tail (fs.watch + polling)
         │
         ▼
    logs.db (SQLite)
         │
         ▼
   [server.ts]          Fastify HTTP server
    ├── /api/*          JSON API routes
    └── /               EJS-rendered dashboard
         │
         ▼
   Browser (vanilla JS + Chart.js)
```

## Components

### `src/server.ts`

Fastify HTTP server. Responsibilities:
- Register `@fastify/view` (EJS engine, root = `src/views/`)
- Register `@fastify/static` (public assets at `/public/`)
- Mount API routes from `src/routes/api.ts`
- Serve the dashboard at `GET /` (EJS render with server-side file list and pre-selected file)
- Start the file watcher on startup if the database exists

### `src/ingest.ts`

One-shot log parser. Entry points:
- `runIngest(options)` — exported async function, used by both CLI and the `POST /api/ingest` route
- `main()` — CLI wrapper that calls `runIngest()` and exits

Parsing pipeline per file:
1. Read file line by line via `readline`
2. Match lines against `TS_RE` timestamp regex
3. Build a row object (plain text or pino JSON)
4. Batch-insert rows into SQLite (10,000 rows/batch)
5. Record `ingestion_log` entry
6. After all files: rebuild FTS index

### `src/watcher.ts`

Live file watcher. `startWatcher(config)` returns a `LogWatcher` instance that:
- Uses `fs.watch` (recursive on macOS/Windows, per-dir on Linux)
- Falls back to polling every `POLL_MS` ms (default 5 s) for Docker bind-mounts
- Debounces file-change events (300 ms) then reads only new bytes
- Inserts new rows and incrementally updates the FTS index
- Updates `ingestion_log.file_size` so the next server restart knows the offset

### `src/db/index.ts`

Singleton read-only `DatabaseSync` connection used by the API server:
- `getDb()` — returns the singleton or `null` if the DB file doesn't exist
- `resetDb()` — closes and clears the singleton (called after `POST /api/ingest` so fresh data is served)

### `src/routes/api.ts`

All `/api/*` routes registered as a Fastify plugin. See [API Reference](./api-reference.md).

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

The client-side script `src/public/js/app.js` is served as a static asset. The server injects no JS globals — instead the EJS server-renders the file list and selected file into the `<select>` dropdown directly, so the JS simply reads `document.getElementById('fileSelect').value` on init.

### `src/public/`

Static assets served at `/public/`:
- `css/styles.css` — all dashboard styles
- `js/app.js` — all client-side logic (vanilla JS, no framework)

## Data Flow — Page Load

1. Browser requests `GET /?file=CMS-API-error-1.log`
2. Server reads `file` query param, queries SQLite for the file list
3. Server renders `index.ejs` with `{ files, selectedFile, dbReady }`
4. EJS topbar renders `<option selected>` for the selected file
5. Browser receives fully rendered HTML; `app.js` loads
6. `init()` reads `#fileSelect.value` → `state.file = 'CMS-API-error-1.log'`
7. `loadDashboard()` and `searchLogs(1)` fire with that file pre-filtered

## Data Flow — Ingest Button

1. User clicks "Ingest" in the topbar
2. `triggerIngest()` in `app.js` sends `POST /api/ingest`
3. Server calls `runIngest({ force, logsDir, dbPath })`
4. After ingestion, server calls `resetDb()` to invalidate the read-only DB singleton
5. Response `{ success: true, totalInserted: N }` returned to browser
6. `app.js` shows a toast and reloads the dashboard

## Technology Choices

| Concern | Choice | Reason |
|---|---|---|
| HTTP server | Fastify v4 | Faster than Express, TypeScript-first, schema validation |
| Templates | EJS | Minimal, no build step, server-side file list injection |
| Database | SQLite (`node:sqlite`) | No separate server; built into Node.js 22.5+ |
| Client JS | Vanilla JS | No build step needed; existing code was already solid |
| Charts | Chart.js (CDN) | Mature, zero build config |
| Language | TypeScript | Type safety for complex query builders and route handlers |
| Lint | ESLint + typescript-eslint | Standard TypeScript linting |
| Format | Prettier | Already configured in repo |
