# Architecture

> See also: [API Reference](./api-reference.md) · [Database Schema](./database-schema.md) · [Log Format](./log-format.md)

## System Overview

File Logger is a self-hosted log viewer. It watches structured log files from a `logs/` directory, ingests them into PostgreSQL incrementally, and serves a Vue 3 + Quasar SPA for search and visualization.

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
    └── /               Static file handler → serves built Quasar SPA
         │
         ▼
   Browser (Vue 3 + Quasar + Pinia + ApexCharts)
   ├── Dashboard tab    Timeline chart + level donut + summary cards
   ├── Logs tab         Server-side paginated table + full-text search
   └── Charts tab       HTTP status donut + top URLs table
```

Optional: `[ingest.ts]` — CLI one-shot batch re-ingestion (`yarn ingest`), also callable via `POST /api/ingest`.

## Components

### `src/server.ts`

Fastify HTTP server. Responsibilities:
- Call `initDb()` at startup (idempotent PostgreSQL DDL)
- Register `@fastify/static` pointing at `src/public/` (the built Quasar SPA) at prefix `/`
- Mount API route plugins from `src/routes/`
- Serve `index.html` as the 404 fallback (SPA catch-all for hash router)
- Start the async file watcher via `await startWatcher({ logsDir })`

No EJS or server-side rendering — the entire UI is a client-side SPA.

### `src/ingest.ts`

One-shot log parser. Entry points:
- `runIngest(options)` — exported async function, used by both CLI and the `POST /api/ingest` route
- `main()` — CLI wrapper that calls `runIngest()` and closes the pool

Parsing pipeline per file:
1. Read file line by line via `readline`
2. Match lines against `TS_RE` timestamp regex
3. Build a row object (plain text or pino JSON)
4. Call `ensurePartitionsForTimestamps()` before each batch insert
5. Bulk-insert rows into PostgreSQL (`sql(batch, ...cols)`, 5,000 rows/sub-batch max — 65,000 params < PostgreSQL's 65,534 limit)
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

### `frontend/`

Standalone Quasar v2 SPA project (Vue 3, TypeScript, Pinia, Vue Router, ApexCharts). Has its own `package.json` and `yarn.lock`.

```
frontend/
├── src/
│   ├── api/
│   │   ├── index.ts        Typed fetch wrappers for all backend endpoints
│   │   └── types.ts        Shared TypeScript interfaces (LogRow, StatsRow, etc.)
│   ├── boot/
│   │   ├── pinia.ts        Creates and installs Pinia
│   │   └── apexcharts.ts   Registers <ApexChart> component globally
│   ├── components/
│   │   ├── DashboardTab.vue    Summary cards + TimelineChart + LevelChart
│   │   ├── LogsTab.vue         QTable server-side pagination + LogDetailModal
│   │   ├── ChartsTab.vue       HttpStatusChart + UrlTable
│   │   ├── TimelineChart.vue   ApexCharts bar/area with level colours
│   │   ├── LevelChart.vue      ApexCharts donut
│   │   ├── HttpStatusChart.vue ApexCharts donut (1xx–5xx)
│   │   └── LogDetailModal.vue  QDialog showing all fields + pretty-printed message
│   ├── pages/
│   │   └── IndexPage.vue   QLayout — file selector, ingest btn, download btn, QTabs
│   ├── router/
│   │   ├── index.ts        createWebHashHistory router
│   │   └── routes.ts       Single route: / → IndexPage, catch-all → /
│   ├── stores/
│   │   └── appStore.ts     Pinia store: selectedFile, files[], dbReady, totalEntries
│   └── css/
│       ├── app.scss            Level badge classes, mono font, table tweaks
│       └── quasar.variables.scss   Brand colours ($primary, $negative, etc.)
├── quasar.config.ts        Build target, dev proxy (/api → :3000), Quasar plugins
├── tsconfig.json           Extends @quasar/app-vite preset
└── package.json            quasar, vue, pinia, vue-router, vue3-apexcharts
```

### `src/public/`

Build output directory for the Quasar SPA. **Gitignored** — generated by `yarn build:ui` locally or by the Docker builder stage. Served by `@fastify/static` at `/`.

## Data Flow — App Load

1. Browser requests `GET /` → Fastify serves `src/public/index.html` (built SPA shell)
2. Vue boots, Pinia initialises, `IndexPage` mounts
3. `onMounted`: reads `?file=` from URL → sets `store.selectedFile`; calls `store.fetchStatus()` + `store.fetchFiles()`
4. `fetchFiles()` calls `GET /api/files` → populates the file selector dropdown
5. Active tab component mounts and calls its data-loading functions with current filters

## Data Flow — Ingest Button

1. User clicks "Ingest" in the topbar
2. `IndexPage` calls `api.ingest()` → `POST /api/ingest`
3. Server calls `runIngest({ force, logsDir })`
4. Response `{ success: true, totalInserted: N }` returned to browser
5. Quasar `Notify` shows success toast; `store.fetchStatus()` + `store.fetchFiles()` refresh

## Technology Choices

| Concern | Choice | Reason |
|---|---|---|
| HTTP server | Fastify v5 | Faster than Express, TypeScript-first, schema validation |
| Frontend framework | Vue 3 + Quasar v2 | Component library with QTable virtual scroll, dark theme, no custom CSS needed |
| State management | Pinia | Vue 3 idiomatic, TypeScript-first, minimal boilerplate |
| Router | Vue Router 4 (hash mode) | Hash mode requires no server catch-all config |
| Charts | ApexCharts + vue3-apexcharts | Dark theme, time-series, donut/bar/area — no CDN dependency |
| Database | PostgreSQL 14+ | Scales past SQLite limits; monthly partitions for 15 GB+ datasets |
| Postgres client | `postgres` (porsager v3) | TypeScript-native, tagged template literals, built-in pool |
| FTS | `tsvector` generated column + GIN index | Always current, no rebuild step, `plainto_tsquery` for search |
| Partitioning | `PARTITION BY RANGE (timestamp_unix)` monthly | Drop old partitions instantly; queries scan only relevant months |
| Package manager | Yarn 4 (corepack) | Pinned via `packageManager` field; `nodeLinker: node-modules` |
| Language | TypeScript | Type safety for query builders, route handlers, and API client |
| Lint | ESLint + typescript-eslint + prettier | Enforced via `eslint-plugin-prettier` as last config |
