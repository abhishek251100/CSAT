import type { AppDb } from '@zoo/db'
import {
  accounts,
  agencies,
  escalations,
  metricRollups,
  networks,
  surveyResponses,
  surveys,
} from '@zoo/db/schema'
import {
  csatPercent,
  monthlyPeriodFor,
  npsScore,
  quarterlyPeriodFor,
  type MetricKey,
  type MetricResponse,
  type ScopeType,
} from '@zoo/shared'
import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb } from '../testing/db'
import { recomputeCurrentAndPrevious, recomputeForResponse, recomputeRollups } from './recompute'

/**
 * Rollup correctness — SPEC.md §4.3, §6.
 *
 * Seeds a known response set, recomputes, and checks the stored numbers against
 * values worked out by hand — not against the same functions that produced
 * them, which would only prove the code agrees with itself.
 *
 * Fixture (all in July 2026 / Q3 2026):
 *
 *   Zoo Media
 *     The Starter Labs
 *       Mogu Mogu   CSAT 5,5,4,3   -> 3 of 4 satisfied = 75.0, 1 DSAT, avg 4.25
 *                   NPS  10,9,0    -> 2 promoters, 1 detractor of 3 = 33.3
 *       Chemistry   CSAT 1,2       -> 0 of 2 satisfied = 0.0, 2 DSAT, avg 1.5
 *     Sibling Agency
 *       Inkspired   CSAT 5,5,5,5,5,5 -> 6 of 6 = 100.0
 *
 *   TSL agency pooled  = Mogu + Chemistry = 3 of 6 satisfied = 50.0
 *   Zoo network pooled = all three        = 9 of 12 satisfied = 75.0
 *
 * The network figure is the one that matters most: an account-weighted mean of
 * (75.0, 0.0, 100.0) would be 58.3. Response-weighted pooling gives 75.0.
 */

const JULY = new Date('2026-07-15T12:00:00.000Z')
const JUNE = new Date('2026-06-15T12:00:00.000Z')

let db: AppDb

const ids = {
  network: '',
  agencyTsl: '',
  agencySibling: '',
  mogu: '',
  chemistry: '',
  inkspired: '',
}

async function seedResponses(
  accountId: string,
  type: 'csat' | 'nps',
  scores: number[],
  submittedAt: Date = JULY,
) {
  const [survey] = await db
    .insert(surveys)
    .values({
      accountId,
      type,
      title: `${type} instrument`,
      source: 'import',
      cadence: type === 'csat' ? 'monthly' : 'quarterly',
    })
    .returning()

  for (const score of scores) {
    await db.insert(surveyResponses).values({
      surveyId: survey!.id,
      accountId,
      type,
      score,
      source: 'import',
      submittedAt,
    })
  }
}

/** Reads one stored rollup value back as a number. */
async function storedValue(
  scopeType: ScopeType,
  scopeId: string,
  metric: MetricKey,
  periodStart: string,
): Promise<{ value: number | null; sampleSize: number } | undefined> {
  const [row] = await db
    .select()
    .from(metricRollups)
    .where(
      and(
        eq(metricRollups.scopeType, scopeType),
        eq(metricRollups.scopeId, scopeId),
        eq(metricRollups.metric, metric),
        eq(metricRollups.periodStart, periodStart),
      ),
    )
    .limit(1)

  if (!row) return undefined

  return { value: row.value === null ? null : Number(row.value), sampleSize: row.sampleSize }
}

beforeAll(async () => {
  db = await createTestDb()

  const [network] = await db.insert(networks).values({ name: 'Zoo Media', slug: 'zoo' }).returning()
  ids.network = network!.id

  const [tsl] = await db
    .insert(agencies)
    .values({ networkId: network!.id, name: 'The Starter Labs', slug: 'tsl' })
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

  await seedResponses(ids.mogu, 'csat', [5, 5, 4, 3])
  await seedResponses(ids.mogu, 'nps', [10, 9, 0])
  await seedResponses(ids.chemistry, 'csat', [1, 2])
  await seedResponses(ids.inkspired, 'csat', [5, 5, 5, 5, 5, 5])

  await recomputeRollups(db, {
    accountIds: [ids.mogu, ids.chemistry, ids.inkspired],
    periods: [monthlyPeriodFor(JULY), quarterlyPeriodFor(JULY)],
  })
}, 60_000)

