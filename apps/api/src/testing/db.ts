import { PGlite } from '@electric-sql/pglite'
import type { AppDb } from '@zoo/db'
import * as schema from '@zoo/db/schema'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { fileURLToPath, URL } from 'node:url'

/**
 * An in-process Postgres with the real migrations applied.
 *
 * Uses the actual drizzle/*.sql files rather than a hand-built schema, so a
 * migration that would fail against Neon fails here first. Needs no connection
 * string, so RBAC enforcement is proven in CI.
 */
export async function createTestDb(): Promise<AppDb> {
  const db = drizzle(new PGlite(), { schema })

  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../../../packages/db/drizzle', import.meta.url)),
  })

  return db
}
