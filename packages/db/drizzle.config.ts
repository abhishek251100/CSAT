import { defineConfig } from 'drizzle-kit'
import { loadRootEnv } from './src/load-env'

/**
 * Drizzle Kit is the only path to DDL (SPEC.md §12).
 *
 * Reads DATABASE_URL straight from the environment rather than through the
 * Zod-validated loader in apps/api, because Drizzle Kit is a CLI running
 * outside the server process. The repo-root .env is loaded here so
 * `pnpm db:generate` works with no extra ceremony; a real shell env still wins.
 */
loadRootEnv(import.meta.url)

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Drizzle Kit cannot run without it. ' +
      'Copy .env.example to .env at the repo root and export DATABASE_URL.',
  )
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
})
