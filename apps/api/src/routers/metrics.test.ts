import type { AppDb } from '@zoo/db'
import {
  accounts,
  agencies,
  memberships,
  networks,
  surveyResponses,
  surveys,
  users,
} from '@zoo/db/schema'
import type { RoleKey, ScopeType } from '@zoo/shared'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolveVisibleAccounts } from '../auth/scope'
import type { ApiContext, AuthenticatedSession } from '../context'
import { recomputeRollups } from '../rollups/recompute'
import { createTestDb } from '../testing/db'
import { testServerEnv } from '../testing/fixtures'
import { createCallerFactory } from '../trpc'
import { appRouter } from './_app'
import { monthlyPeriodFor } from '@zoo/shared'

/**
 * View 1's data layer — SPEC.md §8, §9, §12.
 *
 * Fixture, deliberately shaped so a mean-of-percentages answer differs
 * visibly from a response-weighted one:
 *
 *   Zoo Media
 *     The Starter Labs
 *       Mogu Mogu   Jun: 90 x CSAT 5           -> 100.0 %
 *                   Jul: 10 x CSAT 1           ->   0.0 %
 *                   Jul: NPS 10,10,9,8,0       ->  60.0
 *       Chemistry   Jul: CSAT 5,5,4,3          ->  75.0 %
 *     Sibling Agency
 *       Inkspired   Jul: CSAT 1,1              ->   0.0 %
 *
 *   Mogu across Jun+Jul = 90 satisfied of 100 = 90.0
 *   Mean of the two monthly percentages would be 50.0.
 */

const env = testServerEnv()
const JUNE = new Date('2026-06-15T12:00:00.000Z')
const JULY = new Date('2026-07-15T12:00:00.000Z')

let db: AppDb
const ids = {
  network: '',
  agencyTsl: '',
  agencySibling: '',
  mogu: '',
  chemistry: '',
  inkspired: '',
}
const userIds: Record<string, string> = {}

async function callerFor(userKey: string) {
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

  const ctx: ApiContext = { env, db, requestId: `test-${userKey}`, session }

  return createCallerFactory(appRouter)(ctx)
}

async function seedUser(key: string, role: RoleKey, scopeType: ScopeType, scopeId: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `${key}@thestarterlabs.com`, name: key })
    .returning()
  userIds[key] = user!.id
  await db.insert(memberships).values({ userId: user!.id, scopeType, scopeId, role })
}

async function seedResponses(
  accountId: string,
  type: 'csat' | 'nps',
  scores: number[],
  submittedAt: Date,
) {
  const [survey] = await db
    .insert(surveys)
    .values({
      accountId,
      type,
      title: 'fixture',
      source: 'import',
      cadence: type === 'csat' ? 'monthly' : 'quarterly',
    })
    .returning()

  for (const score of scores) {
    await db
      .insert(surveyResponses)
      .values({ surveyId: survey!.id, accountId, type, score, source: 'import', submittedAt })
  }
}

beforeAll(async () => {
  db = await createTestDb()

  const [network] = await db.insert(networks).values({ name: 'Zoo', slug: 'zoo' }).returning()
  ids.network = network!.id

  const [tsl] = await db
    .insert(agencies)
    .values({ networkId: network!.id, name: 'TSL', slug: 'tsl' })
    .returning()
  const [sibling] = await db
    .insert(agencies)
    .values({ networkId: network!.id, name: 'Sibling', slug: 'sibling' })
    .returning()
  ids.agencyTsl = tsl!.id
  ids.agencySibling = sibling!.id

  const account = async (agencyId: string, name: string, slug: string) => {
    const [row] = await db.insert(accounts).values({ agencyId, name, slug }).returning()
    return row!.id
  }

  ids.mogu = await account(tsl!.id, 'Mogu Mogu', 'mogu-mogu')
  ids.chemistry = await account(tsl!.id, 'Chemistry', 'chemistry')
  ids.inkspired = await account(sibling!.id, 'Inkspired', 'inkspired')

  await seedResponses(ids.mogu, 'csat', Array<number>(90).fill(5), JUNE)
  await seedResponses(ids.mogu, 'csat', Array<number>(10).fill(1), JULY)
  await seedResponses(ids.mogu, 'nps', [10, 10, 9, 8, 0], JULY)
  await seedResponses(ids.chemistry, 'csat', [5, 5, 4, 3], JULY)
  await seedResponses(ids.inkspired, 'csat', [1, 1], JULY)

  await recomputeRollups(db, {
    accountIds: [ids.mogu, ids.chemistry, ids.inkspired],
    periods: [monthlyPeriodFor(JUNE), monthlyPeriodFor(JULY)],
  })

  await seedUser('networkAdmin', 'network_admin', 'network', ids.network)
  await seedUser('agencyAdmin', 'agency_admin', 'agency', ids.agencyTsl)
  await seedUser('manager', 'account_manager', 'account', ids.mogu)
}, 60_000)

