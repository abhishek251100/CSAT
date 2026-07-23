import type { AppDb } from '@zoo/db'
import {
  accounts,
  agencies,
  memberships,
  metricRollups,
  networks,
  responseAnswers,
  surveyResponses,
  users,
} from '@zoo/db/schema'
import type { RoleKey } from '@zoo/shared'
import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolveVisibleAccounts } from '../auth/scope'
import type { ApiContext, AuthenticatedSession } from '../context'
import { createTestDb } from '../testing/db'
import { testServerEnv } from '../testing/fixtures'
import { createCallerFactory } from '../trpc'
import { appRouter } from './_app'

/**
 * Manual response entry — SPEC.md §8, §14.4.
 *
 * Covers the three things that can go wrong independently: who may enter a
 * response at all (capability), which accounts they may enter it against
 * (scope), and whether the write actually moves the rollups.
 */

const env = testServerEnv()
const JULY = new Date('2026-07-15T12:00:00.000Z')

let db: AppDb
const ids = { network: '', agencyTsl: '', agencyOther: '', mogu: '', outsider: '' }
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

async function seedUser(
  key: string,
  role: RoleKey,
  scopeId: string,
  scopeType: 'account' | 'agency',
) {
  const [user] = await db
    .insert(users)
    .values({ email: `${key}@thestarterlabs.com`, name: key })
    .returning()
  userIds[key] = user!.id

  await db.insert(memberships).values({ userId: user!.id, scopeType, scopeId, role })
}

beforeAll(async () => {
  db = await createTestDb()

  const [network] = await db.insert(networks).values({ name: 'Zoo', slug: 'zoo' }).returning()
  ids.network = network!.id

  const [tsl] = await db
    .insert(agencies)
    .values({ networkId: network!.id, name: 'TSL', slug: 'tsl' })
    .returning()
  const [other] = await db
    .insert(agencies)
    .values({ networkId: network!.id, name: 'Other', slug: 'other' })
    .returning()
  ids.agencyTsl = tsl!.id
  ids.agencyOther = other!.id

  const [mogu] = await db
    .insert(accounts)
    .values({ agencyId: tsl!.id, name: 'Mogu Mogu', slug: 'mogu-mogu' })
    .returning()
  const [outsider] = await db
    .insert(accounts)
    .values({ agencyId: other!.id, name: 'Outsider', slug: 'outsider' })
    .returning()
  ids.mogu = mogu!.id
  ids.outsider = outsider!.id

  await seedUser('manager', 'account_manager', ids.mogu, 'account')
  await seedUser('director', 'account_director', ids.mogu, 'account')
  await seedUser('member', 'team_member', ids.mogu, 'account')
  await seedUser('viewer', 'viewer', ids.mogu, 'account')
  await seedUser('agencyAdmin', 'agency_admin', ids.agencyTsl, 'agency')
}, 60_000)

