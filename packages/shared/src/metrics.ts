import {
  CSAT_SATISFIED_MIN,
  ERROR_CATEGORIES,
  NPS_DETRACTOR_MAX,
  NPS_PROMOTER_MIN,
  type ActionStatus,
  type ErrorCategory,
  type MetricType,
} from './enums'

/**
 * Metric formulas — SPEC.md §6. The single definition of each metric (§3).
 *
 * Every function here is pure and operates over a flat response set, which is
 * what makes network/agency/account rollups response-weighted by construction
 * (§6 aggregation rule, confirmed decision #3): pooling a scope means passing
 * every underlying response, so a 500-response account moves the agency number
 * more than a 5-response one. There is deliberately no account-weighted variant
 * — §6 leaves that as a later toggle, and a second implementation now would be
 * a second definition to keep in sync.
 *
 * Both the rollup job and any live-compute path must import from here. Do not
 * reimplement any of this in SQL, in a tRPC procedure, or in a component.
 *
 * Naming convention, applied consistently:
 *   *Percent  -> 0..100, rounded to one decimal, for display
 *   *Rate     -> 0..1 ratio, unrounded, for further arithmetic
 *   *Count    -> integer
 *
 * Empty-set convention: rates and percentages return `null`, never 0. "No
 * responses this period" and "0% satisfied" are different facts and must reach
 * the UI as different values. Counts still return 0, because zero things is a
 * true count.
 */

/** The minimum shape a stored response needs for metric computation. */
export interface MetricResponse {
  readonly type: MetricType
  readonly score: number
}

/**
 * Rounds half away from zero at `decimals` places.
 *
 * Math.round alone is wrong twice over here: it breaks ties toward +Infinity
 * (so -0.05 would round to -0.0 while +0.05 rounds to +0.1, skewing negative
 * NPS), and binary floating point makes values like 1.005 scale to
 * 100.49999999999999. Scaling on the absolute value with an epsilon nudge fixes
 * both. Normalises -0 to 0 so equality assertions behave.
 */
function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  const scaled = Math.abs(value) * factor
  const rounded = Math.round(scaled + Number.EPSILON * scaled)
  const result = (Math.sign(value) * rounded) / factor

  return result === 0 ? 0 : result
}

/** CSAT and NPS live in one table; each formula owns its filter. */
function onlyType(responses: readonly MetricResponse[], type: MetricType): MetricResponse[] {
  return responses.filter((response) => response.type === type)
}

// ---------------------------------------------------------------- CSAT / DSAT

/**
 * CSAT % = (responses scoring 4 or 5 / all CSAT responses) x 100, to one
 * decimal (§6). Returns null when the set holds no CSAT responses.
 */
export function csatPercent(responses: readonly MetricResponse[]): number | null {
  const scored = onlyType(responses, 'csat')
  if (scored.length === 0) return null

  const satisfied = scored.filter((response) => response.score >= CSAT_SATISFIED_MIN).length

  return roundTo((satisfied / scored.length) * 100, 1)
}

/**
 * Mean of the raw 1-5 scores — the secondary figure §6 asks for alongside
 * CSAT %. Reported to one decimal.
 */
export function averageCsat(responses: readonly MetricResponse[]): number | null {
  const scored = onlyType(responses, 'csat')
  if (scored.length === 0) return null

  const total = scored.reduce((sum, response) => sum + response.score, 0)

  return roundTo(total / scored.length, 1)
}

/**
 * DSAT count = CSAT responses scoring 1, 2 or 3 (§6).
 *
 * Deliberately derived, never stored: §4.3 defines DSAT as
 * `type=csat AND score<=3`, so there is no dsat column to fall out of date.
 * NPS detractors are a different concept and are not counted here.
 */
export function dsatCount(responses: readonly MetricResponse[]): number {
  return onlyType(responses, 'csat').filter((response) => response.score < CSAT_SATISFIED_MIN)
    .length
}

/** DSAT rate = DSAT count / total CSAT responses, as a 0..1 ratio (§6). */
export function dsatRate(responses: readonly MetricResponse[]): number | null {
  const scored = onlyType(responses, 'csat')
  if (scored.length === 0) return null

  return dsatCount(responses) / scored.length
}

/** The same quantity as `dsatRate`, scaled for display. */
export function dsatPercent(responses: readonly MetricResponse[]): number | null {
  const rate = dsatRate(responses)

  return rate === null ? null : roundTo(rate * 100, 1)
}

export type CsatDistribution = Record<1 | 2 | 3 | 4 | 5, number>

/** Counts per 1-5 score, for the distribution histogram in §9 View 1. */
export function csatDistribution(responses: readonly MetricResponse[]): CsatDistribution {
  const distribution: CsatDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }

  for (const response of onlyType(responses, 'csat')) {
    if (response.score >= 1 && response.score <= 5) {
      const bucket = response.score as 1 | 2 | 3 | 4 | 5
      distribution[bucket] += 1
    }
  }

  return distribution
}

