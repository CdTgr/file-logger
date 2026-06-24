import { DatabaseSync } from 'node:sqlite'

import fs from 'fs'
import path from 'path'

import { FileState, LogRow, WatcherConfig } from './custom-types/index.js'
import { initDb } from './db/schema.js'

const SETTLE_MS = 300
const FLUSH_MS = 5000
const POLL_MS = parseInt(process.env.POLL_MS ?? '5000', 10)
const CHUNK_SIZE = 4 * 1024 * 1024 // 4 MB per read chunk

const PINO_LEVELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
}

const TS_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}): (.*)$/s

function detectLevel(msg: string, pinoLevel: number | null): string {
  if (pinoLevel && PINO_LEVELS[pinoLevel]) return PINO_LEVELS[pinoLevel]
  const u = msg.toUpperCase()
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

function findLogFiles(dir: string, base = ''): string[] {
  const results: string[] = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${entry.name}` : entry.name
      if (entry.isDirectory())
        results.push(...findLogFiles(path.join(dir, entry.name), rel))
      else if (entry.name.endsWith('.log') || entry.name.endsWith('.txt'))
        results.push(rel)
    }
  } catch {
    /* dir disappeared mid-scan */
  }

  return results
}

class LogWatcher {
  private db: DatabaseSync
  private insert: ReturnType<DatabaseSync['prepare']>
  private state = new Map<string, FileState>()
  private _dirWatchers = new Map<string, fs.FSWatcher>()
  private _pollTimer: ReturnType<typeof setInterval> | null = null
  private logsDir: string

  constructor(config: WatcherConfig) {
    this.logsDir = config.logsDir
    this.db = new DatabaseSync(config.dbPath)
    initDb(this.db)
    this.insert = this.db.prepare(`
      INSERT INTO logs
        (log_file, timestamp, timestamp_unix, level, level_num, message,
         method, url, status_code, response_time, pid, hostname, req_id)
      VALUES
        (:log_file, :timestamp, :timestamp_unix, :level, :level_num, :message,
         :method, :url, :status_code, :response_time, :pid, :hostname, :req_id)
    `)
  }

  start(): void {
    // Resume from last known offset for each file so restarts never duplicate rows
    const ingested = this.db
      .prepare('SELECT log_file, file_size FROM ingestion_log')
      .all() as { log_file: string; file_size: number }[]
    for (const r of ingested) {
      this.state.set(r.log_file, {
        offset: Number(r.file_size),
        pending: null,
        isReading: false,
      })
    }

    const existing = findLogFiles(this.logsDir)
    for (const f of existing) this._catchUp(f)

    try {
      const w = fs.watch(
        this.logsDir,
        { recursive: true },
        (_event, filename) => {
          if (!filename) return
          const rel = filename.replace(/\\/g, '/')
          if (rel.endsWith('.log') || rel.endsWith('.txt'))
            this._scheduleRead(rel)
        },
      )
      w.on('error', () => {})
      this._dirWatchers.set('.', w)
    } catch {
      this._watchDir(this.logsDir, '')
      const walkDirs = (dir: string, base: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          const rel = base ? `${base}/${entry.name}` : entry.name
          this._watchDir(path.join(dir, entry.name), rel)
          walkDirs(path.join(dir, entry.name), rel)
        }
      }
      walkDirs(this.logsDir, '')
    }

    if (POLL_MS > 0) {
      this._pollTimer = setInterval(() => this._poll(), POLL_MS)
      this._pollTimer.unref()
    }

    const newFiles = existing.filter((f) => !this.state.has(f))
    const watchedFiles = existing.filter(
      (f) =>
        fs.existsSync(path.join(this.logsDir, f)) &&
        fs.statSync(path.join(this.logsDir, f)).size > 0,
    ).length
    const pollNote = POLL_MS > 0 ? ` + polling every ${POLL_MS / 1000}s` : ''
    console.log(
      `[watcher] Watching ${watchedFiles} log file(s)${newFiles.length ? `, backfilling ${newFiles.length} new` : ''} (fs.watch${pollNote})`,
    )
  }

  stop(): void {
    if (this._pollTimer) clearInterval(this._pollTimer)
    for (const w of this._dirWatchers.values()) w.close()
    this.db.close()
  }

  private _watchDir(absDir: string, relBase: string): void {
    if (this._dirWatchers.has(relBase)) return
    try {
      const w = fs.watch(absDir, (_event, filename) => {
        if (!filename) return
        const rel = relBase ? `${relBase}/${filename}` : filename
        const full = path.join(absDir, filename)
        if (filename.endsWith('.log') || filename.endsWith('.txt')) {
          this._scheduleRead(rel)
        } else if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
          this._watchDir(full, rel)
        }
      })
      w.on('error', () => {})
      this._dirWatchers.set(relBase, w)
    } catch {
      /* permission error */
    }
  }

  private _poll(): void {
    const files = findLogFiles(this.logsDir)
    for (const f of files) {
      const dir = path.dirname(f)
      if (dir !== '.' && !this._dirWatchers.has(dir)) {
        this._watchDir(path.join(this.logsDir, dir), dir)
      }
      this._catchUp(f)
    }
  }

  private _scheduleRead(logFile: string): void {
    const s = this.state.get(logFile) ?? {
      offset: 0,
      pending: null,
      isReading: false,
    }
    // If a chunked backfill is already running, it will catch up naturally
    if (s.isReading) {
      this.state.set(logFile, s)

      return
    }
    clearTimeout(s.debounceTimer)
    s.debounceTimer = setTimeout(() => this._readChunked(logFile), SETTLE_MS)
    this.state.set(logFile, s)
  }

  private _catchUp(logFile: string): void {
    const filePath = path.join(this.logsDir, logFile)
    if (!fs.existsSync(filePath)) return
    const { size } = fs.statSync(filePath)
    const s = this.state.get(logFile) ?? {
      offset: 0,
      pending: null,
      isReading: false,
    }
    if (size > s.offset) {
      this.state.set(logFile, s)
      this._readChunked(logFile)
    }
  }

  /**
   * Read new bytes from a file in CHUNK_SIZE increments, yielding the event
   * loop between chunks via setImmediate. This keeps the server responsive
   * during large initial backfills without blocking request handling.
   */
  private _readChunked(logFile: string): void {
    const s = this.state.get(logFile)
    if (!s || s.isReading) return
    s.isReading = true

    const processChunk = () => {
      const filePath = path.join(this.logsDir, logFile)
      if (!fs.existsSync(filePath)) {
        s.isReading = false

        return
      }

      const { size } = fs.statSync(filePath)
      if (size <= s.offset) {
        s.isReading = false

        return
      }

      const len = Math.min(size - s.offset, CHUNK_SIZE)
      const buf = Buffer.alloc(len)
      const fd = fs.openSync(filePath, 'r')
      const bytesRead = fs.readSync(fd, buf, 0, len, s.offset)
      fs.closeSync(fd)

      const text = buf.slice(0, bytesRead).toString('utf8')
      const atEof = s.offset + bytesRead >= size

      // Only process up to the last complete line
      const lastNl = text.lastIndexOf('\n')
      if (lastNl === -1) {
        // No complete line in this chunk; wait for more data
        s.isReading = false

        return
      }

      const processable = text.slice(0, lastNl + 1)
      const chunkBytes = Buffer.byteLength(processable, 'utf8')
      const newOffset = s.offset + chunkBytes

      const committed: LogRow[] = []
      for (const line of processable.split('\n')) {
        if (!line.trim()) continue
        const m = line.match(TS_RE)
        if (m) {
          if (s.pending) committed.push(s.pending)
          const parsed = parseTimestamp(m[1])
          s.pending = parsed ? buildRow(logFile, parsed, m[2].trim()) : null
        } else if (s.pending) {
          s.pending.message += '\n' + line.trimEnd()
        }
      }

      if (committed.length) {
        this._insertRows(logFile, committed, newOffset)
        console.log(
          `[watcher] ${logFile} +${committed.length} entr${committed.length === 1 ? 'y' : 'ies'}`,
        )
      }

      s.offset = newOffset

      if (!atEof) {
        // More data remains — yield the event loop then continue
        setImmediate(processChunk)
      } else {
        s.isReading = false
        // Schedule flush of any trailing partial line
        clearTimeout(s.flushTimer)
        if (s.pending) {
          s.flushTimer = setTimeout(() => {
            if (s.pending) {
              this._insertRows(logFile, [s.pending], s.offset)
              console.log(`[watcher] ${logFile} +1 entry (flush)`)
              s.pending = null
            }
          }, FLUSH_MS)
        }
      }
    }

    processChunk()
  }

  private _insertRows(
    logFile: string,
    rows: LogRow[],
    newFileSize: number,
  ): void {
    this.db.exec('BEGIN')
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of rows) this.insert.run(r as any)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      console.error('[watcher] insert error:', (e as Error).message)

      return
    }

    try {
      const ids = (
        this.db
          .prepare(
            'SELECT id FROM logs WHERE log_file = ? ORDER BY id DESC LIMIT ?',
          )
          .all(logFile, rows.length) as { id: number }[]
      ).map((r) => Number(r.id))

      if (ids.length) {
        this.db.exec('BEGIN')
        const ftsInsert = this.db.prepare(
          'INSERT INTO logs_fts(rowid, message) VALUES (?, ?)',
        )
        for (const id of ids) {
          const msgRow = this.db
            .prepare('SELECT message FROM logs WHERE id = ?')
            .get(id) as { message: string } | undefined
          ftsInsert.run(id, msgRow?.message ?? '')
        }
        this.db.exec('COMMIT')
      }
    } catch {
      /* FTS errors are non-fatal */
    }

    const exists = this.db
      .prepare('SELECT 1 FROM ingestion_log WHERE log_file = ?')
      .get(logFile)
    if (exists) {
      this.db
        .prepare(
          'UPDATE ingestion_log SET file_size = ?, row_count = row_count + ?, ingested_at = ? WHERE log_file = ?',
        )
        .run(newFileSize, rows.length, new Date().toISOString(), logFile)
    } else {
      this.db
        .prepare('INSERT INTO ingestion_log VALUES (?, ?, ?, ?)')
        .run(logFile, new Date().toISOString(), rows.length, newFileSize)
    }
  }
}

export function startWatcher(config: WatcherConfig): LogWatcher {
  const w = new LogWatcher(config)
  w.start()

  return w
}

if (require.main === module) {
  const logsDir = process.env.LOGS_DIR || path.join(process.cwd(), 'logs')
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'logs.db')
  const watcher = startWatcher({ logsDir, dbPath })
  process.on('SIGINT', () => {
    watcher.stop()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    watcher.stop()
    process.exit(0)
  })
}
