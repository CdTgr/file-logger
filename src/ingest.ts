#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import readline from 'readline'

import { IngestOptions, LogRow } from './custom-types/index.js'
import { sql } from './db/index.js'
import { ensurePartitionsForTimestamps } from './db/partitions.js'
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
  logsDir: string,
  logFile: string,
  force: boolean,
): Promise<number> {
  const filePath = path.join(logsDir, logFile)
  const stat = fs.statSync(filePath)

  const [existing] = await sql<{ file_size: string; row_count: string }[]>`
    SELECT file_size, row_count FROM ingestion_log WHERE log_file = ${logFile}
  `

  if (existing && !force) {
    if (Number(existing.file_size) === stat.size) {
      console.log(
        `[skip] ${logFile} — already ingested (${Number(existing.row_count).toLocaleString()} rows)`,
      )

      return 0
    }
    console.log(`[update] ${logFile} — file size changed, re-ingesting...`)
    await sql`DELETE FROM logs WHERE log_file = ${logFile}`
    await sql`DELETE FROM ingestion_log WHERE log_file = ${logFile}`
  } else if (force) {
    console.log(`[force] ${logFile} — clearing previous data...`)
    await sql`DELETE FROM logs WHERE log_file = ${logFile}`
    await sql`DELETE FROM ingestion_log WHERE log_file = ${logFile}`
  }

  console.log(
    `[ingest] ${logFile} (${(stat.size / 1024 / 1024).toFixed(0)} MB)...`,
  )
  const startTime = Date.now()

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  })
  const TS_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}): (.*)$/s

  let batch: LogRow[] = []
  let total = 0
  let pending: LogRow | null = null

  const flushBatch = async (rows: LogRow[]): Promise<void> => {
    await ensurePartitionsForTimestamps(rows.map((r) => r.timestamp_unix))
    const insertData = rows.map((r) => ({
      log_file: r.log_file,
      timestamp: r.timestamp,
      timestamp_unix: r.timestamp_unix,
      level: r.level,
      level_num: r.level_num,
      message: r.message,
      method: r.method,
      url: r.url,
      status_code: r.status_code,
      response_time: r.response_time,
      pid: r.pid,
      hostname: r.hostname,
      req_id: r.req_id,
    }))
    await sql`
      INSERT INTO logs ${sql(insertData, 'log_file', 'timestamp', 'timestamp_unix', 'level', 'level_num', 'message', 'method', 'url', 'status_code', 'response_time', 'pid', 'hostname', 'req_id')}
    `
  }

  for await (const line of rl) {
    if (!line.trim()) continue
    const m = line.match(TS_RE)
    if (m) {
      if (pending) {
        batch.push(pending)
        if (batch.length >= BATCH_SIZE) {
          await flushBatch(batch)
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
    await flushBatch(batch)
    total += batch.length
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n  Done: ${total.toLocaleString()} rows in ${elapsed}s`)

  await sql`
    INSERT INTO ingestion_log (log_file, ingested_at, row_count, file_size)
    VALUES (${logFile}, NOW(), ${total}, ${stat.size})
    ON CONFLICT (log_file) DO UPDATE SET
      row_count = ${total},
      file_size = ${stat.size},
      ingested_at = NOW()
  `

  return total
}

export async function runIngest(options: IngestOptions = {}): Promise<number> {
  const { force = false, checkOnly = false, logsDir } = options
  const resolvedLogsDir =
    logsDir || process.env.LOGS_DIR || path.join(process.cwd(), 'logs')

  await initDb()

  if (checkOnly) {
    const rows = await sql<
      { log_file: string; row_count: string; ingested_at: string }[]
    >`
      SELECT log_file, row_count, ingested_at FROM ingestion_log ORDER BY log_file
    `
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

    return 0
  }

  const files = findLogFiles(resolvedLogsDir)
  if (!files.length) {
    console.log('No log files found in ' + resolvedLogsDir)

    return 0
  }

  let totalInserted = 0
  for (const file of files) {
    totalInserted += await ingestFile(resolvedLogsDir, file, force)
  }

  const [countRow] = await sql<{ n: string }[]>`SELECT COUNT(*) as n FROM logs`
  console.log(`\nTotal rows in DB: ${Number(countRow.n).toLocaleString()}`)
  console.log('Run `npm start` to launch the dashboard.')

  return totalInserted
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force')
  const checkOnly = process.argv.includes('--check')
  await runIngest({ force, checkOnly })
  await sql.end()
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