const july = { grain: 'monthly' as const, from: '2026-07-01', to: '2026-07-31' }
const juneToJuly = { grain: 'monthly' as const, from: '2026-06-01', to: '2026-07-31' }

describe('getScorecard reads rollups, not raw responses (§12)', () => {
  it('reports the rollup path for a monthly request', async () => {
    const caller = await callerFor('manager')
    const result = await caller.metrics.getScorecard({
      scopeType: 'account',
      scopeId: ids.mogu,
      ...july,
    })

    expect(result.source).toBe('rollups')
  })

  it('falls back to a live scan only for a custom range (§8)', async () => {
    const caller = await callerFor('manager')
    const result = await caller.metrics.getScorecard({
      scopeType: 'account',
      scopeId: ids.mogu,
      grain: 'custom',
      from: '2026-07-10',
      to: '2026-07-20',
    })

    expect(result.source).toBe('live')
    // 10 CSAT 1s and 5 NPS all landed on 15 July.
    expect(result.current.csatPercent).toBe(0)
    expect(result.current.npsResponseCount).toBe(5)
  })
})

describe('a multi-period window pools rather than averaging', () => {
  it('gives the response-weighted figure across two months', async () => {
    // Jun 100.0 and Jul 0.0. Mean would be 50.0; pooled is 90/100 = 90.0.
    const caller = await callerFor('manager')
    const result = await caller.metrics.getScorecard({
      scopeType: 'account',
      scopeId: ids.mogu,
      ...juneToJuly,
    })

    expect(result.current.csatPercent).toBe(90)
    expect(result.current.csatPercent).not.toBe(50)
    expect(result.current.csatResponseCount).toBe(100)
  })

  it('still plots each period separately in the trend', async () => {
    const caller = await callerFor('manager')
    const result = await caller.metrics.getScorecard({
      scopeType: 'account',
      scopeId: ids.mogu,
      ...juneToJuly,
    })

    expect(result.trend.map((point) => point.csatPercent)).toEqual([100, 0])
    expect(result.trend.map((point) => point.label)).toEqual(['Jun 2026', 'Jul 2026'])
  })
})

describe('KPI figures for a single period', () => {
  it('computes CSAT %, DSAT and response counts', async () => {
    const caller = await callerFor('manager')
    const result = await caller.metrics.getScorecard({
      scopeType: 'account',
      scopeId: ids.mogu,
      ...july,
    })

    expect(result.current.csatPercent).toBe(0)
    expect(result.current.dsatCount).toBe(10)
    expect(result.current.dsatRate).toBe(1)
    expect(result.current.responseCount).toBe(15)
  })

  it('computes NPS and labels its band (§6)', async () => {
    // 10,10,9 promoters, 8 passive, 0 detractor of 5: 60 - 20 = 40.0 -> "good"
    const caller = await callerFor('manager')
    const result = await caller.metrics.getScorecard({
      scopeType: 'account',
      scopeId: ids.mogu,
      ...july,
    })

    expect(result.current.nps).toBe(40)
    expect(result.npsBand).toBe('good')
  })

  it('returns the 1-5 distribution for the histogram', async () => {
    // agencyAdmin, not manager: manager is scoped to Mogu Mogu alone.
    const caller = await callerFor('agencyAdmin')
    const result = await caller.metrics.getScorecard({
      scopeType: 'account',
      scopeId: ids.chemistry,
      ...july,
    })

    expect(result.current.distribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 1, 5: 2 })
  })

  it('returns promoters / passives / detractors for the stacked bar', async () => {
    const caller = await callerFor('manager')
    const result = await caller.metrics.getScorecard({
      scopeType: 'account',
      scopeId: ids.mogu,
      ...july,
    })

    expect(result.current.promoters).toBe(3)
    expect(result.current.passives).toBe(1)
    expect(result.current.detractors).toBe(1)
  })
})

describe('period-over-period delta (§9)', () => {
  it('compares against the preceding window of equal length', async () => {
    // July 0.0 against June 100.0 = -100.0
    const caller = await callerFor('manager')
    const result = await caller.metrics.getScorecard({
      scopeType: 'account',
      scopeId: ids.mogu,
      ...july,
    })

    expect(result.previous?.csatPercent).toBe(100)
    expect(result.deltas.csatPercent).toBe(-100)
  })

  it('reports no delta when the preceding window has no data at all', async () => {
    // Otherwise a first month of data reads as a collapse from a fictional 100%.
    const caller = await callerFor('manager')
    const result = await caller.metrics.getScorecard({
      scopeType: 'account',
      scopeId: ids.mogu,
      grain: 'monthly',
      from: '2026-06-01',
      to: '2026-06-30',
    })

    expect(result.previous).toBeNull()
    expect(result.deltas.csatPercent).toBeNull()
  })
})

