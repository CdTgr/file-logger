import { FastifyInstance } from 'fastify'
import fs from 'fs'
import path from 'path'

import { ApiConfig } from '../custom-types/index.js'
import { dbOrReject } from './utils.js'

export async function filesRoutes(
  fastify: FastifyInstance,
  opts: ApiConfig,
): Promise<void> {
  fastify.get('/api/files', async (_req, reply) => {
    const d = dbOrReject(reply)

    if (!d) {
      return
    }

    const rows = d
      .prepare('SELECT DISTINCT log_file FROM logs ORDER BY log_file')
      .all() as { log_file: string }[]

    return reply.send(rows.map((r) => r.log_file))
  })

  fastify.get('/api/files/download', async (request, reply) => {
    const q = request.query as Record<string, string>
    const { file } = q

    if (!file) {
      return reply.code(400).send({ error: 'file param required' })
    }

    const filePath = path.resolve(opts.logsDir, file)

    if (!filePath.startsWith(path.resolve(opts.logsDir))) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'File not found' })
    }

    void reply.header(
      'Content-Disposition',
      `attachment; filename="${path.basename(file)}"`,
    )
    void reply.header('Content-Type', 'application/octet-stream')

    return reply.send(fs.createReadStream(filePath))
  })
}