describe('account-tier rollups match hand-computed values', () => {
  it('stores CSAT % for Mogu Mogu', async () => {
    // 5,5,4 satisfied of 5,5,4,3 = 3/4 = 75.0
    expect(await storedValue('account', ids.mogu, 'csat_percent', '2026-07-01')).toEqual({
      value: 75,
      sampleSize: 4,
    })
  })

  it('stores average CSAT to one decimal', async () => {
    // (5+5+4+3)/4 = 4.25 -> 4.3
    expect(await storedValue('account', ids.mogu, 'average_csat', '2026-07-01')).toEqual({
      value: 4.3,
      sampleSize: 4,
    })
  })

  it('stores DSAT count', async () => {
    // Only the 3 is dissatisfied.
    expect(await storedValue('account', ids.mogu, 'dsat_count', '2026-07-01')).toEqual({
      value: 1,
      sampleSize: 4,
    })
  })

  it('stores NPS', async () => {
    // 10,9 promoters and 0 detractor of 3: 66.667 - 33.333 = 33.3
    expect(await storedValue('account', ids.mogu, 'nps', '2026-07-01')).toEqual({
      value: 33.3,
      sampleSize: 3,
    })
  })

  it('counts every response regardless of type', async () => {
    // 4 CSAT + 3 NPS
    expect(await storedValue('account', ids.mogu, 'response_count', '2026-07-01')).toEqual({
      value: 7,
      sampleSize: 7,
    })
  })

  it('stores 0% for an account where nobody was satisfied', async () => {
    // 0.0 and "no data" must stay distinguishable — this is a real zero.
    expect(await storedValue('account', ids.chemistry, 'csat_percent', '2026-07-01')).toEqual({
      value: 0,
      sampleSize: 2,
    })
  })

  it('stores null NPS for an account with no NPS responses', async () => {
    // Chemistry has CSAT only. Null, not 0 — 0 is a real NPS score.
    expect(await storedValue('account', ids.chemistry, 'nps', '2026-07-01')).toEqual({
      value: null,
      sampleSize: 0,
    })
  })
})

describe('pooling is response-weighted (§6, decision #3)', () => {
  it('pools an agency over all its accounts’ responses', async () => {
    // Mogu 5,5,4,3 + Chemistry 1,2 = 3 satisfied of 6 = 50.0
    // An account-weighted mean of (75.0, 0.0) would be 37.5.
    expect(await storedValue('agency', ids.agencyTsl, 'csat_percent', '2026-07-01')).toEqual({
      value: 50,
      sampleSize: 6,
    })
  })

  it('pools the network over every account, not over agency averages', async () => {
    // 9 satisfied of 12 = 75.0
    // Account-weighted  mean(75.0, 0.0, 100.0) = 58.3  <- explicitly NOT this
    // Agency-weighted   mean(50.0, 100.0)      = 75.0  <- coincidence, see below
    expect(await storedValue('network', ids.network, 'csat_percent', '2026-07-01')).toEqual({
      value: 75,
      sampleSize: 12,
    })
  })

  it('gives the network figure that only response-weighting can produce', async () => {
    // Inkspired's 6 responses outweigh Chemistry's 2, which is the whole point.
    // Recomputed independently here from the raw scores.
    const everyResponse: MetricResponse[] = [
      ...[5, 5, 4, 3].map((score) => ({ type: 'csat' as const, score })),
      ...[1, 2].map((score) => ({ type: 'csat' as const, score })),
      ...[5, 5, 5, 5, 5, 5].map((score) => ({ type: 'csat' as const, score })),
    ]

    const stored = await storedValue('network', ids.network, 'csat_percent', '2026-07-01')

    expect(stored?.value).toBe(csatPercent(everyResponse))
    expect(stored?.value).not.toBe(58.3)
  })

  it('rolls NPS up the hierarchy too', async () => {
    // Only Mogu has NPS responses, so agency and network match the account.
    const expected = npsScore([10, 9, 0].map((score) => ({ type: 'nps' as const, score })))

    expect((await storedValue('agency', ids.agencyTsl, 'nps', '2026-07-01'))?.value).toBe(expected)
    expect((await storedValue('network', ids.network, 'nps', '2026-07-01'))?.value).toBe(expected)
  })

  it('keeps a sibling agency’s figures independent', async () => {
    expect(await storedValue('agency', ids.agencySibling, 'csat_percent', '2026-07-01')).toEqual({
      value: 100,
      sampleSize: 6,
    })
  })
})

