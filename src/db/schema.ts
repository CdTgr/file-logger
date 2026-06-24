import { DatabaseSync } from 'node:sqlite'

export function initDb(db: DatabaseSync): void {
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