describe('capability gate (§5.3 + enter_response)', () => {
  const entry = () => ({
    accountId: ids.mogu,
    type: 'csat' as const,
    score: 5,
    submittedAt: JULY,
  })

  it('permits an account_manager', async () => {
    const caller = await callerFor('manager')

    await expect(caller.responses.createManual(entry())).resolves.toBeDefined()
  })

  it('permits an account_director and an agency_admin', async () => {
    await expect(
      (await callerFor('director')).responses.createManual(entry()),
    ).resolves.toBeDefined()
    await expect(
      (await callerFor('agencyAdmin')).responses.createManual(entry()),
    ).resolves.toBeDefined()
  })

  it('refuses a team_member', async () => {
    // Injecting scores moves every headline number, so read access is not enough.
    const caller = await callerFor('member')

    await expect(caller.responses.createManual(entry())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('refuses a viewer', async () => {
    const caller = await callerFor('viewer')

    await expect(caller.responses.createManual(entry())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})

describe('scope gate (§5.2, §12)', () => {
  it('refuses an account outside the caller’s scope', async () => {
    const caller = await callerFor('manager')

    await expect(
      caller.responses.createManual({
        accountId: ids.outsider,
        type: 'csat',
        score: 5,
        submittedAt: JULY,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('writes nothing for the refused account', async () => {
    const rows = await db
      .select()
      .from(surveyResponses)
      .where(eq(surveyResponses.accountId, ids.outsider))

    expect(rows).toEqual([])
  })

  it('scopes the response list to visible accounts', async () => {
    const caller = await callerFor('manager')
    const listed = await caller.responses.list()

    expect(listed.length).toBeGreaterThan(0)
    expect(listed.every((row) => row.accountId === ids.mogu)).toBe(true)
  })
})

describe('input validation (shared schema)', () => {
  const base = { accountId: '', type: 'csat' as const, score: 5, submittedAt: JULY }

  it('rejects a CSAT score outside 1-5', async () => {
    const caller = await callerFor('manager')

    await expect(
      caller.responses.createManual({ ...base, accountId: ids.mogu, score: 6 }),
    ).rejects.toThrow(/CSAT score must be between 1 and 5/)
    await expect(
      caller.responses.createManual({ ...base, accountId: ids.mogu, score: 0 }),
    ).rejects.toThrow(/CSAT score must be between 1 and 5/)
  })

  it('rejects an NPS score outside 0-10', async () => {
    const caller = await callerFor('manager')

    await expect(
      caller.responses.createManual({ ...base, accountId: ids.mogu, type: 'nps', score: 11 }),
    ).rejects.toThrow(/NPS score must be between 0 and 10/)
  })

  it('accepts an NPS 0, which is valid where CSAT 0 is not', async () => {
    const caller = await callerFor('manager')

    await expect(
      caller.responses.createManual({ ...base, accountId: ids.mogu, type: 'nps', score: 0 }),
    ).resolves.toBeDefined()
  })

  it('rejects a future submittedAt', async () => {
    const caller = await callerFor('manager')
    const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

    await expect(
      caller.responses.createManual({ ...base, accountId: ids.mogu, submittedAt: nextYear }),
    ).rejects.toThrow(/future/)
  })
})

describe('what gets written', () => {
  it('records the response as an import with its period derived', async () => {
    const caller = await callerFor('manager')
    const { response } = await caller.responses.createManual({
      accountId: ids.mogu,
      type: 'csat',
      score: 4,
      respondentName: 'Priya',
      submittedAt: JULY,
    })

    expect(response.source).toBe('import')
    expect(response.respondentName).toBe('Priya')
    // CSAT is monthly (§4.3 csat_cadence).
    expect(response.periodStart).toBe('2026-07-01')
    expect(response.periodEnd).toBe('2026-07-31')
  })

  it('derives a quarterly period for NPS', async () => {
    const caller = await callerFor('manager')
    const { response } = await caller.responses.createManual({
      accountId: ids.mogu,
      type: 'nps',
      score: 9,
      submittedAt: JULY,
    })

    expect(response.periodStart).toBe('2026-07-01')
    expect(response.periodEnd).toBe('2026-09-30')
  })

  it('leaves external_response_id null, so manual entries never collide', async () => {
    // The idempotency key is (source, external_response_id) and Postgres treats
    // nulls as distinct — many manual entries coexist without tripping it.
    const caller = await callerFor('manager')

    await expect(
      caller.responses.createManual({
        accountId: ids.mogu,
        type: 'csat',
        score: 3,
        submittedAt: JULY,
      }),
    ).resolves.toBeDefined()

    const rows = await db
      .select()
      .from(surveyResponses)
      .where(eq(surveyResponses.accountId, ids.mogu))

    expect(rows.every((row) => row.externalResponseId === null)).toBe(true)
    expect(rows.length).toBeGreaterThan(1)
  })

  it('stores an open-text comment on response_answers', async () => {
    const caller = await callerFor('manager')
    const { response } = await caller.responses.createManual({
      accountId: ids.mogu,
      type: 'csat',
      score: 2,
      submittedAt: JULY,
      comment: 'Deadline was missed twice this month.',
    })

    const [answer] = await db
      .select()
      .from(responseAnswers)
      .where(eq(responseAnswers.responseId, response.id))

    expect(answer!.answerText).toBe('Deadline was missed twice this month.')
  })

  it('reuses one manual-entry survey per account and type', async () => {
    const rows = await db.select().from(surveyResponses).where(eq(surveyResponses.type, 'csat'))
    const surveyIds = new Set(rows.map((row) => row.surveyId))

    expect(surveyIds.size).toBe(1)
  })
})

describe('rollups update on write (§4.3)', () => {
  it('has already recomputed by the time the mutation returns', async () => {
    // Awaited rather than fired-and-forgotten, so a dashboard read immediately
    // after a write cannot see stale numbers.
    const caller = await callerFor('manager')
    const { rollups } = await caller.responses.createManual({
      accountId: ids.mogu,
      type: 'csat',
      score: 5,
      submittedAt: JULY,
    })

    expect(rollups.rowsUpserted).toBeGreaterThan(0)
  })

  it('stores a CSAT % matching the responses actually recorded', async () => {
    const responses = await db
      .select()
      .from(surveyResponses)
      .where(and(eq(surveyResponses.accountId, ids.mogu), eq(surveyResponses.type, 'csat')))

    const satisfied = responses.filter((row) => row.score >= 4).length
    const expected = Math.round((satisfied / responses.length) * 1000) / 10

    const [rollup] = await db
      .select()
      .from(metricRollups)
      .where(
        and(
          eq(metricRollups.scopeType, 'account'),
          eq(metricRollups.scopeId, ids.mogu),
          eq(metricRollups.metric, 'csat_percent'),
          eq(metricRollups.periodStart, '2026-07-01'),
        ),
      )

    expect(Number(rollup!.value)).toBe(expected)
    expect(rollup!.sampleSize).toBe(responses.length)
  })

  it('propagates the write up to agency and network scope', async () => {
    for (const [scopeType, scopeId] of [
      ['agency', ids.agencyTsl],
      ['network', ids.network],
    ] as const) {
      const [rollup] = await db
        .select()
        .from(metricRollups)
        .where(
          and(
            eq(metricRollups.scopeType, scopeType),
            eq(metricRollups.scopeId, scopeId),
            eq(metricRollups.metric, 'csat_percent'),
            eq(metricRollups.periodStart, '2026-07-01'),
          ),
        )

      expect(rollup, `${scopeType} rollup should exist`).toBeDefined()
      expect(rollup!.sampleSize).toBeGreaterThan(0)
    }
  })

  it('writes the quarterly rollup as well as the monthly one', async () => {
    const [quarterly] = await db
      .select()
      .from(metricRollups)
      .where(
        and(
          eq(metricRollups.scopeType, 'account'),
          eq(metricRollups.scopeId, ids.mogu),
          eq(metricRollups.metric, 'nps'),
          eq(metricRollups.periodGrain, 'quarterly'),
        ),
      )

    expect(quarterly).toBeDefined()
    expect(quarterly!.periodEnd).toBe('2026-09-30')
  })
})