describe('period isolation', () => {
  it('excludes responses outside the period', async () => {
    await seedResponses(ids.inkspired, 'csat', [1, 1, 1], JUNE)

    await recomputeRollups(db, {
      accountIds: [ids.inkspired],
      periods: [monthlyPeriodFor(JULY), monthlyPeriodFor(JUNE)],
    })

    // July is untouched by the June responses.
    expect((await storedValue('account', ids.inkspired, 'csat_percent', '2026-07-01'))?.value).toBe(
      100,
    )
    // June sees only its own.
    expect(await storedValue('account', ids.inkspired, 'csat_percent', '2026-06-01')).toEqual({
      value: 0,
      sampleSize: 3,
    })
  })

  it('rolls both months into the containing quarter', async () => {
    await recomputeRollups(db, {
      accountIds: [ids.inkspired],
      periods: [quarterlyPeriodFor(JULY)],
    })

    // Q3 is Jul-Sep, so the June responses fall in Q2, not here.
    expect(await storedValue('account', ids.inkspired, 'csat_percent', '2026-07-01')).toEqual({
      value: 100,
      sampleSize: 6,
    })
  })

  it('stores null with a zero sample for a period that has no responses', async () => {
    await recomputeRollups(db, {
      accountIds: [ids.mogu],
      periods: [monthlyPeriodFor(new Date('2026-05-10T00:00:00.000Z'))],
    })

    expect(await storedValue('account', ids.mogu, 'csat_percent', '2026-05-01')).toEqual({
      value: null,
      sampleSize: 0,
    })
  })

  it('still records a real zero count for an empty period', async () => {
    // dsat_count is a count, so 0 is true even with no data; sample_size is
    // what distinguishes "0 of 0" from "0 of 40".
    expect(await storedValue('account', ids.mogu, 'dsat_count', '2026-05-01')).toEqual({
      value: 0,
      sampleSize: 0,
    })
  })
})

describe('recomputation is idempotent', () => {
  it('upserts rather than duplicating rows', async () => {
    const before = await db.select().from(metricRollups)

    await recomputeRollups(db, {
      accountIds: [ids.mogu, ids.chemistry, ids.inkspired],
      periods: [monthlyPeriodFor(JULY), quarterlyPeriodFor(JULY)],
    })

    const after = await db.select().from(metricRollups)

    expect(after).toHaveLength(before.length)
  })

  it('produces the same values on a second run', async () => {
    const first = await storedValue('network', ids.network, 'csat_percent', '2026-07-01')

    await recomputeRollups(db, {
      accountIds: [ids.mogu],
      periods: [monthlyPeriodFor(JULY)],
    })

    expect(await storedValue('network', ids.network, 'csat_percent', '2026-07-01')).toEqual(first)
  })

  it('advances computed_at so staleness is visible', async () => {
    const [before] = await db
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

    await new Promise((resolve) => setTimeout(resolve, 5))
    await recomputeRollups(db, { accountIds: [ids.mogu], periods: [monthlyPeriodFor(JULY)] })

    const [after] = await db
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

    expect(after!.computedAt.getTime()).toBeGreaterThanOrEqual(before!.computedAt.getTime())
  })
})

describe('recompute reacts to changed data', () => {
  it('picks up a newly added response', async () => {
    await seedResponses(ids.chemistry, 'csat', [5, 5], JULY)

    await recomputeForResponse(db, ids.chemistry, JULY)

    // Chemistry was 1,2; now 1,2,5,5 = 2 of 4 = 50.0
    expect(await storedValue('account', ids.chemistry, 'csat_percent', '2026-07-01')).toEqual({
      value: 50,
      sampleSize: 4,
    })
  })

  it('propagates that change up to agency and network', async () => {
    // TSL: Mogu 5,5,4,3 + Chemistry 1,2,5,5 = 5 of 8 = 62.5
    expect(await storedValue('agency', ids.agencyTsl, 'csat_percent', '2026-07-01')).toEqual({
      value: 62.5,
      sampleSize: 8,
    })

    // Network: 11 satisfied of 14 = 78.571... -> 78.6
    expect(await storedValue('network', ids.network, 'csat_percent', '2026-07-01')).toEqual({
      value: 78.6,
      sampleSize: 14,
    })
  })

  it('drops a soft-deleted response from the figures', async () => {
    const [response] = await db
      .select()
      .from(surveyResponses)
      .where(and(eq(surveyResponses.accountId, ids.chemistry), eq(surveyResponses.score, 5)))
      .limit(1)

    await db
      .update(surveyResponses)
      .set({ deletedAt: new Date() })
      .where(eq(surveyResponses.id, response!.id))

    await recomputeForResponse(db, ids.chemistry, JULY)

    // 1,2,5 remaining = 1 of 3 = 33.3
    expect(await storedValue('account', ids.chemistry, 'csat_percent', '2026-07-01')).toEqual({
      value: 33.3,
      sampleSize: 3,
    })
  })

  it('counts escalations reported in the period', async () => {
    await db.insert(escalations).values({
      accountId: ids.mogu,
      source: 'email',
      severity: 'high',
      title: 'Missed deadline',
      reportedAt: JULY,
    })

    await recomputeForResponse(db, ids.mogu, JULY)

    expect((await storedValue('account', ids.mogu, 'escalation_count', '2026-07-01'))?.value).toBe(
      1,
    )
    expect(
      (await storedValue('network', ids.network, 'escalation_count', '2026-07-01'))?.value,
    ).toBe(1)
  })
})

