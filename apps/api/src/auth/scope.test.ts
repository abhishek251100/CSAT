import type { AppDb } from '@zoo/db'
import { accounts, agencies, memberships, networks, users } from '@zoo/db/schema'
import type { RoleKey } from '@zoo/shared'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ApiContext, AuthenticatedSession } from '../context'
import { appRouter } from '../routers/_app'
import { createTestDb } from '../testing/db'
import { testServerEnv } from '../testing/fixtures'
import { createCallerFactory } from '../trpc'
import { resolveVisibleAccounts } from './scope'

/**
 * End-to-end RBAC enforcement — SPEC.md §5.2, §5.3, §12.
 *
 * Exercises the whole chain against real Postgres: memberships table ->
 * resolveVisibleAccounts -> tRPC context -> scope middleware -> a scoped query.
 * The pure resolution rules are unit-tested in @zoo/shared; what is proven here
 * is that a procedure genuinely cannot return a row outside the resolved set.
 *
 * Fixture org:
 *   Zoo Media
 *     The Starter Labs   -> Mogu Mogu, Chemistry
 *     Sibling Agency     -> Inkspired
 *   Other Network
 *     Outside Agency     -> Outsider
 */

let db: AppDb
const env = testServerEnv()

const ids = {
  networkZoo: '',
  agencyTsl: '',
  agencySibling: '',
  mogu: '',
  chemistry: '',
  inkspired: '',
  outsider: '',
}

const userIds: Record<string, string> = {}

/** Builds the same context the HTTP layer builds, from the database. */
async function contextFor(userKey: string): Promise<ApiContext> {
  const userId = userIds[userKey]!
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  const scope = await resolveVisibleAccounts(db, userId)

  const session: AuthenticatedSession = {
    userId,
    email: user!.email,
    name: user!.name,
    roles: scope.roles,
    visibleAccountIds: scope.visibleAccountIds,
    canViewNetwork: scope.canViewNetwork,
  }

  return { env, db, requestId: `test-${userKey}`, session }
}

const callerFor = async (userKey: string) =>
  createCallerFactory(appRouter)(await contextFor(userKey))

const anonymousCaller = () =>
  createCallerFactory(appRouter)({ env, db, requestId: 'anon', session: null })

async function seedUser(
  key: string,
  email: string,
  grants: { scopeType: 'network' | 'agency' | 'account'; scopeId: string; role: RoleKey }[],
) {
  const [user] = await db.insert(users).values({ email, name: key }).returning()
  userIds[key] = user!.id

  for (const grant of grants) {
    await db.insert(memberships).values({ userId: user!.id, ...grant })
  }
}

beforeAll(async () => {
  db = await createTestDb()

  const [zoo] = await db.insert(networks).values({ name: 'Zoo Media', slug: 'zoo' }).returning()
  const [other] = await db.insert(networks).values({ name: 'Other', slug: 'other' }).returning()
  ids.networkZoo = zoo!.id

  const [tsl] = await db
    .insert(agencies)
    .values({ networkId: zoo!.id, name: 'The Starter Labs', slug: 'tsl' })
    .returning()
  const [sibling] = await db
    .insert(agencies)
    .values({ networkId: zoo!.id, name: 'Sibling Agency', slug: 'sibling' })
    .returning()
  const [outside] = await db
    .insert(agencies)
    .values({ networkId: other!.id, name: 'Outside Agency', slug: 'outside' })
    .returning()
  ids.agencyTsl = tsl!.id
  ids.agencySibling = sibling!.id

  const insertAccount = async (agencyId: string, name: string, slug: string) => {
    const [row] = await db.insert(accounts).values({ agencyId, name, slug }).returning()
    return row!.id
  }

  ids.mogu = await insertAccount(tsl!.id, 'Mogu Mogu', 'mogu-mogu')
  ids.chemistry = await insertAccount(tsl!.id, 'Chemistry', 'chemistry')
  ids.inkspired = await insertAccount(sibling!.id, 'Inkspired', 'inkspired')
  ids.outsider = await insertAccount(outside!.id, 'Outsider', 'outsider')

  await seedUser('superAdmin', 'super@thestarterlabs.com', [
    { scopeType: 'network', scopeId: zoo!.id, role: 'super_admin' },
  ])
  await seedUser('networkAdmin', 'network@thestarterlabs.com', [
    { scopeType: 'network', scopeId: zoo!.id, role: 'network_admin' },
  ])
  await seedUser('agencyAdmin', 'agency@thestarterlabs.com', [
    { scopeType: 'agency', scopeId: tsl!.id, role: 'agency_admin' },
  ])
  await seedUser('siblingAdmin', 'sibling@thestarterlabs.com', [
    { scopeType: 'agency', scopeId: sibling!.id, role: 'agency_admin' },
  ])
  await seedUser('manager', 'manager@thestarterlabs.com', [
    { scopeType: 'account', scopeId: ids.mogu, role: 'account_manager' },
  ])
  await seedUser('viewer', 'viewer@thestarterlabs.com', [
    { scopeType: 'account', scopeId: ids.mogu, role: 'viewer' },
  ])
  await seedUser('multi', 'multi@thestarterlabs.com', [
    { scopeType: 'agency', scopeId: sibling!.id, role: 'viewer' },
    { scopeType: 'account', scopeId: ids.mogu, role: 'account_manager' },
  ])
  await seedUser('orphan', 'orphan@thestarterlabs.com', [])
}, 60_000)

