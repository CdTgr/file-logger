import fastifyStatic from '@fastify/static'
import fastifyView from '@fastify/view'
import ejs from 'ejs'
import Fastify from 'fastify'
import path from 'path'

import { configureDb, getDb } from './db/index.js'
import { registerApiRoutes } from './routes/index.js'
import { startWatcher } from './watcher.js'

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'logs.db')
const LOGS_DIR = process.env.LOGS_DIR || path.join(process.cwd(), 'logs')
const PORT = parseInt(process.env.PORT || '3000', 10)

// Views and public assets live in src/ (works for both tsx dev and compiled prod)
const SRC_DIR = path.join(__dirname, '..', 'src')
const VIEWS_DIR = path.join(SRC_DIR, 'views')
const PUBLIC_DIR = path.join(SRC_DIR, 'public')

configureDb(DB_PATH)

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

fastify.register(registerApiRoutes, { logsDir: LOGS_DIR, dbPath: DB_PATH })

fastify.get<{ Querystring: { file?: string } }>('/', async (request, reply) => {
  const selectedFile = request.query.file || ''
  let files: string[] = []
  const d = getDb()
  if (d) {
    files = (
      d
        .prepare('SELECT DISTINCT log_file FROM logs ORDER BY log_file')
        .all() as { log_file: string }[]
    ).map((r) => r.log_file)
  }

  return reply.view('index.ejs', { files, selectedFile, dbReady: !!d })
})

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(`File Logger → http://localhost:${PORT}`)
  startWatcher({ logsDir: LOGS_DIR, dbPath: DB_PATH })
})
