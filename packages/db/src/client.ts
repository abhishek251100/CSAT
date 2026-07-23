import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema/index'

/**
 * Builds a Drizzle client over the Neon serverless HTTP driver.
 *
 * The connection string is passed in rather than read from `process.env` here:
 * this package must stay runtime-agnostic so the same client works under Node,
 * Vercel functions, and Workers (where env arrives as bindings, not
 * `process.env`). Callers own env loading and validation.
 *
 * neon-http issues one HTTP request per query — the right default for
 * serverless. If a future milestone needs interactive transactions (multi-
 * statement atomicity), swap to `drizzle-orm/neon-serverless` over the WebSocket
 * Pool driver. The rollup job in Milestone 4 is the first likely candidate.
 */
export function createDb(connectionString: string) {
  const sql = neon(connectionString)
  return drizzle({ client: sql, schema })
}

/** The concrete production client, over Neon HTTP. */
export type Db = ReturnType<typeof createDb>

/**
 * Any Postgres-dialect Drizzle client over this schema.
 *
 * Application code should depend on this rather than on `Db`: it keeps the API
 * driver-agnostic (which the still-open hosting decision §16 #6 benefits from),
 * and lets tests inject in-process Postgres without a cast. `Db` and a PGlite
 * client are both assignable to it.
 */
export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>
