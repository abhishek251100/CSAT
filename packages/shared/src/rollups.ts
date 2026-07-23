import {
  averageCsat,
  csatDistribution,
  csatPercent,
  dsatCount,
  npsBreakdown,
  npsScore,
  type MetricResponse,
} from './metrics'

/**
 * Rollup composition — SPEC.md §4.3 (`metric_rollups`), §6, §12.
 *
 * §4.3: "Precomputed CSAT %, NPS, DSAT count, escalation count, response count
 * per scope per period. Dashboards read this, not raw responses."
 *
 * This module decides *what a rollup contains*; it computes nothing itself.
 * Every number comes from the metric functions in `metrics.ts`, so the stored
 * rollup and any live-compute path cannot disagree (§3: one definition of each
 * metric). If a formula needs changing, it changes there and only there.
 */

/**
 * Metric keys, in two groups.
 *
 * The derived figures (csat_percent, nps, average_csat) are what the trend
 * lines plot, one point per period.
 *
 * The count buckets (csat_score_*, nps_promoters/passives/detractors) exist so
 * rollups **compose across periods**. A CSAT % for Jan-Jun is not the mean of
 * six monthly percentages — that would weight a 5-response month equally with a
 * 500-response one, contradicting §6's response-weighted rule. Summing the
 * buckets and recomputing gives the correct pooled figure, and it also feeds
 * the §9 distribution histogram and promoters/passives/detractors bar directly
 * from rollups rather than from a raw scan (§12).
 */
export const METRIC_KEYS = [
  'csat_percent',
  'average_csat',
  'dsat_count',
  'nps',
  'response_count',
  'escalation_count',
  'csat_score_1',
  'csat_score_2',
  'csat_score_3',
  'csat_score_4',
  'csat_score_5',
  'nps_promoters',
  'nps_passives',
  'nps_detractors',
] as const

export type MetricKey = (typeof METRIC_KEYS)[number]

export interface RollupValue {
  /**
   * Null means "no data for this period", never zero. §6's empty-set
   * convention runs all the way to the database: `metric_rollups.value` is
   * nullable for exactly this reason, so a quiet month reaches the KPI card as
   * "no data" rather than a false 0%.
   */
  readonly value: number | null
  /**
   * The denominator this metric was computed over — CSAT responses for CSAT
   * metrics, NPS responses for NPS, and so on. Per-metric rather than
   * per-period, which is what makes `dsat_count / sample_size` a valid DSAT
   * rate at read time without storing a redundant metric.
   */
  readonly sampleSize: number
}

export type RollupMetrics = Record<MetricKey, RollupValue>

/**
 * Builds the full metric set for one scope and one period.
 *
 * `responses` must be every response in the period for every account in the
 * scope. That is what makes network and agency figures response-weighted
 * (§6 aggregation rule, confirmed decision #3): pooling is just passing more
 * responses, so a 500-response account moves the agency number more than a
 * 5-response one, with no separate weighting logic to keep correct.
 */
export function computeRollupMetrics(
  responses: readonly MetricResponse[],
  escalationCount: number,
): RollupMetrics {
  const csatResponses = responses.filter((response) => response.type === 'csat')
  const npsResponses = responses.filter((response) => response.type === 'nps')

  const distribution = csatDistribution(responses)
  const bands = npsBreakdown(responses)

  const count = (value: number, sampleSize: number): RollupValue => ({ value, sampleSize })

  return {
    csat_percent: { value: csatPercent(responses), sampleSize: csatResponses.length },
    average_csat: { value: averageCsat(responses), sampleSize: csatResponses.length },
    /**
     * A count, so it is 0 rather than null on an empty set — zero
     * dissatisfied responses is a true statement, unlike "0% satisfied".
     * `sampleSize` still distinguishes "0 of 40" from "0 of 0".
     */
    dsat_count: { value: dsatCount(responses), sampleSize: csatResponses.length },
    nps: { value: npsScore(responses), sampleSize: npsResponses.length },
    response_count: { value: responses.length, sampleSize: responses.length },
    escalation_count: { value: escalationCount, sampleSize: escalationCount },

    csat_score_1: count(distribution[1], csatResponses.length),
    csat_score_2: count(distribution[2], csatResponses.length),
    csat_score_3: count(distribution[3], csatResponses.length),
    csat_score_4: count(distribution[4], csatResponses.length),
    csat_score_5: count(distribution[5], csatResponses.length),

    nps_promoters: count(bands.promoters, bands.total),
    nps_passives: count(bands.passives, bands.total),
    nps_detractors: count(bands.detractors, bands.total),
  }
}

