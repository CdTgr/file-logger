import { sql } from '../db/index.js'

export function fileFilter(file?: string) {
  return file ? sql`AND log_file = ${file}` : sql``
}

export function levelFilter(level?: string) {
  return level && level !== 'ALL' ? sql`AND level = ${level}` : sql``
}

export function fromFilter(from?: string) {
  return from ? sql`AND timestamp_unix >= ${new Date(from).getTime()}` : sql``
}

export function toFilter(to?: string) {
  if (!to) return sql``
  const d = new Date(to)
  d.setUTCHours(23, 59, 59, 999)

  return sql`AND timestamp_unix <= ${d.getTime()}`
}

export function bucketExpr(interval: string) {
  if (interval === 'minute')
    return sql`to_char(to_timestamp(timestamp_unix / 1000.0), 'YYYY-MM-DD HH24:MI')`
  if (interval === 'day')
    return sql`to_char(to_timestamp(timestamp_unix / 1000.0), 'YYYY-MM-DD')`

  return sql`to_char(to_timestamp(timestamp_unix / 1000.0), 'YYYY-MM-DD HH24:00')`
}
