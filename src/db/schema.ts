import { sql } from './index.js'

export async function initDb(): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ingestion_log (
      log_file    TEXT PRIMARY KEY,
      ingested_at TIMESTAMPTZ NOT NULL,
      row_count   BIGINT NOT NULL DEFAULT 0,
      file_size   BIGINT NOT NULL DEFAULT 0
    )
  `)

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS logs (
      id             BIGSERIAL,
      log_file       TEXT    NOT NULL,
      timestamp      TIMESTAMPTZ NOT NULL,
      timestamp_unix BIGINT  NOT NULL,
      level          TEXT    NOT NULL DEFAULT 'INFO',
      level_num      INTEGER,
      message        TEXT    NOT NULL,
      message_tsv    TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(message, ''))) STORED,
      method         TEXT,
      url            TEXT,
      status_code    INTEGER,
      response_time  REAL,
      pid            INTEGER,
      hostname       TEXT,
      req_id         TEXT,
      PRIMARY KEY (id, timestamp_unix)
    ) PARTITION BY RANGE (timestamp_unix)
  `)

  for (const ddl of [
    `CREATE INDEX IF NOT EXISTS idx_ts ON logs(timestamp_unix)`,
    `CREATE INDEX IF NOT EXISTS idx_level ON logs(level)`,
    `CREATE INDEX IF NOT EXISTS idx_file ON logs(log_file)`,
    `CREATE INDEX IF NOT EXISTS idx_file_ts ON logs(log_file, timestamp_unix)`,
    `CREATE INDEX IF NOT EXISTS idx_file_lvl ON logs(log_file, level)`,
    `CREATE INDEX IF NOT EXISTS idx_message_tsv ON logs USING GIN (message_tsv)`,
  ]) {
    await sql.unsafe(ddl)
  }
}
