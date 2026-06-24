import { DatabaseSync } from 'node:sqlite'

import fs from 'fs'

let db: DatabaseSync | null = null
let dbPath = ''

export function configureDb(path: string): void {
  dbPath = path
}

export function getDb(): DatabaseSync | null {
  if (db) return db
  const p = dbPath || process.env.DB_PATH || 'logs.db'
  if (!fs.existsSync(p)) return null
  db = new DatabaseSync(p)
  db.exec(
    'PRAGMA journal_mode = WAL; PRAGMA cache_size = -32000; PRAGMA query_only = TRUE;',
  )

  return db
}

export function resetDb(): void {
  if (db) {
    try {
      db.close()
    } catch {
      // ignore close errors
    }
    db = null
  }
}
