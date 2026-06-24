# File Logger

A self-hosted log viewer and visualization dashboard for structured log files. Ingests logs into SQLite for fast querying, watches files for live updates, and serves a browser-based dashboard with search, filters, and charts.

## Features

- **Live ingestion** — watches `logs/` for new entries while running; new lines appear in the dashboard within seconds
- **Full-text search** — FTS5-powered keyword search across all log messages
- **Filters** — filter by date range, log level (TRACE / DEBUG / INFO / WARN / ERROR / FATAL), and keyword
- **Multi-file support** — switch between log files via a dropdown; all files are ingested automatically
- **Charts** — log volume over time (stacked by level), level distribution, HTTP status breakdown, top request paths
- **Stack trace bundling** — multi-line stack traces are attached to their parent log entry
- **SQLite-backed** — fast queries on millions of rows without a separate database server
- **Docker-ready** — single `docker compose up` command

## Quick Start

### Local

```bash
npm install
npm run ingest      # parse logs/ into SQLite (safe to re-run; skips unchanged files)
npm start           # dashboard at http://localhost:3000
```

### Docker

```bash
docker compose up -d
```

The container ingests all logs on startup, then watches for changes. The SQLite database is persisted in a named volume (`db-data`) so data survives restarts.

## Project Structure

```
├── ingest.js          # One-shot log parser — reads logs/, writes to SQLite
├── server.js          # Express API server + static file serving
├── watcher.js         # Live file watcher (fs.watch + polling fallback)
├── public/
│   └── index.html     # Single-page dashboard (Chart.js, no build step)
├── logs/              # Drop log files here (bind-mounted in Docker)
├── Dockerfile
├── docker-compose.yml
└── docker-entrypoint.sh
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

| Command                     | Description                                                               |
| --------------------------- | ------------------------------------------------------------------------- |
| `npm run ingest`            | Parse all files in `logs/` into SQLite. Skips files that haven't changed. |
| `npm run ingest -- --force` | Re-ingest all files from scratch.                                         |
| `npm run ingest -- --check` | Show ingestion status without writing anything.                           |
| `npm start`                 | Start the server and file watcher on port 3000.                           |
| `npm run watch`             | Run the file watcher standalone (separate terminal).                      |

## Configuration

All options are environment variables:

| Variable  | Default     | Description                                                                                                                                      |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`    | `3000`      | HTTP port                                                                                                                                        |
| `DB_PATH` | `./logs.db` | Path to the SQLite database file                                                                                                                 |
| `POLL_MS` | `5000`      | Polling interval for the watcher in ms. Set to `0` to disable (use `fs.watch` only). Useful in Docker where bind-mount events may not propagate. |

## Docker Details

`docker-compose.yml` mounts two volumes:

- `./logs` → `/app/logs` — bind mount so the container reads log files from the host
- `db-data` → `/app/data` — named volume for the SQLite database (persists across restarts)

To reset the database and re-ingest from scratch:

```bash
docker compose down -v   # removes the db-data volume
docker compose up -d
```

## Requirements

- Node.js 22.5+ (uses the built-in `node:sqlite` module — no native addons)
- Or Docker
