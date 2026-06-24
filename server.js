'use strict';

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { startWatcher } = require('./watcher');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'logs.db');
const PORT    = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Single shared connection — Express + node:sqlite are both sync-friendly
let db = null;

function getDb() {
  if (db) return db;
  if (!fs.existsSync(DB_PATH)) return null;
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA cache_size = -32000; PRAGMA query_only = TRUE;');
  return db;
}

function ensureDb(res) {
  if (!getDb()) {
    res.status(503).json({ error: 'Database not ready. Run: npm run ingest' });
    return false;
  }
  return true;
}

// ── Query helpers ─────────────────────────────────────────────────────────────

function buildWhere(params, { file, level, from, to }) {
  const conds = [];
  if (file)              { conds.push('log_file = ?');        params.push(file); }
  if (level && level !== 'ALL') { conds.push('level = ?');   params.push(level); }
  if (from)              { conds.push('timestamp_unix >= ?'); params.push(new Date(from).getTime()); }
  if (to)                { conds.push('timestamp_unix <= ?'); params.push(new Date(to).getTime()); }
  return conds.length ? 'WHERE ' + conds.join(' AND ') : '';
}

function bucketExpr(interval) {
  if (interval === 'minute') return "strftime('%Y-%m-%d %H:%M', datetime(timestamp_unix/1000, 'unixepoch'))";
  if (interval === 'day')    return "strftime('%Y-%m-%d', datetime(timestamp_unix/1000, 'unixepoch'))";
  return "strftime('%Y-%m-%d %H:00', datetime(timestamp_unix/1000, 'unixepoch'))";
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => {
  const d = getDb();
  if (!d) return res.json({ ready: false });
  try {
    const { n } = d.prepare('SELECT COUNT(*) as n FROM logs').get();
    const files  = d.prepare('SELECT * FROM ingestion_log ORDER BY log_file').all();
    res.json({ ready: true, total: Number(n), files });
  } catch { res.json({ ready: false }); }
});

app.get('/api/files', (req, res) => {
  if (!ensureDb(res)) return;
  res.json(db.prepare('SELECT DISTINCT log_file FROM logs ORDER BY log_file').all().map(r => r.log_file));
});

app.get('/api/logs', (req, res) => {
  if (!ensureDb(res)) return;
  const { file, level, from, to, q, page = 1, limit = 200 } = req.query;
  const pageNum  = Math.max(1, parseInt(page));
  const limitNum = Math.min(500, Math.max(10, parseInt(limit)));
  const offset   = (pageNum - 1) * limitNum;

  const params = [];
  const where  = buildWhere(params, { file, level, from, to });

  let rows, total;

  if (q && q.trim()) {
    const ftsAnd = params.length ? ' AND ' + where.replace('WHERE ', '') : '';
    rows  = db.prepare(
      `SELECT l.* FROM logs l JOIN logs_fts fts ON l.id = fts.rowid
       WHERE fts.message MATCH ?${ftsAnd}
       ORDER BY l.timestamp_unix DESC LIMIT ? OFFSET ?`
    ).all(q.trim(), ...params, limitNum, offset);
    total = Number(db.prepare(
      `SELECT COUNT(*) as n FROM logs l JOIN logs_fts fts ON l.id = fts.rowid
       WHERE fts.message MATCH ?${ftsAnd}`
    ).get(q.trim(), ...params).n);
  } else {
    rows  = db.prepare(`SELECT * FROM logs ${where} ORDER BY timestamp_unix DESC LIMIT ? OFFSET ?`)
               .all(...params, limitNum, offset);
    total = Number(db.prepare(`SELECT COUNT(*) as n FROM logs ${where}`).get(...params).n);
  }

  res.json({ rows, total, page: pageNum, limit: limitNum });
});

app.get('/api/stats/summary', (req, res) => {
  if (!ensureDb(res)) return;
  const params = [];
  const where  = buildWhere(params, { file: req.query.file });
  const row = db.prepare(
    `SELECT COUNT(*) as total, MIN(timestamp) as earliest, MAX(timestamp) as latest FROM logs ${where}`
  ).get(...params);
  res.json({ ...row, total: Number(row.total) });
});

