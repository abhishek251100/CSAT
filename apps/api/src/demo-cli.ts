import { createDb, loadRootEnv } from '@zoo/db'
import { demoRowCounts, demoSummary, purgeDemo, realAccountCount, seedDemo } from './demo/demo-data'
import { parseDatabaseEnv } from './env'
import { recomputeRollups } from './rollups/recompute'

/**
 * Demo data CLI — SPEC.md §14.
 *
 *   pnpm --filter @zoo/api demo:seed    populate synthetic responses
 *   pnpm --filter @zoo/api demo:purge   remove them, leaving real data intact
 *
 * Both refuse to run when NODE_ENV=production. Demo numbers must never appear in
 * a production database, so the guard is a hard stop, not a warning.
 *
 * After changing rows, each recomputes only the affected accounts and periods —
 * the same scoped recompute the on-write path uses, never a full rebuild.
 */

loadRootEnv(import.meta.url)

function assertNotProduction(env: { NODE_ENV: string }) {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to run demo commands with NODE_ENV=production. Demo data must never ' +
        'enter a production database.',
    )
  }
}

async function main() {
  const command = process.argv[2]
  const env = parseDatabaseEnv(process.env)
  assertNotProduction(env)

  const db = createDb(env.DATABASE_URL)
  // Fixed clock so a seeded window is reproducible run to run.
  const now = new Date()

  if (command === 'seed') {
    const scope = await seedDemo(db, now)
    const recompute = await recomputeRollups(db, scope)
    const summary = await demoSummary(db)

    console.log('[demo] seeded. Counts per entity:')
    console.log(`         demo agencies:   ${summary.perEntity.demoAgencies}`)
    console.log(`         demo accounts:   ${summary.perEntity.demoAccounts}`)
    console.log(`         surveys:         ${summary.perEntity.surveys}`)
    console.log(`         questions:       ${summary.perEntity.questions}`)
    console.log(`         responses:       ${summary.perEntity.responses}`)
    console.log(`         answers:         ${summary.perEntity.answers}`)
    console.log(`         escalations:     ${summary.perEntity.escalations}`)
    console.log(`         rcas:            ${summary.perEntity.rcas}`)
    console.log(`         action items:    ${summary.perEntity.actionItems}`)
    console.log('[demo] per agency (demo responses):')
    for (const agency of summary.perAgency) {
      console.log(
        `         ${agency.name.padEnd(20)} ${agency.isDemo ? '[demo]' : '[real]'} ` +
          `accounts=${agency.accounts} responses=${agency.responses}`,
      )
    }
    console.log(
      `[demo] recomputed ${recompute.scopesRecomputed} scopes x ${recompute.periodsRecomputed} periods`,
    )
    console.log(`[demo] real responses left untouched: ${(await demoRowCounts(db)).real}`)
    return
  }

  if (command === 'purge') {
    const before = await demoRowCounts(db)
    const scope = await purgeDemo(db)
    const summary = await recomputeRollups(db, scope)
    const after = await demoRowCounts(db)

    console.log(
      `[demo] purged ${before.demo} demo responses across ${scope.accountIds.length} accounts`,
    )
    console.log(
      `[demo] recomputed ${summary.scopesRecomputed} scopes x ${summary.periodsRecomputed} periods`,
    )
    console.log(`[demo] real responses preserved: ${after.real}`)
    console.log(`[demo] real accounts untouched: ${await realAccountCount(db)}`)
    return
  }

  throw new Error(`Unknown demo command "${command ?? ''}". Use "seed" or "purge".`)
}

// exitCode, not process.exit(), so the Neon driver's handles can drain.
main().catch((error: unknown) => {
  console.error('[demo] failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
