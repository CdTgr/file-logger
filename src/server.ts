import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import path from 'path'

import { initDb } from './db/schema.js'
import { registerApiRoutes } from './routes/index.js'
import { startWatcher } from './watcher.js'

const LOGS_DIR = process.env.LOGS_DIR || path.join(process.cwd(), 'logs')
const PORT = parseInt(process.env.PORT || '3000', 10)

// In dev (tsx), __dirname = src/; in prod (node dist/), __dirname = dist/
// Both cases: go up one level, then into src/public
const PUBLIC_DIR = path.join(__dirname, '..', 'src', 'public')

const fastify = Fastify({ logger: false })

fastify.register(fastifyStatic, {
  root: PUBLIC_DIR,
  prefix: '/',
  wildcard: false,
})

fastify.register(registerApiRoutes, { logsDir: LOGS_DIR })

// SPA fallback — any route not matched by API or static files serves index.html
fastify.setNotFoundHandler((_req, reply) => {
  void reply.sendFile('index.html')
})

fastify.setErrorHandler((err, _req, reply) => {
  console.error(err)
  void reply.code(500).send({ error: 'Internal server error' })
})

async function main(): Promise<void> {
  await initDb()
  await fastify.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`File Logger → http://localhost:${PORT}`)
  await startWatcher({ logsDir: LOGS_DIR })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
