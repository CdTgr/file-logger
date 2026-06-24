# Database Schema

> See also: [Log Format](./log-format.md) · [API Reference](./api-reference.md)

SQLite database at `logs.db` (path configurable via `DB_PATH` env var).

---

## Table: `logs`

Primary log entry table. One row per log line.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `log_file` | TEXT NOT NULL | Relative path within `logs/` (e.g. `CMS-API-error-1.log`) |
| `timestamp` | TEXT NOT NULL | ISO 8601 timestamp |
| `timestamp_unix` | INTEGER NOT NULL | Unix timestamp in milliseconds |
| `level` | TEXT NOT NULL | Normalised level: TRACE/DEBUG/INFO/WARN/ERROR/FATAL |
| `level_num` | INTEGER | Pino numeric level (10/20/30/40/50/60), NULL for non-pino logs |
| `message` | TEXT NOT NULL | Log message (may contain newlines for stack traces) |
| `method` | TEXT | HTTP method (GET/POST/etc.), NULL if not present |
| `url` | TEXT | Request URL, NULL if not present |
| `status_code` | INTEGER | HTTP status code, NULL if not present |
| `response_time` | REAL | Response time in ms (from pino `responseTime` field), NULL if not present |
| `pid` | INTEGER | Process ID (from pino `pid` field), NULL if not present |
| `hostname` | TEXT | Hostname (from pino `hostname` field), NULL if not present |
| `req_id` | TEXT | Request ID (from pino `reqId` field), NULL if not present |

### Indexes

| Name | Columns | Purpose |
|---|---|---|
| `idx_ts` | `timestamp_unix` | Time-range queries |
| `idx_level` | `level` | Level filtering |
| `idx_file` | `log_file` | File filtering |
| `idx_file_ts` | `log_file, timestamp_unix` | Per-file time range (most common query) |
| `idx_file_lvl` | `log_file, level` | Per-file level stats |

---

## Table: `ingestion_log`

Tracks which files have been ingested and their byte offset.

| Column | Type | Description |
|---|---|---|
| `log_file` | TEXT PK | Relative file path (matches `logs.log_file`) |
| `ingested_at` | TEXT NOT NULL | ISO 8601 timestamp of last ingest |
| `row_count` | INTEGER NOT NULL | Number of rows ingested |
| `file_size` | INTEGER NOT NULL | File size in bytes at time of ingest (used as byte offset for live watcher) |

---

## Virtual Table: `logs_fts`

FTS5 content table for full-text search on log messages.

```sql
CREATE VIRTUAL TABLE logs_fts
  USING fts5(message, content='logs', content_rowid='id');
```

- `content='logs'` — content is stored in the `logs` table, not duplicated
- Rebuilt in bulk after batch ingest: `INSERT INTO logs_fts(logs_fts) VALUES('rebuild')`
- Updated incrementally by the watcher: `INSERT INTO logs_fts(rowid, message) VALUES (?, ?)`

---

## PRAGMA Settings

**Ingest connection** (read-write):
```sql
PRAGMA journal_mode = WAL;     -- concurrent reads during write
PRAGMA synchronous = NORMAL;   -- safe and fast
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -64000;    -- 64 MB cache
```

**Server connection** (read-only):
```sql
PRAGMA journal_mode = WAL;
PRAGMA cache_size = -32000;    -- 32 MB cache
PRAGMA query_only = TRUE;      -- prevents accidental writes
```

**Watcher connection** (read-write, separate from server):
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```
