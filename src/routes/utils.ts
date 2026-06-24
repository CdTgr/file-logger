import { FastifyReply } from 'fastify'

import { FilterParams, SqlParam } from '../custom-types/index.js'
import { getDb } from '../db/index.js'

/** Build a WHERE clause from common filter params, pushing values into `params`. */
export function buildWhere(
  params: SqlParam[],
  { file, level, from, to }: FilterParams,
): string {
  const conds: string[] = []

  if (file) {
    conds.push('log_file = ?')
    params.push(file)
  }

  if (level && level !== 'ALL') {
    conds.push('level = ?')
    params.push(level)
  }

  if (from) {
    conds.push('timestamp_unix >= ?')
    params.push(new Date(from).getTime())
  }

  if (to) {
    const d = new Date(to)
    d.setUTCHours(23, 59, 59, 999)
    conds.push('timestamp_unix <= ?')
    params.push(d.getTime())
  }

  return conds.length ? 'WHERE ' + conds.join(' AND ') : ''
}

/** Return the SQLite bucket expression for a given time interval. */
export function bucketExpr(interval: string): string {
  if (interval === 'minute') {
    return "strftime('%Y-%m-%d %H:%M', datetime(timestamp_unix/1000, 'unixepoch'))"
  }

  if (interval === 'day') {
    return "strftime('%Y-%m-%d', datetime(timestamp_unix/1000, 'unixepoch'))"
  }

  return "strftime('%Y-%m-%d %H:00', datetime(timestamp_unix/1000, 'unixepoch'))"
}

/** Return the DB or send a 503 and return null. */
export function dbOrReject(reply: FastifyReply) {
  const d = getDb()

  if (!d) {
    void reply
      .code(503)
      .send({ error: 'Database not ready. Run: npm run ingest' })

    return null
  }

  return d
}
