import { FastifyInstance } from 'fastify'

import { ApiConfig } from '../custom-types/index.js'
import { filesRoutes } from './files.js'
import { ingestRoutes } from './ingest.js'
import { logsRoutes } from './logs.js'
import { statsRoutes } from './stats.js'
import { statusRoutes } from './status.js'

export async function registerApiRoutes(
  fastify: FastifyInstance,
  opts: ApiConfig,
): Promise<void> {
  fastify.register(statusRoutes)
  fastify.register(filesRoutes, opts)
  fastify.register(logsRoutes)
  fastify.register(statsRoutes)
  fastify.register(ingestRoutes, opts)
}
