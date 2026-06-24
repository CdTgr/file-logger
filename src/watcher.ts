import fs from 'fs'
import path from 'path'

import { FileState, LogRow, WatcherConfig } from './custom-types/index.js'
import { sql } from './db/index.js'
import { ensurePartitionsForTimestamps } from './db/partitions.js'
import { initDb } from './db/schema.js'

const SETTLE_MS = 300
const FLUSH_MS = 5000
const POLL_MS = parseInt(process.env.POLL_MS ?? '5000', 10)
const CHUNK_SIZE = 4 * 1024 * 1024 // 4 MB per read chunk
// 13 insert columns × rows = pg parameters; hard limit is 65,534
const MAX_ROWS_PER_INSERT = 5000

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
  private state = new Map<string, FileState>()
  private _dirWatchers = new Map<string, fs.FSWatcher>()
  private _pollTimer: ReturnType<typeof setInterval> | null = null
  private logsDir: string

  constructor(config: WatcherConfig) {
    this.logsDir = config.logsDir
  }

  async start(): Promise<void> {
    // Resume from saved offsets — prevents duplicate rows on restart
    const ingested = await sql<{ log_file: string; file_size: string }[]>`
      SELECT log_file, file_size FROM ingestion_log
    `
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

  private _readChunked(logFile: string): void {
    const s = this.state.get(logFile)
    if (!s || s.isReading) return
    s.isReading = true
    void this._processChunks(logFile)
  }

  private async _processChunks(logFile: string): Promise<void> {
    const s = this.state.get(logFile)
    if (!s) return
    try {
      while (true) {
        const filePath = path.join(this.logsDir, logFile)
        if (!fs.existsSync(filePath)) break

        const { size } = fs.statSync(filePath)
        if (size <= s.offset) break

        const len = Math.min(size - s.offset, CHUNK_SIZE)
        const buf = Buffer.alloc(len)
        const fd = fs.openSync(filePath, 'r')
        const bytesRead = fs.readSync(fd, buf, 0, len, s.offset)
        fs.closeSync(fd)

        const text = buf.slice(0, bytesRead).toString('utf8')
        const atEof = s.offset + bytesRead >= size
        const lastNl = text.lastIndexOf('\n')
        if (lastNl === -1) break

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
          await this._insertRows(logFile, committed, newOffset)
          console.log(
            `[watcher] ${logFile} +${committed.length} entr${committed.length === 1 ? 'y' : 'ies'}`,
          )
        }

        s.offset = newOffset

        if (atEof) {
          clearTimeout(s.flushTimer)
          if (s.pending) {
            s.flushTimer = setTimeout(() => {
              void this._flushPending(logFile)
            }, FLUSH_MS)
          }
          break
        }

        // Yield event loop between chunks so HTTP requests aren't blocked
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    } finally {
      s.isReading = false
    }
  }

  private async _flushPending(logFile: string): Promise<void> {
    const s = this.state.get(logFile)
    if (!s?.pending) return
    await this._insertRows(logFile, [s.pending], s.offset)
    console.log(`[watcher] ${logFile} +1 entry (flush)`)
    s.pending = null
  }

  private async _insertRows(
    logFile: string,
    rows: LogRow[],
    newFileSize: number,
  ): Promise<void> {
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

    for (let i = 0; i < insertData.length; i += MAX_ROWS_PER_INSERT) {
      const chunk = insertData.slice(i, i + MAX_ROWS_PER_INSERT)
      await sql`
        INSERT INTO logs ${sql(chunk, 'log_file', 'timestamp', 'timestamp_unix', 'level', 'level_num', 'message', 'method', 'url', 'status_code', 'response_time', 'pid', 'hostname', 'req_id')}
      `
    }

    await sql`
      INSERT INTO ingestion_log (log_file, ingested_at, row_count, file_size)
      VALUES (${logFile}, NOW(), ${rows.length}, ${newFileSize})
      ON CONFLICT (log_file) DO UPDATE SET
        file_size = ${newFileSize},
        row_count = ingestion_log.row_count + ${rows.length},
        ingested_at = NOW()
    `
  }
}

export async function startWatcher(config: WatcherConfig): Promise<LogWatcher> {
  await initDb()
  const w = new LogWatcher(config)
  await w.start()

  return w
}

if (require.main === module) {
  const logsDir = process.env.LOGS_DIR || path.join(process.cwd(), 'logs')
  void startWatcher({ logsDir }).then((watcher) => {
    process.on('SIGINT', () => {
      watcher.stop()
      process.exit(0)
    })
    process.on('SIGTERM', () => {
      watcher.stop()
      process.exit(0)
    })
  })
}
