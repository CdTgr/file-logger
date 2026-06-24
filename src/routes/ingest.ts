import { FastifyInstance } from 'fastify'

import { ApiConfig } from '../custom-types/index.js'
import { resetDb } from '../db/index.js'
import { runIngest } from '../ingest.js'

export async function ingestRoutes(
  fastify: FastifyInstance,
  opts: ApiConfig,
): Promise<void> {
  fastify.post('/api/ingest', async (request, reply) => {
    const body = request.body as { force?: boolean } | null
    const force = body?.force ?? false

    try {
      const totalInserted = await runIngest({
        force,
        logsDir: opts.logsDir,
        dbPath: opts.dbPath,
      })
      resetDb()

      return reply.send({ success: true, totalInserted })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)

      return reply.code(500).send({ error: message })
    }
  })
}
