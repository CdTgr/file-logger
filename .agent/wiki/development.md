# Development Guide

> See also: [Architecture](./architecture.md) · [API Reference](./api-reference.md)

---

## Requirements

- Node.js 22.5+ (required for `node:sqlite`)
- npm 10+

---

## Setup

```bash
npm install
npm run ingest       # parse logs/ into SQLite
npm run dev          # start dev server with hot-reload at http://localhost:3000
```

---

## Project Structure

```
.
├── .agent/                   Agent documentation
│   ├── tasks.md              Step-by-step task list
│   ├── README.md             Project summary (LLM wiki format)
│   └── wiki/                 Detailed wiki docs
├── src/
│   ├── server.ts             Fastify server entry point
│   ├── ingest.ts             One-shot log ingestion script
│   ├── watcher.ts            Live file watcher
│   ├── db/
│   │   ├── index.ts          Read-only DB connection singleton
│   │   └── schema.ts         Schema SQL + initDb()
│   ├── routes/
│   │   └── api.ts            All /api/* routes (Fastify plugin)
│   ├── types/
│   │   └── sqlite.d.ts       node:sqlite type declarations
│   ├── views/
│   │   ├── index.ejs         Main layout
│   │   └── partials/         EJS partials (head, topbar, tabs, panels, modal, etc.)
│   └── public/
│       ├── css/styles.css    Dashboard stylesheet
│       └── js/app.js         Client-side JavaScript
├── logs/                     Log files (bind-mounted in Docker)
├── dist/                     TypeScript compiled output (gitignored)
├── logs.db                   SQLite database (gitignored)
├── tsconfig.json
├── eslint.config.js
├── package.json
├── Dockerfile
└── docker-compose.yml
```

---

## npm Scripts

| Script | Command | Description |
|---|---|---|
| `npm run dev` | `tsx watch src/server.ts` | Dev server with hot-reload |
| `npm run build` | `tsc` | Compile TypeScript to `dist/` |
| `npm start` | `node dist/server.js` | Run compiled production server |
| `npm run lint` | `eslint src/` | Lint TypeScript source |
| `npm run format` | `prettier --write src/` | Format source files |
| `npm run ingest` | `tsx src/ingest.ts` | Ingest all log files |
| `npm run ingest:force` | `tsx src/ingest.ts -- --force` | Force re-ingest all files |
| `npm run ingest:check` | `tsx src/ingest.ts -- --check` | Show ingestion status |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `DB_PATH` | `./logs.db` | Path to the SQLite database |
| `LOGS_DIR` | `./logs` | Directory containing log files |
| `POLL_MS` | `5000` | Watcher polling interval in ms (0 = disable) |

---

## TypeScript Notes

- `tsconfig.json` targets ES2022, outputs CommonJS to `dist/`
- `node:sqlite` types are declared in `src/types/sqlite.d.ts` (not yet in `@types/node` stable)
- Strict mode enabled; avoid `any` except where necessary for DB row types
- Run `npm run build` before `npm start` in production

---

## Adding a New API Route

1. Open `src/routes/api.ts`
2. Add a new `fastify.get('/api/...')` or `fastify.post(...)` handler inside `registerApiRoutes`
3. Define query/body types with an interface and use generics: `fastify.get<{ Querystring: MyQuery }>(...)`
4. Use `getDb()` from `src/db/index.ts` for database access
5. Call `reply.code(503).send(...)` if `getDb()` returns null

---

## Adding a New EJS Partial

1. Create `src/views/partials/my-partial.ejs`
2. Include it in `src/views/index.ejs`: `<%- include('./partials/my-partial') %>`
3. Pass variables from the parent template: `<%- include('./partials/my-partial', { myVar }) %>`

---

## Docker

```bash
docker compose up -d    # build + start (ingests on first run)
docker compose down -v  # remove containers AND db-data volume (full reset)
```

The container:
1. Runs `npm run build` during image build
2. On startup: runs `node dist/ingest.js`, then `node dist/server.js`
3. Mounts `./logs` → `/app/logs` (bind mount for log files)
4. Persists `logs.db` in the `db-data` named volume