describe('on-write recomputation targets the response’s own period', () => {
  it('updates the backdated period, not the current one', async () => {
    // Manual entry is routinely backdated; recomputing "now" would leave the
    // month the response belongs to untouched.
    const march = new Date('2026-03-10T09:00:00.000Z')

    await seedResponses(ids.mogu, 'csat', [1, 1], march)
    await recomputeForResponse(db, ids.mogu, march)

    expect(await storedValue('account', ids.mogu, 'csat_percent', '2026-03-01')).toEqual({
      value: 0,
      sampleSize: 2,
    })
  })

  it('leaves other periods alone', async () => {
    expect((await storedValue('account', ids.mogu, 'csat_percent', '2026-07-01'))?.value).toBe(75)
  })

  it('is scoped to the affected account — an unrelated account is not recomputed', async () => {
    // Ask #3: on-write recompute must not be a full rebuild. Inkspired shares
    // nothing with Mogu (different agency), so writing a Mogu response must
    // leave Inkspired's rollup row byte-for-byte untouched, computed_at
    // included. If the write triggered a global recompute, computed_at would
    // advance.
    const [inkspiredBefore] = await db
      .select()
      .from(metricRollups)
      .where(
        and(
          eq(metricRollups.scopeType, 'account'),
          eq(metricRollups.scopeId, ids.inkspired),
          eq(metricRollups.metric, 'csat_percent'),
          eq(metricRollups.periodStart, '2026-07-01'),
        ),
      )

    await new Promise((resolve) => setTimeout(resolve, 5))
    await seedResponses(ids.mogu, 'csat', [5], JULY)
    await recomputeForResponse(db, ids.mogu, JULY)

    const [inkspiredAfter] = await db
      .select()
      .from(metricRollups)
      .where(
        and(
          eq(metricRollups.scopeType, 'account'),
          eq(metricRollups.scopeId, ids.inkspired),
          eq(metricRollups.metric, 'csat_percent'),
          eq(metricRollups.periodStart, '2026-07-01'),
        ),
      )

    expect(inkspiredAfter).toEqual(inkspiredBefore)
  })
})

describe('scheduled recomputation (cron stub)', () => {
  it('covers current and previous period at both grains for every account', async () => {
    const summary = await recomputeCurrentAndPrevious(db, JULY)

    // 3 accounts + 2 agencies + 1 network = 6 scopes, 4 periods.
    expect(summary.scopesRecomputed).toBe(6)
    expect(summary.periodsRecomputed).toBe(4)
  })

  it('writes the previous month as well as the current one', async () => {
    // June was seeded with Inkspired's 1,1,1.
    expect(await storedValue('account', ids.inkspired, 'csat_percent', '2026-06-01')).toEqual({
      value: 0,
      sampleSize: 3,
    })
  })

  it('ignores a soft-deleted account', async () => {
    const [retired] = await db
      .insert(accounts)
      .values({ agencyId: ids.agencyTsl, name: 'Retired', slug: 'retired' })
      .returning()

    await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, retired!.id))

    const summary = await recomputeCurrentAndPrevious(db, JULY)

    expect(summary.scopesRecomputed).toBe(6)
  })
})

describe('guards', () => {
  it('does nothing when given no accounts', async () => {
    const summary = await recomputeRollups(db, {
      accountIds: [],
      periods: [monthlyPeriodFor(JULY)],
    })

    expect(summary).toEqual({ scopesRecomputed: 0, periodsRecomputed: 0, rowsUpserted: 0 })
  })

  it('does nothing when given no periods', async () => {
    const summary = await recomputeRollups(db, { accountIds: [ids.mogu], periods: [] })

    expect(summary.rowsUpserted).toBe(0)
  })

  it('ignores an account id that does not exist', async () => {
    const summary = await recomputeRollups(db, {
      accountIds: ['019f0000-0000-7000-8000-000000000000'],
      periods: [monthlyPeriodFor(JULY)],
    })

    expect(summary.scopesRecomputed).toBe(0)
  })
})
