import { FastifyPluginOptions } from 'fastify'

/** Configuration passed to `registerApiRoutes` and individual route plugins. */
export interface ApiConfig extends FastifyPluginOptions {
  logsDir: string
}
