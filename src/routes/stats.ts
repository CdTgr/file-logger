import { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { SqlParam } from '../custom-types/index.js'
import { bucketExpr, buildWhere, dbOrReject } from './utils.js'

export async function statsRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  fastify.get('/api/stats/summary', async (request, reply) => {
    const d = dbOrReject(reply)

    if (!d) {
      return
    }

    const q = request.query as Record<string, string>
    const params: SqlParam[] = []
    const where = buildWhere(params, { file: q.file })
    const row = d
      .prepare(
        `SELECT COUNT(*) as total, MIN(timestamp) as earliest, MAX(timestamp) as latest FROM logs ${where}`,
      )
      .get(...params) as { total: number; earliest: string; latest: string }

    return reply.send({ ...row, total: Number(row.total) })
  })

  fastify.get('/api/stats/levels', async (request, reply) => {
    const d = dbOrReject(reply)

    if (!d) {
      return
    }

    const q = request.query as Record<string, string>
    const params: SqlParam[] = []
    const where = buildWhere(params, { file: q.file, from: q.from, to: q.to })
    const rows = d
      .prepare(
        `SELECT level, COUNT(*) as count FROM logs ${where} GROUP BY level ORDER BY count DESC`,
      )
      .all(...params) as { level: string; count: number }[]

    return reply.send(rows.map((r) => ({ ...r, count: Number(r.count) })))
  })

  fastify.get('/api/stats/timeline', async (request, reply) => {
    const d = dbOrReject(reply)

    if (!d) {
      return
    }

    const q = request.query as Record<string, string>
    const params: SqlParam[] = []
    const where = buildWhere(params, {
      file: q.file,
      level: q.level,
      from: q.from,
      to: q.to,
    })
    const bucket = bucketExpr(q.interval || 'hour')
    const rows = d
      .prepare(
        `SELECT ${bucket} as bucket, COUNT(*) as count FROM logs ${where} GROUP BY bucket ORDER BY bucket`,
      )
      .all(...params) as { bucket: string; count: number }[]

    return reply.send(rows.map((r) => ({ ...r, count: Number(r.count) })))
  })

  fastify.get('/api/stats/timeline-stacked', async (request, reply) => {
    const d = dbOrReject(reply)

    if (!d) {
      return
    }

    const q = request.query as Record<string, string>
    const params: SqlParam[] = []
    const where = buildWhere(params, { file: q.file, from: q.from, to: q.to })
    const bucket = bucketExpr(q.interval || 'hour')
    const rows = d
      .prepare(
        `SELECT ${bucket} as bucket, level, COUNT(*) as count FROM logs ${where} GROUP BY bucket, level ORDER BY bucket`,
      )
      .all(...params) as { bucket: string; level: string; count: number }[]

    return reply.send(rows.map((r) => ({ ...r, count: Number(r.count) })))
  })

  fastify.get('/api/stats/urls', async (request, reply) => {
    const d = dbOrReject(reply)

    if (!d) {
      return
    }

    const q = request.query as Record<string, string>
    const params: SqlParam[] = []
    const conds = ['url IS NOT NULL']

    if (q.file) {
      conds.push('log_file = ?')
      params.push(q.file)
    }

    if (q.from) {
      conds.push('timestamp_unix >= ?')
      params.push(new Date(q.from).getTime())
    }

    if (q.to) {
      conds.push('timestamp_unix <= ?')
      params.push(new Date(q.to).getTime())
    }

    const rows = d
      .prepare(
        `SELECT
          CASE WHEN instr(url,'?') > 0 THEN substr(url, 1, instr(url,'?') - 1) ELSE url END as path,
          COUNT(*) as count,
          ROUND(AVG(response_time), 1) as avg_ms,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors
        FROM logs WHERE ${conds.join(' AND ')}
        GROUP BY path ORDER BY count DESC LIMIT 25`,
      )
      .all(...params) as {
      path: string
      count: number
      avg_ms: number | null
      errors: number
    }[]

    return reply.send(
      rows.map((r) => ({
        ...r,
        count: Number(r.count),
        errors: Number(r.errors),
      })),
    )
  })

  fastify.get('/api/stats/http-status', async (request, reply) => {
    const d = dbOrReject(reply)

    if (!d) {
      return
    }

    const q = request.query as Record<string, string>
    const params: SqlParam[] = []
    const conds = ['status_code IS NOT NULL']

    if (q.file) {
      conds.push('log_file = ?')
      params.push(q.file)
    }

    if (q.from) {
      conds.push('timestamp_unix >= ?')
      params.push(new Date(q.from).getTime())
    }

    if (q.to) {
      conds.push('timestamp_unix <= ?')
      params.push(new Date(q.to).getTime())
    }

    const rows = d
      .prepare(
        `SELECT
          CASE WHEN status_code < 200 THEN '1xx'
               WHEN status_code < 300 THEN '2xx'
               WHEN status_code < 400 THEN '3xx'
               WHEN status_code < 500 THEN '4xx'
               ELSE '5xx' END as group_label,
          COUNT(*) as count
        FROM logs WHERE ${conds.join(' AND ')}
        GROUP BY group_label ORDER BY group_label`,
      )
      .all(...params) as { group_label: string; count: number }[]

    return reply.send(rows.map((r) => ({ ...r, count: Number(r.count) })))
  })
}
