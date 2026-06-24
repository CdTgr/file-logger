# Database Schema

> See also: [Log Format](./log-format.md) · [API Reference](./api-reference.md)

PostgreSQL database. Connection via `DATABASE_URL` env var or individual `POSTGRES_*` vars. Schema created by `initDb()` in `src/db/schema.ts` (idempotent — safe to call on every startup).

---

## Table: `ingestion_log`

Tracks which files have been ingested and their last known byte offset. The watcher reads this on startup to resume from the correct position, preventing duplicate rows across restarts.

| Column | Type | Description |
|---|---|---|
| `log_file` | TEXT PRIMARY KEY | Relative file path within `logs/` (e.g. `CMS-API-error-1.log`) |
| `ingested_at` | TIMESTAMPTZ NOT NULL | Timestamp of last write |
| `row_count` | BIGINT NOT NULL | Cumulative rows inserted for this file |
| `file_size` | BIGINT NOT NULL | Byte offset up to which rows have been inserted; used as the watcher's resume point |

Upserted via `ON CONFLICT (log_file) DO UPDATE SET ...` after every batch insert.

---

## Table: `logs` (partitioned)

Primary log entry table. Partitioned by `RANGE (timestamp_unix)` into monthly child tables (`logs_YYYY_MM`). Partitions are created on demand by `ensurePartitionsForTimestamps()` in `src/db/partitions.ts` before each batch insert.

```sql
CREATE TABLE logs (
  id             BIGSERIAL,
  log_file       TEXT          NOT NULL,
  timestamp      TIMESTAMPTZ   NOT NULL,
  timestamp_unix BIGINT        NOT NULL,
  level          TEXT          NOT NULL DEFAULT 'INFO',
  level_num      INTEGER,
  message        TEXT          NOT NULL,
  message_tsv    TSVECTOR      GENERATED ALWAYS AS
                   (to_tsvector('english', coalesce(message, ''))) STORED,
  method         TEXT,
  url            TEXT,
  status_code    INTEGER,
  response_time  REAL,
  pid            INTEGER,
  hostname       TEXT,
  req_id         TEXT,
  PRIMARY KEY (id, timestamp_unix)
) PARTITION BY RANGE (timestamp_unix);
```

### Column Reference

| Column | Type | Description |
|---|---|---|
| `id` | BIGSERIAL | Auto-increment; globally unique across partitions |
| `log_file` | TEXT NOT NULL | Relative path within `logs/` |
| `timestamp` | TIMESTAMPTZ NOT NULL | Parsed ISO 8601 timestamp |
| `timestamp_unix` | BIGINT NOT NULL | Unix timestamp in milliseconds; partition key |
| `level` | TEXT NOT NULL | Normalised level: TRACE/DEBUG/INFO/WARN/ERROR/FATAL |
| `level_num` | INTEGER | Pino numeric level (10/20/30/40/50/60); NULL for non-pino logs |
| `message` | TEXT NOT NULL | Log message (may contain embedded newlines for stack traces) |
| `message_tsv` | TSVECTOR GENERATED | Always-current full-text search vector; never included in INSERT |
| `method` | TEXT | HTTP method; NULL if not a request log |
| `url` | TEXT | Request URL; NULL if not a request log |
| `status_code` | INTEGER | HTTP status code; NULL if not a request log |
| `response_time` | REAL | Response time in ms (pino `responseTime`); NULL if absent |
| `pid` | INTEGER | Process ID (pino `pid`); NULL if absent |
| `hostname` | TEXT | Hostname (pino `hostname`); NULL if absent |
| `req_id` | TEXT | Request ID (pino `reqId`); NULL if absent |

### Composite Primary Key

The partition key (`timestamp_unix`) must be part of the primary key in PostgreSQL. The composite `PRIMARY KEY (id, timestamp_unix)` ensures global uniqueness while satisfying this constraint.

### Indexes

Created on the parent table — PostgreSQL 11+ automatically applies them to every new partition.

| Name | Definition | Purpose |
|---|---|---|
| `idx_ts` | `(timestamp_unix)` | Time-range queries |
| `idx_level` | `(level)` | Level filtering |
| `idx_file` | `(log_file)` | File filtering |
| `idx_file_ts` | `(log_file, timestamp_unix)` | Per-file time range (most common query) |
| `idx_file_lvl` | `(log_file, level)` | Per-file level stats |
| `idx_message_tsv` | `USING GIN (message_tsv)` | Full-text search |

---

## Monthly Partitions

Managed by `src/db/partitions.ts`:

```typescript
// Example partitions
logs_2024_11  FOR VALUES FROM (1730419200000) TO (1733011200000)
logs_2024_12  FOR VALUES FROM (1733011200000) TO (1735689600000)
logs_2025_01  FOR VALUES FROM (1735689600000) TO (1738368000000)
```

- Named `logs_YYYY_MM`
- Boundaries are epoch milliseconds for the first day of the month (UTC)
- Created with `CREATE TABLE IF NOT EXISTS ... PARTITION OF logs FOR VALUES FROM (...) TO (...)`
- A module-level `Set<string>` caches which partitions have been verified in the current process to avoid redundant DDL calls
- To drop old data: `DROP TABLE logs_2023_01` — instant, no bloat, no vacuum needed

---

## Full-Text Search

Search is implemented via the `message_tsv` generated column:

```sql
-- Query (used in GET /api/logs)
WHERE message_tsv @@ plainto_tsquery('english', $1)
```

`plainto_tsquery` converts the search string to an AND query of lexemes, handling stemming and stop words. The GIN index makes this fast even across partitions.

No separate FTS table or rebuild step. The generated column is maintained automatically on every INSERT.
