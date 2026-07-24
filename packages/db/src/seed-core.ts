import { sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { accounts, agencies, networks } from './schema/index'
import type * as schema from './schema/index'
import {
  parseFormId,
  SEED_ACCOUNTS,
  SEED_AGENCY,
  SEED_AGENCY_FOXY,
  SEED_FOXY_ACCOUNTS,
  SEED_NETWORK,
  type SeedAccount,
} from './seed-data'

/**
 * Seeds the org hierarchy from SPEC.md §13 plus the Foxy agency.
 */

export type SeedDb = PgDatabase<PgQueryResultHKT, typeof schema>

export interface SeedSummary {
  readonly networkName: string
  readonly agencyNames: readonly string[]
  readonly accountCount: number
  readonly withFormId: number
  readonly sheetBacked: number
  readonly unresolved: readonly string[]
}

async function upsertAgency(
  db: SeedDb,
  networkId: string,
  agency: { name: string; slug: string },
) {
  const [row] = await db
    .insert(agencies)
    .values({ networkId, name: agency.name, slug: agency.slug })
    .onConflictDoUpdate({
      target: [agencies.networkId, agencies.slug],
      set: { name: sql`excluded.name` },
    })
    .returning()

  if (!row) throw new Error(`Failed to upsert agency ${agency.slug}`)
  return row
}

async function upsertAccounts(db: SeedDb, agencyId: string, list: readonly SeedAccount[]) {
  return db
    .insert(accounts)
    .values(
      list.map((account) => ({
        agencyId,
        name: account.name,
        slug: account.slug,
        externalFormUrl: account.externalFormUrl,
        externalSheetId: account.externalSheetId,
        externalFormId: parseFormId(account.externalFormUrl),
      })),
    )
    .onConflictDoUpdate({
      target: [accounts.agencyId, accounts.slug],
      set: {
        name: sql`excluded.name`,
        externalFormUrl: sql`coalesce(${accounts.externalFormUrl}, excluded.external_form_url)`,
        externalSheetId: sql`coalesce(${accounts.externalSheetId}, excluded.external_sheet_id)`,
        externalFormId: sql`coalesce(${accounts.externalFormId}, excluded.external_form_id)`,
      },
    })
    .returning()
}

export async function seedOrg(db: SeedDb): Promise<SeedSummary> {
  const [network] = await db
    .insert(networks)
    .values({ name: SEED_NETWORK.name, slug: SEED_NETWORK.slug })
    .onConflictDoUpdate({ target: networks.slug, set: { name: sql`excluded.name` } })
    .returning()

  if (!network) throw new Error('Failed to upsert the network row')

  const tsl = await upsertAgency(db, network.id, SEED_AGENCY)
  const foxy = await upsertAgency(db, network.id, SEED_AGENCY_FOXY)

  const tslAccounts = await upsertAccounts(db, tsl.id, SEED_ACCOUNTS)
  const foxyAccounts = await upsertAccounts(db, foxy.id, SEED_FOXY_ACCOUNTS)
  const seeded = [...tslAccounts, ...foxyAccounts]

  return {
    networkName: network.name,
    agencyNames: [tsl.name, foxy.name],
    accountCount: seeded.length,
    withFormId: seeded.filter((account) => account.externalFormId !== null).length,
    sheetBacked: seeded.filter((account) => account.externalSheetId !== null).length,
    unresolved: seeded
      .filter((account) => account.externalFormId === null && account.externalSheetId === null)
      .map((account) => account.name),
  }
}
