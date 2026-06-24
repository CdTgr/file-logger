# Log Format

> See also: [Database Schema](./database-schema.md) · [Architecture](./architecture.md)

File Logger parses log files line by line. All lines must start with a timestamp prefix.

---

## Timestamp Prefix

Every log entry must begin with:

```
YYYY-MM-DD HH:MM +HH:MM: <message>
```

Example:
```
2024-12-18 13:12 +00:00: {"level":50,"msg":"Database error"}
2024-12-18 13:13 +00:00: TypeError: Cannot read property 'id' of undefined
```

The regex used:
```
/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}): (.*)$/s
```

Lines that do not match this pattern are treated as **continuation lines** and appended to the preceding entry's `message` field (with a newline separator). This captures multi-line stack traces.

---

## Message Formats

### Pino JSON

If the message part starts with `{`, it is parsed as JSON (pino format):

```json
{
  "level": 50,
  "time": 1734527520000,
  "pid": 12345,
  "hostname": "app-server-1",
  "reqId": "req-abc123",
  "req": { "method": "GET", "url": "/api/users" },
  "res": { "statusCode": 500 },
  "responseTime": 1234.5,
  "msg": "request errored"
}
```

Extracted fields:
- `level_num` ← `level` (numeric)
- `level` ← derived from `level_num` via pino level map
- `message` ← `msg`
- `pid` ← `pid`
- `hostname` ← `hostname`
- `req_id` ← `reqId`
- `method` ← `req.method`
- `url` ← `req.url`
- `status_code` ← `res.statusCode`
- `response_time` ← `responseTime`

### Pino Level Map

| Numeric | Level |
|---|---|
| 10 | TRACE |
| 20 | DEBUG |
| 30 | INFO |
| 40 | WARN |
| 50 | ERROR |
| 60 | FATAL |

### Plain Text

If the message is not JSON, the level is inferred by keyword scanning (case-insensitive):

| Keyword(s) | Level |
|---|---|
| `FATAL` | FATAL |
| `ERROR`, `ERR `, `ERR:` | ERROR |
| `WARN` | WARN |
| `DEBUG` | DEBUG |
| `TRACE` | TRACE |
| (no match) | INFO |

---

## Multi-line Entries

Stack traces and additional context are appended to the parent entry:

```
2024-12-18 13:13 +00:00: TypeError: Cannot read property 'id' of undefined
    at handler (/app/routes/user.js:42:18)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
```

The `message` stored in the database would be:
```
TypeError: Cannot read property 'id' of undefined
    at handler (/app/routes/user.js:42:18)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
```

---

## Skipped Lines

- Blank/whitespace-only lines are silently skipped
- Lines before the first timestamp in a file are skipped
- Lines with a non-parseable timestamp (invalid date) are skipped
