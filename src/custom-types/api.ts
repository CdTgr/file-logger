import { FastifyPluginOptions } from 'fastify'

/** Configuration passed to `registerApiRoutes` and individual route plugins. */
export interface ApiConfig extends FastifyPluginOptions {
  logsDir: string
  dbPath: string
}

/** SQL filter params extracted from request query strings. */
export interface FilterParams {
  file?: string
  level?: string
  from?: string
  to?: string
}