describe('unauthenticated callers', () => {
  it('are rejected by auth.me', async () => {
    await expect(anonymousCaller().auth.me()).rejects.toThrow(/Sign-in required/)
  })

  it('are rejected by every scoped read', async () => {
    await expect(anonymousCaller().org.listAccounts()).rejects.toThrow(/Sign-in required/)
    await expect(anonymousCaller().org.getAccount({ accountId: ids.mogu })).rejects.toThrow(
      /Sign-in required/,
    )
  })

  it('cannot reach a scoped read even naming a real account id', async () => {
    // No session means no scope, regardless of what the client sends.
    await expect(
      anonymousCaller().org.listAccounts({ accountIds: [ids.mogu, ids.outsider] }),
    ).rejects.toThrow(/Sign-in required/)
  })
})

describe('network membership', () => {
  it('sees every account in its own network', async () => {
    const caller = await callerFor('networkAdmin')
    const visible = (await caller.org.listAccounts()).map((account) => account.name)

    expect(visible).toEqual(['Chemistry', 'Inkspired', 'Mogu Mogu'])
  })

  it('does not see an account in a different network', async () => {
    const caller = await callerFor('networkAdmin')
    const visible = (await caller.org.listAccounts()).map((account) => account.name)

    expect(visible).not.toContain('Outsider')
    await expect(caller.org.getAccount({ accountId: ids.outsider })).rejects.toThrow(
      /Account not found/,
    )
  })

  it('is granted the network-level view (§5.3)', async () => {
    const caller = await callerFor('networkAdmin')

    expect((await caller.auth.me()).canViewNetwork).toBe(true)
  })
})

