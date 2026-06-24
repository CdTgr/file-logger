import { sql } from './index.js'

const ensured = new Set<string>()

export async function ensurePartitionsForTimestamps(
  timestamps: number[],
): Promise<void> {
  const months = new Set(
    timestamps.map((ts) => {
      const d = new Date(ts)

      return `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    }),
  )
  for (const key of months) {
    if (ensured.has(key)) continue
    const [y, m] = key.split('_').map(Number)
    const from = Date.UTC(y, m - 1, 1)
    const to = Date.UTC(y, m, 1)
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS logs_${key} PARTITION OF logs FOR VALUES FROM (${from}) TO (${to})`,
    )
    ensured.add(key)
  }
}
