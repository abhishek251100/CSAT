import { createDb } from './client'
import { loadRootEnv } from './load-env'
import { seedOrg } from './seed-core'

/**
 * CLI wrapper around `seedOrg` (SPEC.md §13).
 *
 * This file owns only env loading, connection and reporting; the seeding logic
 * lives in seed-core.ts so it can be exercised against a real Postgres in the
 * test suite. Safe to run repeatedly — see seed-core for the upsert semantics.
 *
 * Run with: pnpm --filter @zoo/db db:seed
 */

const envPath = loadRootEnv(import.meta.url)

async function main() {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set.\n' +
        (envPath === null
          ? 'No .env was found in any parent directory. Copy .env.example to .env at the repo root.'
          : `Loaded ${envPath}, but it does not define DATABASE_URL.`),
    )
  }

  const summary = await seedOrg(createDb(databaseUrl))

  console.log(`[seed] network:  ${summary.networkName}`)
  console.log(`[seed] agencies: ${summary.agencyNames.join(', ')}`)
  console.log(`[seed] accounts: ${summary.accountCount} upserted`)
  console.log(`[seed]           ${summary.withFormId} with a resolved external_form_id`)
  console.log(`[seed]           ${summary.sheetBacked} Sheet-backed`)

  if (summary.unresolved.length > 0) {
    console.warn(
      `\n[seed] ${summary.unresolved.length} accounts have a form url but no resolvable form id:` +
        `\n[seed]   ${summary.unresolved.join(', ')}` +
        '\n[seed] Their links are /d/e/ response urls or forms.gle short links, from which the' +
        '\n[seed] form id cannot be derived without calling Google. Resolve during sync setup' +
        '\n[seed] before Milestone 8.',
    )
  }
}

/**
 * Sets exitCode rather than calling process.exit(). A hard exit tears the
 * process down while the Neon driver's HTTP handles are still closing, which
 * trips a libuv assertion on Windows and returns a failure status for a seed
 * that actually succeeded. Setting the code lets Node drain and exit cleanly.
 */
main().catch((error: unknown) => {
  console.error('[seed] failed:', error)
  process.exitCode = 1
})
