import fastifyStatic from '@fastify/static'
import fastifyView from '@fastify/view'
import ejs from 'ejs'
import Fastify from 'fastify'
import path from 'path'

import { sql } from './db/index.js'
import { initDb } from './db/schema.js'
import { registerApiRoutes } from './routes/index.js'
import { startWatcher } from './watcher.js'

const LOGS_DIR = process.env.LOGS_DIR || path.join(process.cwd(), 'logs')
const PORT = parseInt(process.env.PORT || '3000', 10)

// Views and public assets live in src/ (works for both tsx dev and compiled prod)
const SRC_DIR = path.join(__dirname, '..', 'src')
const VIEWS_DIR = path.join(SRC_DIR, 'views')
const PUBLIC_DIR = path.join(SRC_DIR, 'public')

const fastify = Fastify({ logger: false })

fastify.register(fastifyView, {
  engine: { ejs },
  root: VIEWS_DIR,
  layout: undefined,
})

fastify.register(fastifyStatic, {
  root: PUBLIC_DIR,
  prefix: '/public/',
})

fastify.register(registerApiRoutes, { logsDir: LOGS_DIR })

fastify.get<{ Querystring: { file?: string } }>('/', async (request, reply) => {
  const selectedFile = request.query.file || ''
  let files: string[] = []
  try {
    const rows = await sql<{ log_file: string }[]>`
      SELECT DISTINCT log_file FROM logs ORDER BY log_file
    `
    files = rows.map((r) => r.log_file)
  } catch {
    /* DB not ready yet */
  }

  return reply.view('index.ejs', {
    files,
    selectedFile,
    dbReady: files.length > 0,
  })
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
