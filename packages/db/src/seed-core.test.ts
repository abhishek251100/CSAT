import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { fileURLToPath, URL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import * as schema from './schema/index'
import { seedOrg } from './seed-core'

/**
 * Runs the real seed against real Postgres, twice, to prove the idempotency
 * §13 and §7.1 depend on — rather than asserting it from reading the SQL.
 */

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

let db: ReturnType<typeof drizzle<typeof schema>>

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema })
  await migrate(db, { migrationsFolder })
}, 60_000)

describe('seedOrg', () => {
  it('seeds the network, agency and 16 accounts on a clean database', async () => {
    const summary = await seedOrg(db)

    expect(summary.networkName).toBe('Zoo Media')
    expect(summary.agencyName).toBe('The Starter Labs')
    expect(summary.accountCount).toBe(16)

    // Asserted here rather than in a later test because the counts below only
    // hold on a clean database — a later test deliberately resolves a link by
    // hand, which legitimately changes them.
    expect(summary.withFormId).toBe(3)
    expect(summary.sheetBacked).toBe(1)
    // 16 accounts - 3 resolvable /edit links - 1 Sheet-backed (EPCH) = 12.
    expect(summary.unresolved).toHaveLength(12)
    expect(summary.unresolved).toContain('Standard Chartered')
    expect(summary.unresolved).not.toContain('EPCH')
    expect(summary.unresolved).not.toContain('Mogu Mogu')
  })

  it('resolves a form id for exactly the three /edit links', () => {
    // Mogu Mogu, Chemistry, Inkspired. Every /d/e/ and forms.gle link stays null.
    expect.assertions(1)
    return db
      .select()
      .from(schema.accounts)
      .then((rows) => {
        const resolved = rows.filter((row) => row.externalFormId !== null)
        expect(resolved.map((row) => row.name).sort()).toEqual([
          'Chemistry',
          'Inkspired',
          'Mogu Mogu',
        ])
      })
  })

  it('stores EPCH as Sheet-backed with both form columns null', async () => {
    const [epch] = await db.select().from(schema.accounts).where(eq(schema.accounts.slug, 'epch'))

    expect(epch!.externalSheetId).toBe('1m530xf7zHvKt9RIGBoHlaOKUfjNOxIugIdmHaxYpTaQ')
    expect(epch!.externalFormUrl).toBeNull()
    expect(epch!.externalFormId).toBeNull()
  })

  it('gives every account the account_status default of active', async () => {
    const rows = await db.select().from(schema.accounts)

    expect(rows.every((row) => row.status === 'active')).toBe(true)
  })

  it('applies the cadence defaults from §4.3', async () => {
    const rows = await db.select().from(schema.accounts)

    expect(rows.every((row) => row.csatCadence === 'monthly')).toBe(true)
    expect(rows.every((row) => row.npsCadence === 'quarterly')).toBe(true)
  })

  it('is idempotent: a second run duplicates nothing and churns no ids', async () => {
    const before = await db.select().from(schema.accounts)

    const summary = await seedOrg(db)

    const after = await db.select().from(schema.accounts)

    expect(summary.accountCount).toBe(16)
    expect(after).toHaveLength(16)
    // Ids are stable, so anything referencing an account survives a re-seed.
    expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort())

    const networkRows = await db.select().from(schema.networks)
    const agencyRows = await db.select().from(schema.agencies)
    expect(networkRows).toHaveLength(1)
    expect(agencyRows).toHaveLength(1)
  })

  it('never overwrites an external reference corrected by hand', async () => {
    // Simulates sync setup resolving a forms.gle short link to a real form id.
    await db
      .update(schema.accounts)
      .set({ externalFormId: 'resolved-by-hand-during-sync-setup' })
      .where(eq(schema.accounts.slug, 'sunteck'))

    await seedOrg(db)

    const [sunteck] = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.slug, 'sunteck'))

    expect(sunteck!.externalFormId).toBe('resolved-by-hand-during-sync-setup')
  })

  it('still fills a reference that is null, so new links land on re-seed', async () => {
    await db
      .update(schema.accounts)
      .set({ externalFormId: null })
      .where(eq(schema.accounts.slug, 'mogu-mogu'))

    await seedOrg(db)

    const [mogu] = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.slug, 'mogu-mogu'))

    expect(mogu!.externalFormId).toBe('1eWYEfHa-Eib8iUXT-2XmIkPAXkpMmrzu6PhCcIBVzcQ')
  })

  it('drops an account from the unresolved list once its link is resolved', async () => {
    // Sunteck was given a form id by hand in the test above, so the seed should
    // now stop reporting it as needing sync setup.
    const summary = await seedOrg(db)

    expect(summary.unresolved).not.toContain('Sunteck')
    expect(summary.unresolved).toContain('Standard Chartered')
  })
})