describe('agency membership — the isolation §5.3 depends on', () => {
  it('sees only its own agency’s accounts', async () => {
    const caller = await callerFor('agencyAdmin')
    const visible = (await caller.org.listAccounts()).map((account) => account.name)

    expect(visible).toEqual(['Chemistry', 'Mogu Mogu'])
  })

  it('CANNOT see a sibling agency’s account in the same network', async () => {
    // The core requirement: agency_admin of TSL must not reach Inkspired.
    const caller = await callerFor('agencyAdmin')
    const visible = (await caller.org.listAccounts()).map((account) => account.name)

    expect(visible).not.toContain('Inkspired')
  })

  it('CANNOT fetch a sibling agency’s account directly by id', async () => {
    const caller = await callerFor('agencyAdmin')

    await expect(caller.org.getAccount({ accountId: ids.inkspired })).rejects.toThrow(
      /Account not found/,
    )
  })

  it('reports not-found rather than forbidden, leaking no existence', async () => {
    // FORBIDDEN would confirm Inkspired exists to someone outside its agency.
    const caller = await callerFor('agencyAdmin')

    await expect(caller.org.getAccount({ accountId: ids.inkspired })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('is denied the network-level view (§5.3)', async () => {
    const caller = await callerFor('agencyAdmin')

    expect((await caller.auth.me()).canViewNetwork).toBe(false)
  })

  it('isolates in both directions', async () => {
    const caller = await callerFor('siblingAdmin')
    const visible = (await caller.org.listAccounts()).map((account) => account.name)

    expect(visible).toEqual(['Inkspired'])
  })
})

describe('account membership', () => {
  it('sees only the granted account', async () => {
    const caller = await callerFor('manager')

    expect((await caller.org.listAccounts()).map((account) => account.name)).toEqual(['Mogu Mogu'])
  })

  it('does not widen to the rest of its agency', async () => {
    const caller = await callerFor('manager')

    await expect(caller.org.getAccount({ accountId: ids.chemistry })).rejects.toThrow(
      /Account not found/,
    )
  })

  it('unions grants across tiers without leaking beyond them', async () => {
    const caller = await callerFor('multi')
    const visible = (await caller.org.listAccounts()).map((account) => account.name)

    expect(visible).toEqual(['Inkspired', 'Mogu Mogu'])
    expect(visible).not.toContain('Chemistry')
  })
})

describe('client-sent scope is never trusted (§12)', () => {
  it('intersects a requested filter with the resolved scope', async () => {
    const caller = await callerFor('agencyAdmin')

    // Asking for an out-of-scope account narrows the result; it never widens it.
    const visible = await caller.org.listAccounts({
      accountIds: [ids.mogu, ids.inkspired, ids.outsider],
    })

    expect(visible.map((account) => account.name)).toEqual(['Mogu Mogu'])
  })

  it('returns nothing when every requested id is out of scope', async () => {
    const caller = await callerFor('manager')

    expect(await caller.org.listAccounts({ accountIds: [ids.inkspired, ids.outsider] })).toEqual([])
  })

  it('treats an omitted filter as "everything I can see", not "everything"', async () => {
    const caller = await callerFor('manager')

    expect(await caller.org.listAccounts()).toHaveLength(1)
  })
})

describe('a user with no memberships', () => {
  it('authenticates but resolves to an empty scope', async () => {
    const caller = await callerFor('orphan')
    const me = await caller.auth.me()

    expect(me.email).toBe('orphan@thestarterlabs.com')
    expect(me.visibleAccountIds).toEqual([])
    expect(me.roles).toEqual([])
  })

  it('sees no accounts at all', async () => {
    // Admission is not authority: passing the domain check grants a session,
    // membership grants visibility. Closed by default (§5.2).
    const caller = await callerFor('orphan')

    expect(await caller.org.listAccounts()).toEqual([])
    await expect(caller.org.getAccount({ accountId: ids.mogu })).rejects.toThrow(
      /Account not found/,
    )
  })
})

describe('soft-deleted accounts (§4.1)', () => {
  it('drop out of the resolved scope', async () => {
    const [retired] = await db
      .insert(accounts)
      .values({ agencyId: ids.agencyTsl, name: 'Retired Brand', slug: 'retired-brand' })
      .returning()

    const before = await resolveVisibleAccounts(db, userIds.agencyAdmin!)
    expect(before.visibleAccountIds).toContain(retired!.id)

    await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, retired!.id))

    const after = await resolveVisibleAccounts(db, userIds.agencyAdmin!)
    expect(after.visibleAccountIds).not.toContain(retired!.id)
  })
})

describe('capabilities reported to the client (§5.3)', () => {
  it('gives an agency_admin management capabilities', async () => {
    const me = await (await callerFor('agencyAdmin')).auth.me()

    expect(me.capabilities).toContain('manage_accounts')
    expect(me.capabilities).toContain('trigger_sync')
    expect(me.capabilities).not.toContain('platform_config')
  })

  it('gives a viewer read-only capabilities', async () => {
    const me = await (await callerFor('viewer')).auth.me()

    expect(me.capabilities).toEqual(['view_metrics'])
  })

  it('gives super_admin platform config', async () => {
    const me = await (await callerFor('superAdmin')).auth.me()

    expect(me.capabilities).toContain('platform_config')
  })
})
