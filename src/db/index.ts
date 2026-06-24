import postgres from 'postgres'

const url =
  process.env.DATABASE_URL ||
  `postgres://${process.env.POSTGRES_USER || 'logger'}:${process.env.POSTGRES_PASSWORD || 'logger'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'logger'}`

export const sql = postgres(url, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
})