describe('aggregate scopes pool their accounts (§6, decision #3)', () => {
  it('pools an agency over its accounts', async () => {
    // Mogu 10x1 + Chemistry 5,5,4,3 = 3 satisfied of 14 = 21.4
    const caller = await callerFor('agencyAdmin')
    const result = await caller.metrics.getScorecard({
      scopeType: 'agency',
      scopeId: ids.agencyTsl,
      ...july,
    })

    expect(result.current.csatPercent).toBe(21.4)
    expect(result.current.csatResponseCount).toBe(14)
  })

  it('pools the network over every agency', async () => {
    // + Inkspired 1,1 = 3 satisfied of 16 = 18.8
    const caller = await callerFor('networkAdmin')
    const result = await caller.metrics.getScorecard({
      scopeType: 'network',
      scopeId: ids.network,
      ...july,
    })

    expect(result.current.csatPercent).toBe(18.8)
    expect(result.current.csatResponseCount).toBe(16)
  })
})

describe('scope enforcement on aggregate tiers (§5.2, §5.3)', () => {
  it('refuses an agency scope to someone who sees only one of its accounts', async () => {
    // An agency figure pools every account in it; partial visibility must not
    // grant it, or the other accounts leak in aggregate form.
    const caller = await callerFor('manager')

    await expect(
      caller.metrics.getScorecard({ scopeType: 'agency', scopeId: ids.agencyTsl, ...july }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('refuses a sibling agency to an agency_admin', async () => {
    const caller = await callerFor('agencyAdmin')

    await expect(
      caller.metrics.getScorecard({ scopeType: 'agency', scopeId: ids.agencySibling, ...july }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('refuses the network scope to an agency_admin (§5.3)', async () => {
    const caller = await callerFor('agencyAdmin')

    await expect(
      caller.metrics.getScorecard({ scopeType: 'network', scopeId: ids.network, ...july }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('refuses an account outside scope', async () => {
    const caller = await callerFor('manager')

    await expect(
      caller.metrics.getScorecard({ scopeType: 'account', scopeId: ids.inkspired, ...july }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects an unauthenticated caller', async () => {
    const anonymous = createCallerFactory(appRouter)({
      env,
      db,
      requestId: 'anon',
      session: null,
    })

    await expect(
      anonymous.metrics.getScorecard({ scopeType: 'account', scopeId: ids.mogu, ...july }),
    ).rejects.toThrow(/Sign-in required/)
  })
})

describe('account leaderboard (§9)', () => {
  it('lists every account in the agency with its figures', async () => {
    const caller = await callerFor('agencyAdmin')
    const rows = await caller.metrics.getAccountLeaderboard({
      scopeType: 'agency',
      scopeId: ids.agencyTsl,
      ...july,
    })

    expect(rows.map((row) => row.name)).toEqual(['Chemistry', 'Mogu Mogu'])
    expect(rows.find((row) => row.name === 'Chemistry')?.csatPercent).toBe(75)
    expect(rows.find((row) => row.name === 'Mogu Mogu')?.csatPercent).toBe(0)
  })

  it('carries the NPS band for the label', async () => {
    const caller = await callerFor('networkAdmin')
    const rows = await caller.metrics.getAccountLeaderboard({
      scopeType: 'network',
      scopeId: ids.network,
      ...july,
    })

    expect(rows.find((row) => row.name === 'Mogu Mogu')?.npsBand).toBe('good')
  })

  it('reports null, not zero, for an account with no responses that period', async () => {
    const caller = await callerFor('networkAdmin')
    const rows = await caller.metrics.getAccountLeaderboard({
      scopeType: 'network',
      scopeId: ids.network,
      grain: 'monthly',
      from: '2026-05-01',
      to: '2026-05-31',
    })

    expect(rows.every((row) => row.csatPercent === null)).toBe(true)
    expect(rows.every((row) => row.responseCount === 0)).toBe(true)
  })

  it('is scoped: an account_manager sees only their own account', async () => {
    const caller = await callerFor('manager')
    const rows = await caller.metrics.getAccountLeaderboard({
      scopeType: 'account',
      scopeId: ids.mogu,
      ...july,
    })

    expect(rows.map((row) => row.name)).toEqual(['Mogu Mogu'])
  })
})

describe('empty and edge windows', () => {
  it('returns nulls for a period with no data', async () => {
    const caller = await callerFor('manager')
    const result = await caller.metrics.getScorecard({
      scopeType: 'account',
      scopeId: ids.mogu,
      grain: 'monthly',
      from: '2026-01-01',
      to: '2026-01-31',
    })

    expect(result.current.csatPercent).toBeNull()
    expect(result.current.nps).toBeNull()
    expect(result.npsBand).toBeNull()
    expect(result.current.responseCount).toBe(0)
  })

  it('returns an empty trend for an inverted range rather than erroring', async () => {
    const caller = await callerFor('manager')
    const result = await caller.metrics.getScorecard({
      scopeType: 'account',
      scopeId: ids.mogu,
      grain: 'monthly',
      from: '2026-07-01',
      to: '2026-01-01',
    })

    expect(result.trend).toEqual([])
    expect(result.current.responseCount).toBe(0)
  })
})
