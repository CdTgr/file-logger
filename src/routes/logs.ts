import { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { sql } from '../db/index.js'
import { fileFilter, fromFilter, levelFilter, toFilter } from './utils.js'

export async function logsRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  fastify.get('/api/logs', async (request, reply) => {
    const q = request.query as Record<string, string>
    const { file, level, from, to, page = '1', limit = '200' } = q
    const search = q.q
    const pageNum = Math.max(1, parseInt(page))
    const limitNum = Math.min(500, Math.max(10, parseInt(limit)))
    const offset = (pageNum - 1) * limitNum

    let rows: object[]
    let total: number

    if (search && search.trim()) {
      const term = search.trim()
      const [countRow] = await sql<{ n: string }[]>`
        SELECT COUNT(*) as n FROM logs
        WHERE 1=1
        ${fileFilter(file)}
        ${levelFilter(level)}
        ${fromFilter(from)}
        ${toFilter(to)}
        AND message_tsv @@ plainto_tsquery('english', ${term})
      `
      total = Number(countRow.n)
      rows = [
        ...(await sql`
          SELECT id, log_file, timestamp, timestamp_unix, level, level_num, message,
                 method, url, status_code, response_time, pid, hostname, req_id
          FROM logs
          WHERE 1=1
          ${fileFilter(file)}
          ${levelFilter(level)}
          ${fromFilter(from)}
          ${toFilter(to)}
          AND message_tsv @@ plainto_tsquery('english', ${term})
          ORDER BY timestamp_unix DESC
          LIMIT ${limitNum} OFFSET ${offset}
        `),
      ]
    } else {
      const [countRow] = await sql<{ n: string }[]>`
        SELECT COUNT(*) as n FROM logs
        WHERE 1=1
        ${fileFilter(file)}
        ${levelFilter(level)}
        ${fromFilter(from)}
        ${toFilter(to)}
      `
      total = Number(countRow.n)
      rows = [
        ...(await sql`
          SELECT id, log_file, timestamp, timestamp_unix, level, level_num, message,
                 method, url, status_code, response_time, pid, hostname, req_id
          FROM logs
          WHERE 1=1
          ${fileFilter(file)}
          ${levelFilter(level)}
          ${fromFilter(from)}
          ${toFilter(to)}
          ORDER BY timestamp_unix DESC
          LIMIT ${limitNum} OFFSET ${offset}
        `),
      ]
    }

    return reply.send({ rows, total, page: pageNum, limit: limitNum })
  })
}
