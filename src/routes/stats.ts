import { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { sql } from '../db/index.js'
import {
  bucketExpr,
  fileFilter,
  fromFilter,
  levelFilter,
  toFilter,
} from './utils.js'

export async function statsRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  fastify.get('/api/stats/summary', async (request, reply) => {
    const q = request.query as Record<string, string>
    const [row] = await sql<
      { total: string; earliest: string; latest: string }[]
    >`
      SELECT COUNT(*) as total, MIN(timestamp) as earliest, MAX(timestamp) as latest
      FROM logs WHERE 1=1 ${fileFilter(q.file)}
    `

    return reply.send({ ...row, total: Number(row.total) })
  })

  fastify.get('/api/stats/levels', async (request, reply) => {
    const q = request.query as Record<string, string>
    const rows = await sql<{ level: string; count: string }[]>`
      SELECT level, COUNT(*) as count FROM logs
      WHERE 1=1 ${fileFilter(q.file)} ${fromFilter(q.from)} ${toFilter(q.to)}
      GROUP BY level ORDER BY count DESC
    `

    return reply.send(rows.map((r) => ({ ...r, count: Number(r.count) })))
  })

  fastify.get('/api/stats/timeline', async (request, reply) => {
    const q = request.query as Record<string, string>
    const bucket = bucketExpr(q.interval || 'day')
    const rows = await sql<{ bucket: string; count: string }[]>`
      SELECT ${bucket} as bucket, COUNT(*) as count FROM logs
      WHERE 1=1 ${fileFilter(q.file)} ${levelFilter(q.level)} ${fromFilter(q.from)} ${toFilter(q.to)}
      GROUP BY bucket ORDER BY bucket
      LIMIT 500
    `

    return reply.send(rows.map((r) => ({ ...r, count: Number(r.count) })))
  })

  fastify.get('/api/stats/timeline-stacked', async (request, reply) => {
    const q = request.query as Record<string, string>
    const bucket = bucketExpr(q.interval || 'day')
    const rows = await sql<{ bucket: string; level: string; count: string }[]>`
      SELECT ${bucket} as bucket, level, COUNT(*) as count FROM logs
      WHERE 1=1 ${fileFilter(q.file)} ${fromFilter(q.from)} ${toFilter(q.to)}
      GROUP BY bucket, level ORDER BY bucket
      LIMIT 3000
    `

    return reply.send(rows.map((r) => ({ ...r, count: Number(r.count) })))
  })

  fastify.get('/api/stats/urls', async (request, reply) => {
    const q = request.query as Record<string, string>
    const rows = await sql<
      {
        path: string
        count: string
        avg_ms: string | null
        errors: string
      }[]
    >`
      SELECT
        CASE WHEN url LIKE '%?%' THEN split_part(url, '?', 1) ELSE url END as path,
        COUNT(*) as count,
        ROUND(AVG(response_time)::numeric, 1) as avg_ms,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors
      FROM logs
      WHERE url IS NOT NULL
      ${q.file ? sql`AND log_file = ${q.file}` : sql``}
      ${fromFilter(q.from)}
      ${toFilter(q.to)}
      GROUP BY path ORDER BY count DESC LIMIT 25
    `

    return reply.send(
      rows.map((r) => ({
        ...r,
        count: Number(r.count),
        avg_ms: r.avg_ms != null ? Number(r.avg_ms) : null,
        errors: Number(r.errors),
      })),
    )
  })

  fastify.get('/api/stats/http-status', async (request, reply) => {
    const q = request.query as Record<string, string>
    const rows = await sql<{ group_label: string; count: string }[]>`
      SELECT
        CASE WHEN status_code < 200 THEN '1xx'
             WHEN status_code < 300 THEN '2xx'
             WHEN status_code < 400 THEN '3xx'
             WHEN status_code < 500 THEN '4xx'
             ELSE '5xx' END as group_label,
        COUNT(*) as count
      FROM logs
      WHERE status_code IS NOT NULL
      ${q.file ? sql`AND log_file = ${q.file}` : sql``}
      ${fromFilter(q.from)}
      ${toFilter(q.to)}
      GROUP BY group_label ORDER BY group_label
    `

    return reply.send(rows.map((r) => ({ ...r, count: Number(r.count) })))
  })
}
