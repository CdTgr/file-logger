# API Reference

> See also: [Architecture](./architecture.md) · [Database Schema](./database-schema.md)

All API routes are mounted under `/api/`. Responses are JSON unless noted.

---

## `GET /api/status`

Returns database readiness and total entry count.

**Response**
```json
{
  "ready": true,
  "total": 142831,
  "files": [
    { "log_file": "CMS-API-error-1.log", "ingested_at": "2024-12-18T13:00:00Z", "row_count": 50000, "file_size": 4096000 }
  ]
}
```
Returns `{ "ready": false }` if the database file does not exist.

---

## `GET /api/files`

Returns the list of distinct log files ingested into the database.

**Response**
```json
["CMS-API-error-1.log", "CMS-APP-error-15.log"]
```

---

## `GET /api/logs`

Paginated log entry search with optional full-text search.

**Query Parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `file` | string | — | Filter by log file name |
| `level` | string | ALL | Filter by level (TRACE/DEBUG/INFO/WARN/ERROR/FATAL) |
| `from` | date | — | Start date (YYYY-MM-DD) |
| `to` | date | — | End date (YYYY-MM-DD, inclusive) |
| `q` | string | — | Full-text search query (FTS5 syntax) |
| `page` | number | 1 | Page number |
| `limit` | number | 200 | Page size (10–500) |

**Response**
```json
{
  "rows": [
    {
      "id": 1,
      "log_file": "CMS-API-error-1.log",
      "timestamp": "2024-12-18T13:12:00.000Z",
      "timestamp_unix": 1734527520000,
      "level": "ERROR",
      "level_num": 50,
      "message": "Database connection failed",
      "method": "GET",
      "url": "/api/users",
      "status_code": 500,
      "response_time": 1234.5,
      "pid": 12345,
      "hostname": "app-server-1",
      "req_id": "req-abc123"
    }
  ],
  "total": 8423,
  "page": 1,
  "limit": 200
}
```

---

## `GET /api/stats/summary`

Aggregate summary for the selected file/date range.

**Query Parameters**: `file`, `from`, `to`

**Response**
```json
{ "total": 142831, "earliest": "2024-12-01T00:00:00Z", "latest": "2024-12-18T13:59:59Z" }
```

---

## `GET /api/stats/levels`

Log count per level, sorted by count descending.

**Query Parameters**: `file`, `from`, `to`

**Response**
```json
[{ "level": "INFO", "count": 120000 }, { "level": "ERROR", "count": 3000 }]
```

---

## `GET /api/stats/timeline`

Log count bucketed by time interval (total, not by level).

**Query Parameters**: `file`, `from`, `to`, `level`, `interval` (minute/hour/day)

**Response**
```json
[{ "bucket": "2024-12-18 13:00", "count": 450 }]
```

---

## `GET /api/stats/timeline-stacked`

Log count bucketed by time interval, broken down by level.

**Query Parameters**: `file`, `from`, `to`, `interval` (minute/hour/day)

**Response**
```json
[{ "bucket": "2024-12-18 13:00", "level": "ERROR", "count": 12 }]
```

---

## `GET /api/stats/urls`

Top 25 request paths with request count, average response time, and error count.

**Query Parameters**: `file`, `from`, `to`

**Response**
```json
[{ "path": "/api/users", "count": 5000, "avg_ms": 45.2, "errors": 12 }]
```

---

## `GET /api/stats/http-status`

HTTP status code distribution grouped into 1xx/2xx/3xx/4xx/5xx.

**Query Parameters**: `file`, `from`, `to`

**Response**
```json
[{ "group_label": "2xx", "count": 98000 }, { "group_label": "5xx", "count": 1200 }]
```

---

## `POST /api/ingest`

Triggers log ingestion. Parses all files in `logs/` and writes to SQLite. The read-only DB singleton is reset after ingestion so fresh data is served immediately.

**Request Body**
```json
{ "force": false }
```
- `force: true` — re-ingest all files even if file size hasn't changed

**Response**
```json
{ "success": true, "totalInserted": 12345 }
```

**Error**
```json
{ "error": "some error message" }
```

---

## `GET /api/files/download`

Download a raw log file as an attachment.

**Query Parameters**

| Param | Type | Required | Description |
|---|---|---|---|
| `file` | string | Yes | Relative file path within `logs/` (e.g. `CMS-API-error-1.log`) |

**Response**: The raw file with `Content-Disposition: attachment; filename="..."`.

**Errors**:
- `400` — `file` param missing
- `403` — path traversal attempt
- `404` — file not found