// ------------------------------------------------------------------------ NPS

export interface NpsBreakdown {
  readonly promoters: number
  readonly passives: number
  readonly detractors: number
  readonly total: number
}

/**
 * Splits NPS responses into promoters (9-10), passives (7-8) and detractors
 * (0-6) — §1. Drives the stacked bar in §9 View 1 as well as `npsScore`.
 */
export function npsBreakdown(responses: readonly MetricResponse[]): NpsBreakdown {
  const scored = onlyType(responses, 'nps')

  let promoters = 0
  let detractors = 0

  for (const response of scored) {
    if (response.score >= NPS_PROMOTER_MIN) promoters += 1
    else if (response.score <= NPS_DETRACTOR_MAX) detractors += 1
  }

  return {
    promoters,
    detractors,
    passives: scored.length - promoters - detractors,
    total: scored.length,
  }
}

/**
 * NPS = %promoters - %detractors, range -100..+100 (§6).
 *
 * Passives count in the denominator but contribute to neither term, which is
 * what drags the score toward 0 as they accumulate.
 */
export function npsScore(responses: readonly MetricResponse[]): number | null {
  const { promoters, detractors, total } = npsBreakdown(responses)
  if (total === 0) return null

  return roundTo((promoters / total) * 100 - (detractors / total) * 100, 1)
}

export const NPS_BANDS = [
  'worrisome',
  'needs_improvement',
  'good',
  'excellent',
  'gold_standard',
] as const

export type NpsBand = (typeof NPS_BANDS)[number]

/**
 * Labels an NPS score per the bands in §6.
 *
 * Two things §6 leaves open, resolved here and flagged for confirmation:
 *
 *  1. SPEC GAP — §6 lists "<0 worrisome, 30-50 good, 50-70 excellent, 70+ gold
 *     standard" and never names the 0..30 range. Labelled 'needs_improvement'.
 *  2. BOUNDARY — 50 appears in both "30-50" and "50-70". Bands are treated as
 *     half-open [min, max), so 50 is excellent and 70 is gold standard.
 */
export function npsBand(score: number): NpsBand {
  if (score < 0) return 'worrisome'
  if (score < 30) return 'needs_improvement'
  if (score < 50) return 'good'
  if (score < 70) return 'excellent'

  return 'gold_standard'
}

// ------------------------------------------------------------- RCA and action

export interface CategorisedRca {
  /** Null until a human confirms the category — §11 forbids AI setting it. */
  readonly errorCategory: ErrorCategory | null
}

export interface ErrorCategorySlice {
  readonly count: number
  readonly sharePercent: number | null
}

export type ErrorCategoryDistribution = Record<ErrorCategory, ErrorCategorySlice> & {
  readonly total: number
}

/**
 * Share of RCAs by error category over the period (§6) — the people / process
 * / product pie in §9 View 2.
 *
 * Uncategorised RCAs are excluded from both numerator and denominator, so the
 * slices always sum to 100% of *categorised* RCAs rather than silently
 * shrinking every slice.
 */
export function errorCategoryDistribution(
  rcas: readonly CategorisedRca[],
): ErrorCategoryDistribution {
  const counts: Record<ErrorCategory, number> = { people: 0, process: 0, product: 0 }

  for (const rca of rcas) {
    if (rca.errorCategory !== null) counts[rca.errorCategory] += 1
  }

  const total = ERROR_CATEGORIES.reduce((sum, category) => sum + counts[category], 0)

  return {
    total,
    people: slice(counts.people, total),
    process: slice(counts.process, total),
    product: slice(counts.product, total),
  }
}

function slice(count: number, total: number): ErrorCategorySlice {
  return { count, sharePercent: total === 0 ? null : roundTo((count / total) * 100, 1) }
}

export interface DatedAction {
  readonly status: ActionStatus
  /** Postgres `date`, as an ISO 'YYYY-MM-DD' string. Null when unscheduled. */
  readonly eta: string | null
}

/**
 * Overdue actions = `status != done AND eta < today` (§6).
 *
 * `today` is passed in rather than read from the clock so the function stays
 * pure and testable, and so callers control which timezone "today" means.
 *
 * Comparison is lexicographic on ISO date strings, which is exactly equivalent
 * to date ordering for this format and cannot drift: parsing a Postgres `date`
 * into a JS Date attaches a time and a timezone, shifting the day by one for
 * anyone away from UTC.
 */
export function overdueActionCount(actions: readonly DatedAction[], todayIso: string): number {
  return actions.filter(
    (action) => action.status !== 'done' && action.eta !== null && action.eta < todayIso,
  ).length
}

/** Open actions = anything not yet done (§6, §9 View 2 KPI card). */
export function openActionCount(actions: readonly { status: ActionStatus }[]): number {
  return actions.filter((action) => action.status !== 'done').length
}
