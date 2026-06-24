import { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { SqlParam } from '../custom-types/index.js'
import { buildWhere, dbOrReject } from './utils.js'

export async function logsRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  fastify.get('/api/logs', async (request, reply) => {
    const d = dbOrReject(reply)

    if (!d) {
      return
    }

    const q = request.query as Record<string, string>
    const { file, level, from, to, page = '1', limit = '200' } = q
    const search = q.q
    const pageNum = Math.max(1, parseInt(page))
    const limitNum = Math.min(500, Math.max(10, parseInt(limit)))
    const offset = (pageNum - 1) * limitNum

    const params: SqlParam[] = []
    const where = buildWhere(params, { file, level, from, to })

    let rows: unknown[]
    let total: number

    if (search && search.trim()) {
      const ftsAnd = params.length ? ' AND ' + where.replace('WHERE ', '') : ''

      rows = d
        .prepare(
          `SELECT l.* FROM logs l JOIN logs_fts fts ON l.id = fts.rowid
           WHERE fts.message MATCH ?${ftsAnd}
           ORDER BY l.timestamp_unix DESC LIMIT ? OFFSET ?`,
        )
        .all(search.trim(), ...params, limitNum, offset)

      const countRow = d
        .prepare(
          `SELECT COUNT(*) as n FROM logs l JOIN logs_fts fts ON l.id = fts.rowid
           WHERE fts.message MATCH ?${ftsAnd}`,
        )
        .get(search.trim(), ...params) as { n: number }

      total = Number(countRow.n)
    } else {
      rows = d
        .prepare(
          `SELECT * FROM logs ${where} ORDER BY timestamp_unix DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limitNum, offset)

      const countRow = d
        .prepare(`SELECT COUNT(*) as n FROM logs ${where}`)
        .get(...params) as { n: number }

      total = Number(countRow.n)
    }

    return reply.send({ rows, total, page: pageNum, limit: limitNum })
  })
}