app.get('/api/stats/levels', (req, res) => {
  if (!ensureDb(res)) return;
  const params = [];
  const where  = buildWhere(params, { file: req.query.file, from: req.query.from, to: req.query.to });
  const rows   = db.prepare(
    `SELECT level, COUNT(*) as count FROM logs ${where} GROUP BY level ORDER BY count DESC`
  ).all(...params).map(r => ({ ...r, count: Number(r.count) }));
  res.json(rows);
});

app.get('/api/stats/timeline', (req, res) => {
  if (!ensureDb(res)) return;
  const { file, from, to, level, interval = 'hour' } = req.query;
  const params = [];
  const where  = buildWhere(params, { file, level, from, to });
  const bucket = bucketExpr(interval);
  const rows   = db.prepare(
    `SELECT ${bucket} as bucket, COUNT(*) as count FROM logs ${where} GROUP BY bucket ORDER BY bucket`
  ).all(...params).map(r => ({ ...r, count: Number(r.count) }));
  res.json(rows);
});

app.get('/api/stats/timeline-stacked', (req, res) => {
  if (!ensureDb(res)) return;
  const { file, from, to, interval = 'hour' } = req.query;
  const params = [];
  const where  = buildWhere(params, { file, from, to });
  const bucket = bucketExpr(interval);
  const rows   = db.prepare(
    `SELECT ${bucket} as bucket, level, COUNT(*) as count FROM logs ${where} GROUP BY bucket, level ORDER BY bucket`
  ).all(...params).map(r => ({ ...r, count: Number(r.count) }));
  res.json(rows);
});

app.get('/api/stats/urls', (req, res) => {
  if (!ensureDb(res)) return;
  const { file, from, to } = req.query;
  const params = [];
  const conds  = ['url IS NOT NULL'];
  if (file) { conds.push('log_file = ?'); params.push(file); }
  if (from) { conds.push('timestamp_unix >= ?'); params.push(new Date(from).getTime()); }
  if (to)   { conds.push('timestamp_unix <= ?'); params.push(new Date(to).getTime()); }

  const rows = db.prepare(`
    SELECT
      CASE WHEN instr(url,'?') > 0 THEN substr(url, 1, instr(url,'?') - 1) ELSE url END as path,
      COUNT(*) as count,
      ROUND(AVG(response_time), 1) as avg_ms,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors
    FROM logs WHERE ${conds.join(' AND ')}
    GROUP BY path ORDER BY count DESC LIMIT 25
  `).all(...params).map(r => ({ ...r, count: Number(r.count), errors: Number(r.errors) }));
  res.json(rows);
});

app.get('/api/stats/http-status', (req, res) => {
  if (!ensureDb(res)) return;
  const { file, from, to } = req.query;
  const params = [];
  const conds  = ['status_code IS NOT NULL'];
  if (file) { conds.push('log_file = ?'); params.push(file); }
  if (from) { conds.push('timestamp_unix >= ?'); params.push(new Date(from).getTime()); }
  if (to)   { conds.push('timestamp_unix <= ?'); params.push(new Date(to).getTime()); }

  const rows = db.prepare(`
    SELECT
      CASE WHEN status_code < 200 THEN '1xx'
           WHEN status_code < 300 THEN '2xx'
           WHEN status_code < 400 THEN '3xx'
           WHEN status_code < 500 THEN '4xx'
           ELSE '5xx' END as group_label,
      COUNT(*) as count
    FROM logs WHERE ${conds.join(' AND ')}
    GROUP BY group_label ORDER BY group_label
  `).all(...params).map(r => ({ ...r, count: Number(r.count) }));
  res.json(rows);
});

app.listen(PORT, () => {
  console.log(`File Logger → http://localhost:${PORT}`);
  if (!fs.existsSync(DB_PATH)) {
    console.log('  No database found — run `npm run ingest` first.');
    return;
  }
  startWatcher();
});
