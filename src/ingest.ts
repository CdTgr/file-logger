#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite'

import fs from 'fs'
import path from 'path'
import readline from 'readline'

import { IngestOptions, LogRow } from './custom-types/index.js'
import { initDb } from './db/schema.js'

const BATCH_SIZE = 10_000

const PINO_LEVELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
}

function findLogFiles(dir: string, base = ''): string[] {
  const results: string[] = []
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

function detectLevel(message: string, pinoLevel: number | null): string {
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

function parseTimestamp(ts: string): { iso: string; unix: number } | null {
  const iso = ts.replace(' ', 'T').replace(/ ([+-])/, '$1')
  const d = new Date(iso)

  return isNaN(d.getTime()) ? null : { iso: d.toISOString(), unix: d.getTime() }
}

function buildRow(
  logFile: string,
  parsed: { iso: string; unix: number },
  msgRaw: string,
): LogRow {
  const row: LogRow = {
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
      if (j.res) row.status_code = j.res.statusCode ?? null
      row.response_time = j.responseTime ?? null
    } catch {
      row.level = detectLevel(msgRaw, null)
    }
  } else {
    row.level = detectLevel(msgRaw, null)
  }

  return row
}

async function ingestFile(
  db: DatabaseSync,
  logsDir: string,
  logFile: string,
  force: boolean,
): Promise<number> {
  const filePath = path.join(logsDir, logFile)
  const stat = fs.statSync(filePath)

  const existing = db
    .prepare('SELECT * FROM ingestion_log WHERE log_file = ?')
    .get(logFile) as { file_size: number; row_count: number } | undefined

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

  let batch: LogRow[] = []
  let total = 0
  let pending: LogRow | null = null
  const TS_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}): (.*)$/s

  const flushBatch = (rows: LogRow[]): void => {
    db.exec('BEGIN')
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of rows) insert.run(r as any)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }

  for await (const line of rl) {
    if (!line.trim()) continue
    const m = line.match(TS_RE)
    if (m) {
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
      pending = parsed ? buildRow(logFile, parsed, m[2].trim()) : null
    } else if (pending) {
      pending.message += '\n' + line.trimEnd()
    }
  }

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

export async function runIngest(options: IngestOptions = {}): Promise<number> {
  const { force = false, checkOnly = false, logsDir, dbPath } = options
  const resolvedLogsDir =
    logsDir || process.env.LOGS_DIR || path.join(process.cwd(), 'logs')
  const resolvedDbPath =
    dbPath || process.env.DB_PATH || path.join(process.cwd(), 'logs.db')

  const db = new DatabaseSync(resolvedDbPath)
  initDb(db)

  if (checkOnly) {
    const rows = db
      .prepare('SELECT * FROM ingestion_log ORDER BY log_file')
      .all() as {
      log_file: string
      row_count: number
      ingested_at: string
    }[]
    if (!rows.length) {
      console.log('No files ingested yet.')
    } else {
      console.log('Ingested files:')
      for (const r of rows) {
        console.log(
          `  ${r.log_file}: ${Number(r.row_count).toLocaleString()} rows, ingested ${r.ingested_at}`,
        )
      }
    }
    db.close()

    return 0
  }

  const files = findLogFiles(resolvedLogsDir)
  if (!files.length) {
    console.log('No log files found in ' + resolvedLogsDir)
    db.close()

    return 0
  }

  let totalInserted = 0
  for (const file of files) {
    totalInserted += await ingestFile(db, resolvedLogsDir, file, force)
  }

  if (totalInserted > 0) {
    console.log('\nBuilding full-text search index...')
    const t = Date.now()
    db.exec(`INSERT INTO logs_fts(logs_fts) VALUES('rebuild')`)
    console.log(`FTS index built in ${((Date.now() - t) / 1000).toFixed(1)}s`)
  }

  const countRow = db.prepare('SELECT COUNT(*) as n FROM logs').get() as {
    n: number
  }
  console.log(`\nTotal rows in DB: ${Number(countRow.n).toLocaleString()}`)
  console.log('Run `npm start` to launch the dashboard.')
  db.close()

  return totalInserted
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force')
  const checkOnly = process.argv.includes('--check')
  await runIngest({ force, checkOnly })
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
