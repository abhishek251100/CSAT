import type { AppDb } from '@zoo/db'
import { accounts, agencies, metricRollups, rcas, surveyResponses } from '@zoo/db/schema'
import {
  addRollupCounts,
  composeScorecard,
  computeRollupMetrics,
  delta,
  EMPTY_ROLLUP_COUNTS,
  errorCategoryDistribution,
  npsBand,
  periodBoundsUtc,
  periodsInRange,
  VIEW_SCOPE_TYPES,
  type IsoDate,
  type MetricResponse,
  type Period,
  type RollupCounts,
  type Scorecard,
  type ScopeType,
} from '@zoo/shared'
import { and, asc, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import { z } from 'zod'
import { resolveScopeAccounts } from '../auth/scope'
import { protectedProcedure, router } from '../trpc'

/**
 * Metrics router — SPEC.md §8, §9 View 1, §12.
 *
 * §12: "dashboards read `metric_rollups`; raw scans only for custom ranges."
 * That is exactly the split here — a monthly or quarterly request is served
 * entirely from precomputed rows, and only an arbitrary custom range falls back
 * to scanning `survey_responses`. Every response reports which path it took, so
 * a slow page is attributable rather than mysterious.
 *
 * Nothing in this file computes a metric. Pooling and the headline figures come
 * from `composeScorecard` in @zoo/shared, which calls the §6 formulas — the
 * same ones the rollup job used to write the rows being read.
 */

const scopeInput = z.object({
  scopeType: z.enum(VIEW_SCOPE_TYPES),
  /** UUID for network/agency/account; the literal `global` when scopeType is global. */
  scopeId: z.string().min(1),
  grain: z.enum(['monthly', 'quarterly', 'custom']),
  from: z.iso.date(),
  to: z.iso.date(),
})

export interface TrendPoint {
  readonly periodStart: IsoDate
  readonly periodEnd: IsoDate
  readonly label: string
  readonly csatPercent: number | null
  readonly nps: number | null
  readonly responseCount: number
  readonly promoters: number
  readonly passives: number
  readonly detractors: number
}

export const metricsRouter = router({
  /**
   * Everything View 1's KPI cards and charts need, in one round trip.
   *
   * `current` is pooled across the whole selected window, response-weighted, so
   * a six-month CSAT % is not the mean of six monthly percentages. `previous`
   * covers the immediately preceding window of the same length, which is what
   * §9's "period-over-period delta" compares against.
   */
  getScorecard: protectedProcedure.input(scopeInput).query(async ({ ctx, input }) => {
    const accountIds = await resolveScopeAccounts(
      ctx.db,
      ctx.session,
      input.scopeType,
      input.scopeId,
    )

    if (input.grain === 'custom') {
      const current = await liveCounts(ctx.db, accountIds, input.from, input.to)
      const scorecard = composeScorecard(current)

      return {
        source: 'live' as const,
        grain: input.grain,
        range: { from: input.from, to: input.to },
        current: scorecard,
        previous: null,
        deltas: emptyDeltas(),
        npsBand: scorecard.nps === null ? null : npsBand(scorecard.nps),
        /**
         * A custom range is one bucket by definition — there is no natural
         * sub-division to plot, so the trend is a single point rather than an
         * invented breakdown.
         */
        trend: [] as TrendPoint[],
      }
    }

    const periods = periodsInRange(input.grain, input.from, input.to)

    if (periods.length === 0) {
      return {
        source: 'rollups' as const,
        grain: input.grain,
        range: { from: input.from, to: input.to },
        current: composeScorecard(EMPTY_ROLLUP_COUNTS),
        previous: null,
        deltas: emptyDeltas(),
        npsBand: null,
        trend: [] as TrendPoint[],
      }
    }

    /**
     * The preceding window of equal length, fetched in the same query so the
     * delta costs no extra round trip.
     */
    const previousPeriods = precedingWindow(input.grain, periods)

    /**
     * Global has no precomputed rollup row — pool account-tier rollups
     * response-weighted. Other tiers read their stored scope rollups.
     */
    let byPeriod: Map<IsoDate, RollupCounts>
    if (input.scopeType === 'global') {
      byPeriod = await poolAccountRollupsByPeriod(ctx.db, accountIds, [
        ...previousPeriods,
        ...periods,
      ])
    } else {
      byPeriod = await rollupCountsByPeriod(
        ctx.db,
        input.scopeType as ScopeType,
        input.scopeId,
        [...previousPeriods, ...periods],
      )
    }

    const current = periods.reduce(
      (total, period) => addRollupCounts(total, byPeriod.get(period.start) ?? EMPTY_ROLLUP_COUNTS),
      EMPTY_ROLLUP_COUNTS,
    )
    const previousCounts = previousPeriods.reduce(
      (total, period) => addRollupCounts(total, byPeriod.get(period.start) ?? EMPTY_ROLLUP_COUNTS),
      EMPTY_ROLLUP_COUNTS,
    )

    const scorecard = composeScorecard(current)
    /**
     * Null rather than a zeroed scorecard when the preceding window holds no
     * data at all — otherwise the first month of a new account reads as a
     * catastrophic decline from a fictional 100%.
     */
    const previous =
      previousCounts === EMPTY_ROLLUP_COUNTS || countTotal(previousCounts) === 0
        ? null
        : composeScorecard(previousCounts)

    return {
      source: 'rollups' as const,
      grain: input.grain,
      range: { from: input.from, to: input.to },
      current: scorecard,
      previous,
      deltas: {
        csatPercent: delta(scorecard.csatPercent, previous?.csatPercent ?? null),
        nps: delta(scorecard.nps, previous?.nps ?? null),
        responseCount: previous === null ? null : scorecard.responseCount - previous.responseCount,
        dsatRate:
          previous === null || scorecard.dsatRate === null || previous.dsatRate === null
            ? null
            : Math.round((scorecard.dsatRate - previous.dsatRate) * 1000) / 10,
      },
      npsBand: scorecard.nps === null ? null : npsBand(scorecard.nps),
      trend: periods.map((period) => {
        const point = composeScorecard(byPeriod.get(period.start) ?? EMPTY_ROLLUP_COUNTS)

        return {
          periodStart: period.start,
          periodEnd: period.end,
          label: periodLabel(period),
          csatPercent: point.csatPercent,
          nps: point.nps,
          responseCount: point.responseCount,
          promoters: point.promoters,
          passives: point.passives,
          detractors: point.detractors,
        } satisfies TrendPoint
      }),
    }
  }),

  /**
   * Per-account figures for the §9 leaderboard, shown at agency and network
   * scope. Reads account-tier rollups, so it costs one query however many
   * accounts are in view.
   */
  getAccountLeaderboard: protectedProcedure.input(scopeInput).query(async ({ ctx, input }) => {
    const accountIds = await resolveScopeAccounts(
      ctx.db,
      ctx.session,
      input.scopeType,
      input.scopeId,
    )

    const periods =
      input.grain === 'custom' ? [] : periodsInRange(input.grain, input.from, input.to)

    const named = await ctx.db
      .select({ id: accounts.id, name: accounts.name, slug: accounts.slug })
      .from(accounts)
      .where(and(inArray(accounts.id, accountIds), isNull(accounts.deletedAt)))
      .orderBy(asc(accounts.name))

    const countsByAccount =
      periods.length === 0
        ? new Map<string, RollupCounts>()
        : await accountCountsInPeriods(ctx.db, accountIds, periods)

    return named.map((account) => {
      const scorecard = composeScorecard(countsByAccount.get(account.id) ?? EMPTY_ROLLUP_COUNTS)

      return {
        accountId: account.id,
        name: account.name,
        slug: account.slug,
        csatPercent: scorecard.csatPercent,
        nps: scorecard.nps,
        npsBand: scorecard.nps === null ? null : npsBand(scorecard.nps),
        responseCount: scorecard.responseCount,
        dsatCount: scorecard.dsatCount,
      }
    })
  }),

  /**
   * Error-category distribution for the §9 View 2 pie (people / process /
   * product), from RCAs in scope.
   *
   * §8 lists this on the metrics router. It reads live RCA rows rather than a
   * rollup because error_category is set by a human after the fact (§11) and is
   * lower-volume than survey responses — a rollup would add staleness for no
   * speed gain. The share maths is `errorCategoryDistribution` in @zoo/shared,
   * so it matches every other place the split is computed. Uncategorised RCAs
   * are excluded from the denominator, as that function specifies.
   */
  getErrorCategoryBreakdown: protectedProcedure.input(scopeInput).query(async ({ ctx, input }) => {
    const accountIds = await resolveScopeAccounts(
      ctx.db,
      ctx.session,
      input.scopeType,
      input.scopeId,
    )

    // §6: "share of RCAs by error_category over the period". Filtered by the
    // RCA's created_at, half-open [from, to+1day), matching the period bounds
    // used everywhere else.
    const startAt = new Date(`${input.from}T00:00:00.000Z`)
    const toParts = input.to.split('-').map(Number) as [number, number, number]
    const endAtExclusive = new Date(Date.UTC(toParts[0], toParts[1] - 1, toParts[2] + 1))

    const rows = await ctx.db
      .select({ errorCategory: rcas.errorCategory })
      .from(rcas)
      .where(
        and(
          inArray(rcas.accountId, accountIds),
          isNull(rcas.deletedAt),
          gte(rcas.createdAt, startAt),
          lt(rcas.createdAt, endAtExclusive),
        ),
      )

    return errorCategoryDistribution(rows)
  }),

  /**
   * Per-agency scorecard for network/global views — shows which agency is
   * performing vs struggling under the selected period.
   */
  getAgencyBreakdown: protectedProcedure.input(scopeInput).query(async ({ ctx, input }) => {
    if (input.scopeType !== 'network' && input.scopeType !== 'global') {
      return []
    }

    const accountIds = await resolveScopeAccounts(
      ctx.db,
      ctx.session,
      input.scopeType,
      input.scopeId,
    )

    const named = await ctx.db
      .select({
        accountId: accounts.id,
        agencyId: agencies.id,
        agencyName: agencies.name,
      })
      .from(accounts)
      .innerJoin(agencies, eq(accounts.agencyId, agencies.id))
      .where(and(inArray(accounts.id, accountIds), isNull(accounts.deletedAt)))

    const byAgency = new Map<string, { name: string; accountIds: string[] }>()
    for (const row of named) {
      const current = byAgency.get(row.agencyId) ?? { name: row.agencyName, accountIds: [] }
      current.accountIds.push(row.accountId)
      byAgency.set(row.agencyId, current)
    }

    const periods =
      input.grain === 'custom' ? [] : periodsInRange(input.grain, input.from, input.to)

    const results = []
    for (const [agencyId, agency] of byAgency) {
      let counts = EMPTY_ROLLUP_COUNTS
      if (input.grain === 'custom') {
        counts = await liveCounts(ctx.db, agency.accountIds, input.from, input.to)
      } else if (periods.length > 0) {
        const pooled = await poolAccountRollupsByPeriod(ctx.db, agency.accountIds, periods)
        counts = periods.reduce(
          (total, period) => addRollupCounts(total, pooled.get(period.start) ?? EMPTY_ROLLUP_COUNTS),
          EMPTY_ROLLUP_COUNTS,
        )
      }
      const scorecard = composeScorecard(counts)
      results.push({
        agencyId,
        name: agency.name,
        csatPercent: scorecard.csatPercent,
        nps: scorecard.nps,
        responseCount: scorecard.responseCount,
        csatResponseCount: scorecard.csatResponseCount,
        dsatCount: scorecard.dsatCount,
        dsatRate: scorecard.dsatRate,
      })
    }

    return results.sort((a, b) => a.name.localeCompare(b.name))
  }),
})

// ------------------------------------------------------------------ helpers

function emptyDeltas() {
  return { csatPercent: null, nps: null, responseCount: null, dsatRate: null }
}

function countTotal(counts: RollupCounts): number {
  return (
    counts.csatScores[1] +
    counts.csatScores[2] +
    counts.csatScores[3] +
    counts.csatScores[4] +
    counts.csatScores[5] +
    counts.promoters +
    counts.passives +
    counts.detractors
  )
}

/** The window of the same length immediately before `periods`. */
function precedingWindow(grain: 'monthly' | 'quarterly', periods: readonly Period[]): Period[] {
  const first = periods[0]
  if (!first) return []

  const step = grain === 'quarterly' ? 3 : 1
  const [year, month] = first.start.split('-').map(Number) as [number, number, number]
  const shifted = new Date(Date.UTC(year, month - 1 - step * periods.length, 1))
  const from = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`

  // One day before the current window starts, so the two never overlap.
  const endOfPrevious = new Date(Date.UTC(year, month - 1, 0))
  const to = endOfPrevious.toISOString().slice(0, 10)

  return periodsInRange(grain, from, to)
}

function periodLabel(period: Period): string {
  const [year, month] = period.start.split('-').map(Number) as [number, number, number]

  if (period.grain === 'quarterly') return `Q${Math.floor((month - 1) / 3) + 1} ${year}`

  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Turns the stored metric rows for one scope into count buckets per period. */
async function rollupCountsByPeriod(
  db: AppDb,
  scopeType: ScopeType,
  scopeId: string,
  periods: readonly Period[],
): Promise<Map<IsoDate, RollupCounts>> {
  if (periods.length === 0) return new Map()

  const starts = periods.map((period) => period.start)
  const grain = periods[0]!.grain

  const rows = await db
    .select({
      periodStart: metricRollups.periodStart,
      metric: metricRollups.metric,
      value: metricRollups.value,
    })
    .from(metricRollups)
    .where(
      and(
        eq(metricRollups.scopeType, scopeType),
        eq(metricRollups.scopeId, scopeId),
        eq(metricRollups.periodGrain, grain),
        inArray(metricRollups.periodStart, starts),
      ),
    )

  const byPeriod = new Map<IsoDate, RollupCounts>()

  for (const row of rows) {
    const current = byPeriod.get(row.periodStart) ?? EMPTY_ROLLUP_COUNTS
    byPeriod.set(row.periodStart, applyMetricRow(current, row.metric, row.value))
  }

  return byPeriod
}

/** Same, but grouped per account — for the leaderboard. */
async function accountCountsInPeriods(
  db: AppDb,
  accountIds: readonly string[],
  periods: readonly Period[],
): Promise<Map<string, RollupCounts>> {
  const rows = await db
    .select({
      scopeId: metricRollups.scopeId,
      metric: metricRollups.metric,
      value: metricRollups.value,
    })
    .from(metricRollups)
    .where(
      and(
        eq(metricRollups.scopeType, 'account'),
        inArray(metricRollups.scopeId, [...accountIds]),
        eq(metricRollups.periodGrain, periods[0]!.grain),
        inArray(
          metricRollups.periodStart,
          periods.map((period) => period.start),
        ),
      ),
    )

  const byAccount = new Map<string, RollupCounts>()

  for (const row of rows) {
    const current = byAccount.get(row.scopeId) ?? EMPTY_ROLLUP_COUNTS
    byAccount.set(row.scopeId, applyMetricRow(current, row.metric, row.value))
  }

  return byAccount
}

/** Pool account-tier rollups into per-period totals (Global scope). */
async function poolAccountRollupsByPeriod(
  db: AppDb,
  accountIds: readonly string[],
  periods: readonly Period[],
): Promise<Map<IsoDate, RollupCounts>> {
  if (periods.length === 0 || accountIds.length === 0) return new Map()

  const starts = periods.map((period) => period.start)
  const grain = periods[0]!.grain

  const rows = await db
    .select({
      periodStart: metricRollups.periodStart,
      metric: metricRollups.metric,
      value: metricRollups.value,
    })
    .from(metricRollups)
    .where(
      and(
        eq(metricRollups.scopeType, 'account'),
        inArray(metricRollups.scopeId, [...accountIds]),
        eq(metricRollups.periodGrain, grain),
        inArray(metricRollups.periodStart, starts),
      ),
    )

  const byPeriod = new Map<IsoDate, RollupCounts>()

  for (const row of rows) {
    const current = byPeriod.get(row.periodStart) ?? EMPTY_ROLLUP_COUNTS
    byPeriod.set(row.periodStart, applyMetricRow(current, row.metric, row.value))
  }

  return byPeriod
}

/** Folds one stored metric row into the count buckets. */
function applyMetricRow(counts: RollupCounts, metric: string, value: string | null): RollupCounts {
  const amount = value === null ? 0 : Number(value)

  const scoreMatch = /^csat_score_([1-5])$/.exec(metric)
  if (scoreMatch) {
    const score = Number(scoreMatch[1]) as 1 | 2 | 3 | 4 | 5

    return {
      ...counts,
      csatScores: { ...counts.csatScores, [score]: counts.csatScores[score] + amount },
    }
  }

  if (metric === 'nps_promoters') return { ...counts, promoters: counts.promoters + amount }
  if (metric === 'nps_passives') return { ...counts, passives: counts.passives + amount }
  if (metric === 'nps_detractors') return { ...counts, detractors: counts.detractors + amount }
  if (metric === 'escalation_count') return { ...counts, escalations: counts.escalations + amount }

  // Derived figures (csat_percent, nps, average_csat...) are recomputed from
  // the buckets, so they are deliberately ignored when reading.
  return counts
}

/**
 * Live compute for a custom range — the §12 exception.
 *
 * Scans `survey_responses` and feeds them to `computeRollupMetrics`, the same
 * function the rollup job uses, so a custom range and a stored period cannot
 * disagree about what a metric means.
 */
async function liveCounts(
  db: AppDb,
  accountIds: readonly string[],
  from: IsoDate,
  to: IsoDate,
): Promise<RollupCounts> {
  const { startAt, endAtExclusive } = periodBoundsUtc({ grain: 'custom', start: from, end: to })

  const rows = await db
    .select({ type: surveyResponses.type, score: surveyResponses.score })
    .from(surveyResponses)
    .where(
      and(
        inArray(surveyResponses.accountId, [...accountIds]),
        isNull(surveyResponses.deletedAt),
        gte(surveyResponses.submittedAt, startAt),
        lt(surveyResponses.submittedAt, endAtExclusive),
      ),
    )

  const responses: MetricResponse[] = rows.map((row) => ({ type: row.type, score: row.score }))
  const metrics = computeRollupMetrics(responses, 0)

  return {
    csatScores: {
      1: metrics.csat_score_1.value ?? 0,
      2: metrics.csat_score_2.value ?? 0,
      3: metrics.csat_score_3.value ?? 0,
      4: metrics.csat_score_4.value ?? 0,
      5: metrics.csat_score_5.value ?? 0,
    },
    promoters: metrics.nps_promoters.value ?? 0,
    passives: metrics.nps_passives.value ?? 0,
    detractors: metrics.nps_detractors.value ?? 0,
    escalations: 0,
  }
}

export type { Scorecard }
