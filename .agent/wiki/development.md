# Development Guide

> See also: [Architecture](./architecture.md) · [API Reference](./api-reference.md)

---

## Requirements

- Node.js 22.5+
- Yarn 4 (managed via corepack — run `corepack enable` once)
- PostgreSQL 14+ (local or via Docker)

---

## Setup

```bash
corepack enable          # activate Yarn v4 (once per machine)
yarn install

# Start a local postgres (or use your own):
docker run -d --name pg-logger \
  -e POSTGRES_USER=logger -e POSTGRES_PASSWORD=logger -e POSTGRES_DB=logger \
  -p 5432:5432 postgres:17-alpine

yarn dev                 # hot-reload dev server at http://localhost:3000
```

The schema is created automatically on first startup. The watcher will backfill any existing files in `logs/` in the background.

---

## Project Structure

```
.
├── .agent/                     Agent documentation
│   ├── tasks.md                Step-by-step task list
│   ├── README.md               Project summary (LLM wiki format)
│   └── wiki/                   Detailed wiki docs
├── src/
│   ├── server.ts               Fastify server entry point
│   ├── ingest.ts               One-shot log ingestion script (CLI + API)
│   ├── watcher.ts              Async live file watcher
│   ├── db/
│   │   ├── index.ts            postgres pool singleton (exports `sql`)
│   │   ├── schema.ts           PostgreSQL DDL + async initDb()
│   │   └── partitions.ts       Monthly partition management
│   ├── routes/
│   │   ├── index.ts            Registers all route plugins
│   │   ├── utils.ts            Shared sql fragment helpers
│   │   ├── status.ts           GET /api/status
│   │   ├── files.ts            GET /api/files, GET /api/files/download
│   │   ├── logs.ts             GET /api/logs
│   │   ├── stats.ts            GET /api/stats/*
│   │   └── ingest.ts           POST /api/ingest
│   ├── custom-types/
│   │   ├── index.ts            Barrel export
│   │   ├── api.ts              ApiConfig (logsDir)
│   │   ├── db.ts               LogRow interface
│   │   ├── ingest.ts           IngestOptions
│   │   └── watcher.ts          WatcherConfig, FileState
│   ├── views/
│   │   ├── index.ejs           Main layout
│   │   └── partials/           EJS partials (head, topbar, tabs, panels, modal, statusbar)
│   └── public/
│       ├── css/styles.css      Dashboard stylesheet
│       └── js/app.js           Client-side JavaScript
├── logs/                       Log files (bind-mounted in Docker)
├── dist/                       TypeScript compiled output (gitignored)
├── .yarnrc.yml                 nodeLinker: node-modules
├── tsconfig.json
├── eslint.config.mjs
├── package.json                packageManager: "yarn@4.17.0"
├── Dockerfile
└── docker-compose.yml
```

---

## Yarn Scripts

| Script | Command | Description |
|---|---|---|
| `yarn dev` | `tsx watch src/server.ts` | Dev server with hot-reload |
| `yarn build` | `tsc` | Compile TypeScript to `dist/` |
| `yarn start` | `node dist/server.js` | Run compiled production server |
| `yarn lint` | `eslint src/` | Lint TypeScript source |
| `yarn format` | `prettier --write src/` | Format source files |
| `yarn ingest` | `tsx src/ingest.ts` | Ingest all log files |
| `yarn ingest:force` | `tsx src/ingest.ts -- --force` | Force re-ingest all files |
| `yarn ingest:check` | `tsx src/ingest.ts -- --check` | Show ingestion status |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | derived | Full postgres connection string. Takes priority. |
| `POSTGRES_USER` | `logger` | Used if `DATABASE_URL` not set |
| `POSTGRES_PASSWORD` | `logger` | Used if `DATABASE_URL` not set |
| `POSTGRES_HOST` | `localhost` | Used if `DATABASE_URL` not set |
| `POSTGRES_PORT` | `5432` | Used if `DATABASE_URL` not set |
| `POSTGRES_DB` | `logger` | Used if `DATABASE_URL` not set |
| `LOGS_DIR` | `./logs` | Directory containing log files |
| `PORT` | `3000` | HTTP listen port |
| `POLL_MS` | `5000` | Watcher polling interval in ms (0 = disable) |

---

## TypeScript Notes

- `tsconfig.json` targets ES2022, outputs CommonJS to `dist/`, `moduleResolution: Node`
- Strict mode enabled; avoid `any` (one approved exception: `insert.run(r as any)` for postgres bulk insert row objects)
- Run `yarn build` before `yarn start` in production
- `tsx` is used for dev/scripts — no compilation needed

---

## Adding a New API Route

1. Create `src/routes/my-route.ts` exporting `async function myRoutes(fastify, opts)`
2. Import `sql` from `../db/index.js` for database access
3. Use `WHERE 1=1 ${fileFilter(q.file)} ...` pattern from `utils.ts` for dynamic filters
4. Register the plugin in `src/routes/index.ts`

---

## Adding a New EJS Partial

1. Create `src/views/partials/my-partial.ejs`
2. Include it in `src/views/index.ejs`: `<%- include('./partials/my-partial') %>`
3. Pass variables from the parent template: `<%- include('./partials/my-partial', { myVar }) %>`

---

## Docker

```bash
docker compose up -d         # build + start both postgres and file-logger
docker compose down -v       # remove containers AND pg-data volume (full reset)
```

The `file-logger` service uses `depends_on: condition: service_healthy` — it will not start until `pg_isready` reports healthy on the postgres container. The server starts immediately after that; no blocking ingest step.

Build stages:
1. **Builder**: `corepack enable` → `yarn install --immutable` → `yarn build` (tsc)
2. **Runtime**: copies `node_modules` + `dist/` from builder; `CMD ["node", "dist/server.js"]`
