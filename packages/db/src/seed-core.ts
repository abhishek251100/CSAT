import { sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { accounts, agencies, networks } from './schema/index'
// Type-only: parameterises SeedDb so any Postgres-dialect client is accepted.
import type * as schema from './schema/index'
import { parseFormId, SEED_ACCOUNTS, SEED_AGENCY, SEED_NETWORK } from './seed-data'

/**
 * Seeds the org hierarchy from SPEC.md §13.
 *
 * Takes a Drizzle instance rather than building one, so the same code path runs
 * against Neon from the CLI and against in-process Postgres from the test
 * suite. That is what lets idempotency be proven rather than asserted.
 *
 * Every insert upserts on its natural key (slug, scoped to its parent), so
 * re-running refreshes names without duplicating rows or churning ids.
 */

/** Accepts any Postgres-dialect Drizzle client — Neon HTTP, PGlite, node-pg. */
export type SeedDb = PgDatabase<PgQueryResultHKT, typeof schema>

export interface SeedSummary {
  readonly networkName: string
  readonly agencyName: string
  readonly accountCount: number
  readonly withFormId: number
  readonly sheetBacked: number
  /** Accounts whose link yields neither a form id nor a sheet id. */
  readonly unresolved: readonly string[]
}

export async function seedOrg(db: SeedDb): Promise<SeedSummary> {
  const [network] = await db
    .insert(networks)
    .values({ name: SEED_NETWORK.name, slug: SEED_NETWORK.slug })
    .onConflictDoUpdate({ target: networks.slug, set: { name: sql`excluded.name` } })
    .returning()

  if (!network) throw new Error('Failed to upsert the network row')

  const [agency] = await db
    .insert(agencies)
    .values({ networkId: network.id, name: SEED_AGENCY.name, slug: SEED_AGENCY.slug })
    .onConflictDoUpdate({
      target: [agencies.networkId, agencies.slug],
      set: { name: sql`excluded.name` },
    })
    .returning()

  if (!agency) throw new Error('Failed to upsert the agency row')

  const seeded = await db
    .insert(accounts)
    .values(
      SEED_ACCOUNTS.map((account) => ({
        agencyId: agency.id,
        name: account.name,
        slug: account.slug,
        externalFormUrl: account.externalFormUrl,
        externalSheetId: account.externalSheetId,
        // Derived from the url rather than listed, so the id can never disagree
        // with the link it came from. Null for every /d/e/ and forms.gle link.
        externalFormId: parseFormId(account.externalFormUrl),
        // csat_cadence, nps_cadence and status fall to their column defaults
        // (monthly / quarterly / active per §4.3), keeping those rules in one place.
      })),
    )
    .onConflictDoUpdate({
      target: [accounts.agencyId, accounts.slug],
      set: {
        name: sql`excluded.name`,
        /**
         * COALESCE keeps an existing value and fills only what is null, so a
         * first run populates every link while a later run never destroys a
         * correction made by hand during sync setup (§7.1). To force the seed's
         * value back in, null the column first.
         */
        externalFormUrl: sql`coalesce(${accounts.externalFormUrl}, excluded.external_form_url)`,
        externalSheetId: sql`coalesce(${accounts.externalSheetId}, excluded.external_sheet_id)`,
        externalFormId: sql`coalesce(${accounts.externalFormId}, excluded.external_form_id)`,
      },
    })
    .returning()

  return {
    networkName: network.name,
    agencyName: agency.name,
    accountCount: seeded.length,
    withFormId: seeded.filter((account) => account.externalFormId !== null).length,
    sheetBacked: seeded.filter((account) => account.externalSheetId !== null).length,
    unresolved: seeded
      .filter((account) => account.externalFormId === null && account.externalSheetId === null)
      .map((account) => account.name),
  }
}
