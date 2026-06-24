#!/usr/bin/env node
'use strict'

const fs = require('fs')
const readline = require('readline')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const LOGS_DIR = path.join(__dirname, 'logs')
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'logs.db')

function findLogFiles(dir, base = '') {
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      results.push(...findLogFiles(path.join(dir, entry.name), rel))
    } else if (entry.name.endsWith('.log') || entry.name.endsWith('.txt')) {
      results.push(rel)
    }
  }
  return results
}
const BATCH_SIZE = 10_000

const PINO_LEVELS = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
}

function detectLevel(message, pinoLevel) {
  if (pinoLevel && PINO_LEVELS[pinoLevel]) return PINO_LEVELS[pinoLevel]
  const u = message.toUpperCase()
  if (u.includes('FATAL')) return 'FATAL'
  if (u.includes('ERROR') || u.includes('ERR ') || u.includes('ERR:'))
    return 'ERROR'
  if (u.includes('WARN')) return 'WARN'
  if (u.includes('DEBUG')) return 'DEBUG'
  if (u.includes('TRACE')) return 'TRACE'
  return 'INFO'
}

// Parse "2024-12-18 13:12 +00:00" -> { iso, unix }
function parseTimestamp(ts) {
  // "2024-12-18 13:12 +00:00" -> "2024-12-18T13:12+00:00"
  const iso = ts.replace(' ', 'T').replace(/ ([+-])/, '$1')
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : { iso: d.toISOString(), unix: d.getTime() }
}