/** The count buckets summed over one or more periods. */
export interface RollupCounts {
  readonly csatScores: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>
  readonly promoters: number
  readonly passives: number
  readonly detractors: number
  readonly escalations: number
}

export const EMPTY_ROLLUP_COUNTS: RollupCounts = {
  csatScores: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  promoters: 0,
  passives: 0,
  detractors: 0,
  escalations: 0,
}

/** Adds two count sets — how a multi-period window is pooled. */
export function addRollupCounts(left: RollupCounts, right: RollupCounts): RollupCounts {
  return {
    csatScores: {
      1: left.csatScores[1] + right.csatScores[1],
      2: left.csatScores[2] + right.csatScores[2],
      3: left.csatScores[3] + right.csatScores[3],
      4: left.csatScores[4] + right.csatScores[4],
      5: left.csatScores[5] + right.csatScores[5],
    },
    promoters: left.promoters + right.promoters,
    passives: left.passives + right.passives,
    detractors: left.detractors + right.detractors,
    escalations: left.escalations + right.escalations,
  }
}

/**
 * Rebuilds a response set equivalent to the one the counts came from.
 *
 * This is what lets a pooled window reuse the §6 formulas verbatim instead of
 * growing a second, count-based implementation of each metric — the exact drift
 * §3 forbids.
 *
 * It is exact, not an approximation. CSAT scores are integers 1-5 and stored
 * per score, so the reconstruction is the original multiset. NPS is stored per
 * band, and `npsScore` depends only on band counts, so any representative score
 * within each band (10 / 8 / 0) yields the identical result.
 */
export function expandRollupCounts(counts: RollupCounts): MetricResponse[] {
  const responses: MetricResponse[] = []

  for (const score of [1, 2, 3, 4, 5] as const) {
    for (let index = 0; index < counts.csatScores[score]; index += 1) {
      responses.push({ type: 'csat', score })
    }
  }

  const pushNps = (times: number, score: number) => {
    for (let index = 0; index < times; index += 1) responses.push({ type: 'nps', score })
  }

  pushNps(counts.promoters, 10)
  pushNps(counts.passives, 8)
  pushNps(counts.detractors, 0)

  return responses
}

/**
 * The headline figures for a window, pooled response-weighted from its counts.
 *
 * Every value is produced by the §6 metric functions via `expandRollupCounts`,
 * so a KPI card covering six months and a trend point covering one use the same
 * definitions.
 */
export interface Scorecard {
  readonly csatPercent: number | null
  readonly averageCsat: number | null
  readonly dsatCount: number
  readonly dsatRate: number | null
  readonly nps: number | null
  readonly csatResponseCount: number
  readonly npsResponseCount: number
  readonly responseCount: number
  readonly escalationCount: number
  readonly distribution: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>
  readonly promoters: number
  readonly passives: number
  readonly detractors: number
}

export function composeScorecard(counts: RollupCounts): Scorecard {
  const responses = expandRollupCounts(counts)
  const csatResponseCount = [1, 2, 3, 4, 5].reduce(
    (total, score) => total + counts.csatScores[score as 1 | 2 | 3 | 4 | 5],
    0,
  )
  const npsResponseCount = counts.promoters + counts.passives + counts.detractors
  const dsat = dsatCount(responses)

  return {
    csatPercent: csatPercent(responses),
    averageCsat: averageCsat(responses),
    dsatCount: dsat,
    dsatRate: csatResponseCount === 0 ? null : dsat / csatResponseCount,
    nps: npsScore(responses),
    csatResponseCount,
    npsResponseCount,
    responseCount: csatResponseCount + npsResponseCount,
    escalationCount: counts.escalations,
    distribution: counts.csatScores,
    promoters: counts.promoters,
    passives: counts.passives,
    detractors: counts.detractors,
  }
}

/**
 * Period-over-period delta, or null when either side has no data.
 *
 * Returning null rather than treating a missing figure as 0 keeps "improved
 * from nothing" out of the UI — a first month of data is not a +75 point gain.
 */
export function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null

  return Math.round((current - previous) * 10) / 10
}
