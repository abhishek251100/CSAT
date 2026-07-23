import { createDb, loadRootEnv } from '@zoo/db'
import { parseDatabaseEnv } from './env'
import { recomputeCurrentAndPrevious } from './rollups/recompute'

/**
 * Scheduled rollup recomputation — the cron stub for SPEC.md §4.3.
 *
 * Run with: pnpm --filter @zoo/api rollups:cron
 *
 * Recomputes the current and previous period at both grains across every live
 * account. Safe to run at any frequency: recomputation is idempotent, deriving
 * every value from the responses currently in the window rather than adjusting
 * a running total.
 *
 * How this gets triggered in a deployed environment is still open — §16 #6
 * decides between Vercel Cron, Workers Cron Triggers, and a GitHub Action
 * hitting an authenticated endpoint. Whichever it is calls
 * `recomputeCurrentAndPrevious`; only the trigger changes.
 */

loadRootEnv(import.meta.url)

async function main() {
  const env = parseDatabaseEnv(process.env)
  const db = createDb(env.DATABASE_URL)

  const startedAt = Date.now()
  const summary = await recomputeCurrentAndPrevious(db)

  console.log(
    `[rollups] ${summary.scopesRecomputed} scopes x ${summary.periodsRecomputed} periods ` +
      `= ${summary.rowsUpserted} rows in ${Date.now() - startedAt}ms`,
  )
}

// exitCode rather than process.exit(), so the Neon driver's handles can drain.
main().catch((error: unknown) => {
  console.error('[rollups] failed:', error)
  process.exitCode = 1
})
