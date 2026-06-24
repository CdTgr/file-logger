'use strict'

const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const LOGS_DIR = path.join(__dirname, 'logs')
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'logs.db')

function findLogFiles(dir, base = '') {
  const results = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        results.push(...findLogFiles(path.join(dir, entry.name), rel))
      } else if (entry.name.endsWith('.log') || entry.name.endsWith('.txt')) {
        results.push(rel)
      }
    }
  } catch {
    /* dir disappeared mid-scan */
  }
  return results
}
const SETTLE_MS = 300 // debounce after fs.watch event fires
const FLUSH_MS = 5000 // commit a dangling pending row after this many ms of silence
// Polling interval — catches changes when fs.watch events don't propagate
// (Docker Desktop on macOS, NFS mounts, etc.). Set POLL_MS=0 to disable.
const POLL_MS = parseInt(process.env.POLL_MS ?? '5000', 10)

// ── Parser helpers (mirrors ingest.js) ───────────────────────────────────────

const PINO_LEVELS = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
}
const TS_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}): (.*)$/s

function detectLevel(msg, pinoLevel) {
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

function parseTimestamp(ts) {
  const iso = ts.replace(' ', 'T').replace(/ ([+-])/, '$1')
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : { iso: d.toISOString(), unix: d.getTime() }
}

function buildRow(logFile, parsed, msgRaw) {
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

// ── Watcher ──────────────────────────────────────────────────────────────────

class LogWatcher {
  constructor() {
    // Separate writable connection — server.js uses readonly
    this.db = new DatabaseSync(DB_PATH)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')

    this.insert = this.db.prepare(`
      INSERT INTO logs
        (log_file, timestamp, timestamp_unix, level, level_num, message,
         method, url, status_code, response_time, pid, hostname, req_id)
      VALUES
        (:log_file, :timestamp, :timestamp_unix, :level, :level_num, :message,
         :method, :url, :status_code, :response_time, :pid, :hostname, :req_id)
    `)

    // per-file state: { offset, pending, debounceTimer, flushTimer }
    this.state = new Map()

    this._dirWatchers = new Map() // relDir -> FSWatcher
    this._pollTimer = null
  }

  // ── Public ────────────────────────────────────────────────────────────────

  start() {
    // Load known offsets from DB
    const ingested = this.db
      .prepare('SELECT log_file, file_size FROM ingestion_log')
      .all()
    for (const r of ingested) {
      this.state.set(r.log_file, { offset: Number(r.file_size), pending: null })
    }

    // Catch up on any growth since last ingest/watch
    const existing = findLogFiles(LOGS_DIR)
    for (const f of existing) this._catchUp(f)

    // Try recursive fs.watch (macOS / Windows).
    // On Linux (Docker) this throws — fall back to watching each directory individually.
    try {
      const w = fs.watch(LOGS_DIR, { recursive: true }, (event, filename) => {
        if (!filename) return
        const rel = filename.replace(/\\/g, '/') // normalise Windows separators
        if (rel.endsWith('.log') || rel.endsWith('.txt'))
          this._scheduleRead(rel)
      })
      w.on('error', () => {})
      this._dirWatchers.set('.', w)
    } catch {
      // Watch LOGS_DIR and every subdirectory found now; new subdirs are picked
      // up during the poll cycle when they appear.
      this._watchDir(LOGS_DIR, '')
      const walkDirs = (dir, base) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          const rel = base ? `${base}/${entry.name}` : entry.name
          this._watchDir(path.join(dir, entry.name), rel)
          walkDirs(path.join(dir, entry.name), rel)
        }
      }
      walkDirs(LOGS_DIR, '')
    }

    // Polling fallback — essential in Docker where bind-mount events may not
    // propagate through the VM layer (Docker Desktop on macOS/Windows).
    if (POLL_MS > 0) {
      this._pollTimer = setInterval(() => this._poll(), POLL_MS)
      this._pollTimer.unref()
    }

    const count = existing.filter(
      (f) => fs.statSync(path.join(LOGS_DIR, f)).size > 0,
    ).length
    const pollNote = POLL_MS > 0 ? ` + polling every ${POLL_MS / 1000}s` : ''
    console.log(
      `[watcher] Watching ${count} log file(s) for changes (fs.watch${pollNote})`,
    )
  }

  stop() {
    clearInterval(this._pollTimer)
    for (const w of this._dirWatchers.values()) w.close()
    this.db.close()
  }

  // Watch a single directory; fires on file changes AND new subdirs appearing.
  _watchDir(absDir, relBase) {
    if (this._dirWatchers.has(relBase)) return
    try {
      const w = fs.watch(absDir, (event, filename) => {
        if (!filename) return
        const rel = relBase ? `${relBase}/${filename}` : filename
        const full = path.join(absDir, filename)
        if (filename.endsWith('.log') || filename.endsWith('.txt')) {
          this._scheduleRead(rel)
        } else if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
          // New subdirectory — start watching it
          this._watchDir(full, rel)
        }
      })
      w.on('error', () => {})
      this._dirWatchers.set(relBase, w)
    } catch {
      /* permission error etc. */
    }
  }

  _poll() {
    const files = findLogFiles(LOGS_DIR)
    for (const f of files) {
      // Watch any new subdirectories that appeared between polls (Linux path)
      const dir = path.dirname(f)
      if (dir !== '.' && !this._dirWatchers.has(dir)) {
        this._watchDir(path.join(LOGS_DIR, dir), dir)
      }
      this._catchUp(f)
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _scheduleRead(logFile) {
    const s = this.state.get(logFile) ?? { offset: 0, pending: null }
    clearTimeout(s.debounceTimer)
    s.debounceTimer = setTimeout(() => this._readNew(logFile), SETTLE_MS)
    this.state.set(logFile, s)
  }

  _catchUp(logFile) {
    const filePath = path.join(LOGS_DIR, logFile)
    if (!fs.existsSync(filePath)) return
    const { size } = fs.statSync(filePath)
    const s = this.state.get(logFile) ?? { offset: 0, pending: null }
    if (size > s.offset) {
      this.state.set(logFile, s)
      this._readNew(logFile)
    }
  }

  _readNew(logFile) {
    const filePath = path.join(LOGS_DIR, logFile)
    if (!fs.existsSync(filePath)) return

    const { size } = fs.statSync(filePath)
    const s = this.state.get(logFile) ?? { offset: 0, pending: null }

    if (size <= s.offset) return // nothing new

    // Read only new bytes
    const len = size - s.offset
    const buf = Buffer.alloc(len)
    const fd = fs.openSync(filePath, 'r')
    const bytesRead = fs.readSync(fd, buf, 0, len, s.offset)
    fs.closeSync(fd)

    const text = buf.slice(0, bytesRead).toString('utf8')

    // Only process up to the last complete newline (avoids partial lines from
    // mid-write reads). Save the tail for the next read cycle.
    const lastNl = text.lastIndexOf('\n')
    if (lastNl === -1) return // no complete line yet

    const processable = text.slice(0, lastNl + 1)
    const newOffset = s.offset + Buffer.byteLength(processable, 'utf8')

    // Parse lines
    const committed = []
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

    // Write committed rows
    if (committed.length) {
      this._insertRows(logFile, committed, newOffset)
      console.log(
        `[watcher] ${logFile} +${committed.length} new entr${committed.length === 1 ? 'y' : 'ies'}`,
      )
    }

    s.offset = newOffset
    this.state.set(logFile, s)

    // Flush dangling pending row after silence (last entry in file)
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

  _insertRows(logFile, rows, newFileSize) {
    this.db.exec('BEGIN')
    try {
      for (const r of rows) this.insert.run(r)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      console.error('[watcher] insert error:', e.message)
      return
    }

    // Update FTS index incrementally
    try {
      const ids = this.db
        .prepare(
          'SELECT id FROM logs WHERE log_file = ? ORDER BY id DESC LIMIT ?',
        )
        .all(logFile, rows.length)
        .map((r) => Number(r.id))
      if (ids.length) {
        this.db.exec('BEGIN')
        const ftsInsert = this.db.prepare(
          'INSERT INTO logs_fts(rowid, message) VALUES (?, ?)',
        )
        for (const id of ids) {
          const msg =
            this.db.prepare('SELECT message FROM logs WHERE id = ?').get(id)
              ?.message ?? ''
          ftsInsert.run(id, msg)
        }
        this.db.exec('COMMIT')
      }
    } catch {
      /* FTS errors are non-fatal */
    }

    // Update offset in ingestion_log
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

// ── Export & standalone mode ──────────────────────────────────────────────────

function startWatcher() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('[watcher] No database found — run `npm run ingest` first.')
    return null
  }
  const w = new LogWatcher()
  w.start()
  return w
}

module.exports = { startWatcher }

// Run standalone: `node watcher.js`
if (require.main === module) {
  const watcher = startWatcher()
  if (!watcher) process.exit(1)
  process.on('SIGINT', () => {
    watcher.stop()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    watcher.stop()
    process.exit(0)
  })
}