function initDb(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -64000;

    CREATE TABLE IF NOT EXISTS ingestion_log (
      log_file    TEXT PRIMARY KEY,
      ingested_at TEXT NOT NULL,
      row_count   INTEGER NOT NULL,
      file_size   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      log_file       TEXT    NOT NULL,
      timestamp      TEXT    NOT NULL,
      timestamp_unix INTEGER NOT NULL,
      level          TEXT    NOT NULL DEFAULT 'INFO',
      level_num      INTEGER,
      message        TEXT    NOT NULL,
      method         TEXT,
      url            TEXT,
      status_code    INTEGER,
      response_time  REAL,
      pid            INTEGER,
      hostname       TEXT,
      req_id         TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ts       ON logs(timestamp_unix);
    CREATE INDEX IF NOT EXISTS idx_level    ON logs(level);
    CREATE INDEX IF NOT EXISTS idx_file     ON logs(log_file);
    CREATE INDEX IF NOT EXISTS idx_file_ts  ON logs(log_file, timestamp_unix);
    CREATE INDEX IF NOT EXISTS idx_file_lvl ON logs(log_file, level);

    CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts
      USING fts5(message, content='logs', content_rowid='id');
  `)
}

async function ingestFile(db, logFile, force) {
  const filePath = path.join(LOGS_DIR, logFile)
  const stat = fs.statSync(filePath)

  const existing = db
    .prepare('SELECT * FROM ingestion_log WHERE log_file = ?')
    .get(logFile)

  if (existing && !force) {
    if (existing.file_size === stat.size) {
      console.log(
        `[skip] ${logFile} — already ingested (${Number(existing.row_count).toLocaleString()} rows)`,
      )
      return 0
    }
    console.log(`[update] ${logFile} — file size changed, re-ingesting...`)
    db.exec(
      `DELETE FROM logs WHERE log_file = '${logFile.replace(/'/g, "''")}'`,
    )
    db.prepare('DELETE FROM ingestion_log WHERE log_file = ?').run(logFile)
  } else if (force) {
    console.log(`[force] ${logFile} — clearing previous data...`)
    db.exec(
      `DELETE FROM logs WHERE log_file = '${logFile.replace(/'/g, "''")}'`,
    )
    db.prepare('DELETE FROM ingestion_log WHERE log_file = ?').run(logFile)
  }

  console.log(
    `[ingest] ${logFile} (${(stat.size / 1024 / 1024).toFixed(0)} MB)...`,
  )
  const startTime = Date.now()

  const insert = db.prepare(`
    INSERT INTO logs
      (log_file, timestamp, timestamp_unix, level, level_num, message,
       method, url, status_code, response_time, pid, hostname, req_id)
    VALUES
      (:log_file, :timestamp, :timestamp_unix, :level, :level_num, :message,
       :method, :url, :status_code, :response_time, :pid, :hostname, :req_id)
  `)

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  })

  let batch = []
  let total = 0
  let pending = null // current row being built (may accumulate continuation lines)

  const TS_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}): (.*)$/s

  const flushBatch = (rows) => {
    db.exec('BEGIN')
    try {
      for (const r of rows) insert.run(r)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }

  const buildRow = (parsed, msgRaw) => {
    const row = {
      log_file: logFile,
      timestamp: parsed.iso,
      timestamp_unix: parsed.unix,
      level: 'INFO',
      level_num: null,
      message: msgRaw,
      method: null,
      url: null,
      status_code: null,
      response_time: null,
      pid: null,
      hostname: null,
      req_id: null,
    }

    if (msgRaw.startsWith('{')) {
      try {
        const j = JSON.parse(msgRaw)
        row.level_num = j.level ?? null
        row.level = detectLevel(j.msg ?? '', j.level)
        row.message = j.msg ?? msgRaw
        row.pid = j.pid ?? null
        row.hostname = j.hostname ?? null
        row.req_id = j.reqId ?? null
        if (j.req) {
          row.method = j.req.method ?? null
          row.url = j.req.url ?? null
        }
        if (j.res) {
          row.status_code = j.res.statusCode ?? null
        }
        row.response_time = j.responseTime ?? null
      } catch {
        row.level = detectLevel(msgRaw, null)
      }
    } else {
      row.level = detectLevel(msgRaw, null)
    }

    return row
  }

  for await (const line of rl) {
    if (!line.trim()) continue

    const m = line.match(TS_RE)

    if (m) {
      // New timestamped entry — commit the pending row first
      if (pending) {
        batch.push(pending)
        if (batch.length >= BATCH_SIZE) {
          flushBatch(batch)
          total += batch.length
          batch = []
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
          process.stdout.write(
            `\r  ${total.toLocaleString()} rows | ${elapsed}s elapsed`,
          )
        }
      }

      const parsed = parseTimestamp(m[1])
      pending = parsed ? buildRow(parsed, m[2].trim()) : null
    } else if (pending) {
      // Continuation line (stack trace, extra context) — append to current entry
      pending.message += '\n' + line.trimEnd()
    }
    // lines before the first timestamp with no pending row are silently dropped
  }

  // Flush the last pending row
  if (pending) batch.push(pending)
  if (batch.length) {
    flushBatch(batch)
    total += batch.length
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n  Done: ${total.toLocaleString()} rows in ${elapsed}s`)

  db.prepare('INSERT OR REPLACE INTO ingestion_log VALUES (?, ?, ?, ?)').run(
    logFile,
    new Date().toISOString(),
    total,
    stat.size,
  )

  return total
}

async function main() {
  const force = process.argv.includes('--force')
  const checkOnly = process.argv.includes('--check')

  const db = new DatabaseSync(DB_PATH)
  initDb(db)

  if (checkOnly) {
    const rows = db
      .prepare('SELECT * FROM ingestion_log ORDER BY log_file')
      .all()
    if (!rows.length) {
      console.log('No files ingested yet.')
    } else {
      console.log('Ingested files:')
      for (const r of rows)
        console.log(
          `  ${r.log_file}: ${Number(r.row_count).toLocaleString()} rows, ingested ${r.ingested_at}`,
        )
    }
    db.close()
    return
  }

  const files = findLogFiles(LOGS_DIR)
  if (!files.length) {
    console.log('No log files found in ./logs/')
    db.close()
    return
  }

  let totalInserted = 0
  for (const file of files) {
    totalInserted += await ingestFile(db, file, force)
  }

  if (totalInserted > 0) {
    console.log('\nBuilding full-text search index...')
    const t = Date.now()
    db.exec(`INSERT INTO logs_fts(logs_fts) VALUES('rebuild')`)
    console.log(`FTS index built in ${((Date.now() - t) / 1000).toFixed(1)}s`)
  }

  const count = db.prepare('SELECT COUNT(*) as n FROM logs').get().n
  console.log(`\nTotal rows in DB: ${Number(count).toLocaleString()}`)
  console.log('Run `npm start` to launch the dashboard.')
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
