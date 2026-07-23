import type { PeriodGrain } from './enums'

/**
 * Period arithmetic — SPEC.md §6 ("Time grains: monthly (CSAT), quarterly
 * (NPS), plus custom range. A period selector drives every view").
 *
 * Everything here is pure and works on calendar components, never on a parsed
 * local-time Date. A Postgres `date` rendered through a local-timezone Date
 * shifts by a day for anyone away from UTC, which would silently file a
 * response into the wrong month — the kind of error that only shows up as a
 * number nobody can reconcile.
 *
 * Dates are ISO 'YYYY-MM-DD' strings throughout, matching the `date` columns in
 * §4.3 and the convention already used by `overdueActionCount`.
 */

/** An ISO calendar date, 'YYYY-MM-DD'. */
export type IsoDate = string

export interface Period {
  readonly grain: PeriodGrain
  readonly start: IsoDate
  /** Inclusive last day of the period. */
  readonly end: IsoDate
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

function isoDate(year: number, month: number, day: number): IsoDate {
  return `${year}-${pad(month)}-${pad(day)}`
}

/** Calendar year and 1-12 month, read in UTC. */
function partsOf(value: Date | IsoDate): { year: number; month: number; day: number } {
  if (typeof value === 'string') {
    const match = ISO_DATE.exec(value)

    if (!match) {
      throw new Error(`Expected an ISO date such as 2026-07-21, received: ${value}`)
    }

    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  }

  if (Number.isNaN(value.getTime())) {
    throw new Error('Received an invalid Date')
  }

  // UTC accessors, deliberately: §12 stores timestamps in UTC and localises
  // only in the UI. Using local accessors here would bucket a 23:30 UTC
  // response into the next month for anyone east of Greenwich.
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() }
}

/** Last calendar day of a month — day 0 of the next month, in UTC. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** The calendar month containing `value`. */
export function monthlyPeriodFor(value: Date | IsoDate): Period {
  const { year, month } = partsOf(value)

  return {
    grain: 'monthly',
    start: isoDate(year, month, 1),
    end: isoDate(year, month, lastDayOfMonth(year, month)),
  }
}

/** The calendar quarter containing `value`. Q1 Jan-Mar through Q4 Oct-Dec. */
export function quarterlyPeriodFor(value: Date | IsoDate): Period {
  const { year, month } = partsOf(value)
  const firstMonth = Math.floor((month - 1) / 3) * 3 + 1
  const lastMonth = firstMonth + 2

  return {
    grain: 'quarterly',
    start: isoDate(year, firstMonth, 1),
    end: isoDate(year, lastMonth, lastDayOfMonth(year, lastMonth)),
  }
}

/**
 * The period of the given grain containing `value`.
 *
 * 'custom' has no natural containing period — a custom range is supplied by the
 * caller, not derived — so it is rejected rather than silently treated as a
 * month.
 */
export function periodFor(grain: PeriodGrain, value: Date | IsoDate): Period {
  if (grain === 'monthly') return monthlyPeriodFor(value)
  if (grain === 'quarterly') return quarterlyPeriodFor(value)

  throw new Error(
    'periodFor cannot derive a custom period. Supply the range explicitly for grain "custom".',
  )
}

/**
 * The period immediately before this one — what §4.3 means by "recomputes the
 * current and previous period".
 */
export function previousPeriod(period: Period): Period {
  const { year, month } = partsOf(period.start)

  if (period.grain === 'monthly') {
    // Date.UTC normalises month 0 into December of the prior year.
    const previous = new Date(Date.UTC(year, month - 2, 1))

    return monthlyPeriodFor(isoDate(previous.getUTCFullYear(), previous.getUTCMonth() + 1, 1))
  }

  if (period.grain === 'quarterly') {
    const previous = new Date(Date.UTC(year, month - 4, 1))

    return quarterlyPeriodFor(isoDate(previous.getUTCFullYear(), previous.getUTCMonth() + 1, 1))
  }

  throw new Error('previousPeriod is undefined for grain "custom".')
}

/**
 * Half-open UTC instant bounds for querying `submitted_at timestamptz`.
 *
 * Returns `[startAt, endAtExclusive)` rather than an inclusive end so a response
 * submitted at 23:59:59.999 on the last day is included without depending on
 * millisecond precision.
 */
export function periodBoundsUtc(period: Period): { startAt: Date; endAtExclusive: Date } {
  const end = partsOf(period.end)

  return {
    startAt: new Date(`${period.start}T00:00:00.000Z`),
    endAtExclusive: new Date(Date.UTC(end.year, end.month - 1, end.day + 1)),
  }
}

/** Does this period contain the given instant or date? */
export function periodContains(period: Period, value: Date | IsoDate): boolean {
  const { year, month, day } = partsOf(value)
  const candidate = isoDate(year, month, day)

  return candidate >= period.start && candidate <= period.end
}

/**
 * Both grains containing an instant.
 *
 * A single response updates both its month and its quarter: §6 reports CSAT
 * monthly and NPS quarterly, but §9's period selector lets either metric be
 * viewed at either grain, so both rollup rows must stay current.
 */
export function periodsFor(value: Date | IsoDate): Period[] {
  return [monthlyPeriodFor(value), quarterlyPeriodFor(value)]
}

/** Current and previous period at both grains — the cron's working set. */
export function currentAndPreviousPeriods(now: Date | IsoDate): Period[] {
  return periodsFor(now).flatMap((period) => [period, previousPeriod(period)])
}

/** The next period of the same grain. */
export function nextPeriod(period: Period): Period {
  const { year, month } = partsOf(period.start)
  const step = period.grain === 'quarterly' ? 3 : 1

  if (period.grain === 'custom') {
    throw new Error('nextPeriod is undefined for grain "custom".')
  }

  const next = new Date(Date.UTC(year, month - 1 + step, 1))
  const asDate = isoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, 1)

  return period.grain === 'quarterly' ? quarterlyPeriodFor(asDate) : monthlyPeriodFor(asDate)
}

/**
 * Every period of the given grain that overlaps [from, to] — the buckets a
 * trend line plots (§9).
 *
 * Boundary periods are included whole: selecting 15 Jan to 15 Mar at monthly
 * grain yields January, February and March. A partial month is still that
 * month, and clipping it would produce a figure that silently disagrees with
 * the stored rollup for the same period.
 *
 * Capped at 120 buckets. A 10-year monthly span is already past what a trend
 * line can render legibly, and the cap stops a malformed range turning into an
 * unbounded query.
 */
export function periodsInRange(
  grain: Exclude<PeriodGrain, 'custom'>,
  from: Date | IsoDate,
  to: Date | IsoDate,
): Period[] {
  const first = periodFor(grain, from)
  const last = periodFor(grain, to)

  if (last.start < first.start) return []

  const periods: Period[] = []
  let cursor = first

  while (cursor.start <= last.start && periods.length < 120) {
    periods.push(cursor)
    cursor = nextPeriod(cursor)
  }

  return periods
}
