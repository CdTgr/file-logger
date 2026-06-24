import { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { sql } from '../db/index.js'

export async function statusRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  fastify.get('/api/status', async (_req, reply) => {
    try {
      const [row] = await sql<{ n: string }[]>`SELECT COUNT(*) as n FROM logs`
      const files = await sql`SELECT * FROM ingestion_log ORDER BY log_file`

      return reply.send({ ready: true, total: Number(row.n), files })
    } catch {
      return reply.send({ ready: false })
    }
  })
}
