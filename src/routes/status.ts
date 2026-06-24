import { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { getDb } from '../db/index.js'

export async function statusRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  fastify.get('/api/status', async (_req, reply) => {
    const d = getDb()

    if (!d) {
      return reply.send({ ready: false })
    }

    try {
      const row = d.prepare('SELECT COUNT(*) as n FROM logs').get() as {
        n: number
      }
      const files = d
        .prepare('SELECT * FROM ingestion_log ORDER BY log_file')
        .all()

      return reply.send({ ready: true, total: Number(row.n), files })
    } catch {
      return reply.send({ ready: false })
    }
  })
}
