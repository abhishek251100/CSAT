import { describe, expect, it } from 'vitest'
import {
  currentAndPreviousPeriods,
  monthlyPeriodFor,
  periodBoundsUtc,
  periodContains,
  periodFor,
  periodsFor,
  periodsInRange,
  nextPeriod,
  previousPeriod,
  quarterlyPeriodFor,
} from './periods'

describe('monthlyPeriodFor', () => {
  it('spans the whole calendar month', () => {
    expect(monthlyPeriodFor('2026-07-21')).toEqual({
      grain: 'monthly',
      start: '2026-07-01',
      end: '2026-07-31',
    })
  })

  it('handles 30-day months', () => {
    expect(monthlyPeriodFor('2026-06-15').end).toBe('2026-06-30')
  })

  it('handles February in a common year', () => {
    expect(monthlyPeriodFor('2026-02-10').end).toBe('2026-02-28')
  })

  it('handles February in a leap year', () => {
    expect(monthlyPeriodFor('2028-02-10').end).toBe('2028-02-29')
  })

  it('is stable on the first and last day of the month', () => {
    expect(monthlyPeriodFor('2026-07-01')).toEqual(monthlyPeriodFor('2026-07-31'))
  })
})

describe('quarterlyPeriodFor', () => {
  it('buckets each month into the right quarter', () => {
    expect(quarterlyPeriodFor('2026-01-15')).toMatchObject({
      start: '2026-01-01',
      end: '2026-03-31',
    })
    expect(quarterlyPeriodFor('2026-04-15')).toMatchObject({
      start: '2026-04-01',
      end: '2026-06-30',
    })
    expect(quarterlyPeriodFor('2026-07-15')).toMatchObject({
      start: '2026-07-01',
      end: '2026-09-30',
    })
    expect(quarterlyPeriodFor('2026-10-15')).toMatchObject({
      start: '2026-10-01',
      end: '2026-12-31',
    })
  })

  it('puts quarter-boundary months on the correct side', () => {
    expect(quarterlyPeriodFor('2026-03-31').start).toBe('2026-01-01')
    expect(quarterlyPeriodFor('2026-04-01').start).toBe('2026-04-01')
  })
})

describe('previousPeriod', () => {
  it('steps back one month', () => {
    expect(previousPeriod(monthlyPeriodFor('2026-07-21'))).toMatchObject({
      start: '2026-06-01',
      end: '2026-06-30',
    })
  })

  it('crosses the year boundary backwards', () => {
    expect(previousPeriod(monthlyPeriodFor('2026-01-15'))).toMatchObject({
      start: '2025-12-01',
      end: '2025-12-31',
    })
  })

  it('steps back one quarter', () => {
    expect(previousPeriod(quarterlyPeriodFor('2026-07-15'))).toMatchObject({
      start: '2026-04-01',
      end: '2026-06-30',
    })
  })

  it('crosses the year boundary backwards by quarter', () => {
    expect(previousPeriod(quarterlyPeriodFor('2026-02-15'))).toMatchObject({
      start: '2025-10-01',
      end: '2025-12-31',
    })
  })

  it('lands on February correctly when stepping back from March', () => {
    expect(previousPeriod(monthlyPeriodFor('2028-03-15')).end).toBe('2028-02-29')
  })
})

describe('UTC safety', () => {
  it('buckets a late-evening UTC instant into that same UTC day', () => {
    // 23:30 UTC on 31 July is still July. A local-time reading east of
    // Greenwich would file it into August.
    expect(monthlyPeriodFor(new Date('2026-07-31T23:30:00.000Z')).start).toBe('2026-07-01')
  })

  it('buckets an early-morning UTC instant into that same UTC day', () => {
    // 00:30 UTC on 1 August is August; a local reading west of Greenwich would
    // file it into July.
    expect(monthlyPeriodFor(new Date('2026-08-01T00:30:00.000Z')).start).toBe('2026-08-01')
  })

  it('reads a Date and its ISO string identically', () => {
    const instant = new Date('2026-07-21T13:45:00.000Z')

    expect(monthlyPeriodFor(instant)).toEqual(monthlyPeriodFor('2026-07-21'))
  })

  it('rejects a malformed date string rather than guessing', () => {
    expect(() => monthlyPeriodFor('21/07/2026')).toThrow(/ISO date/)
  })

  it('rejects an invalid Date', () => {
    expect(() => monthlyPeriodFor(new Date('nonsense'))).toThrow(/invalid Date/i)
  })
})

describe('periodBoundsUtc', () => {
  it('returns a half-open range covering the whole period', () => {
    const bounds = periodBoundsUtc(monthlyPeriodFor('2026-07-15'))

    expect(bounds.startAt.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(bounds.endAtExclusive.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })

  it('includes the final millisecond of the last day', () => {
    const bounds = periodBoundsUtc(monthlyPeriodFor('2026-07-15'))
    const lastInstant = new Date('2026-07-31T23:59:59.999Z')

    expect(lastInstant >= bounds.startAt).toBe(true)
    expect(lastInstant < bounds.endAtExclusive).toBe(true)
  })

  it('excludes the first instant of the next period', () => {
    const bounds = periodBoundsUtc(monthlyPeriodFor('2026-07-15'))

    expect(new Date('2026-08-01T00:00:00.000Z') < bounds.endAtExclusive).toBe(false)
  })

  it('crosses the year boundary for December', () => {
    const bounds = periodBoundsUtc(monthlyPeriodFor('2026-12-10'))

    expect(bounds.endAtExclusive.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('periodContains', () => {
  const july = monthlyPeriodFor('2026-07-15')

  it('includes both endpoints', () => {
    expect(periodContains(july, '2026-07-01')).toBe(true)
    expect(periodContains(july, '2026-07-31')).toBe(true)
  })

  it('excludes the days either side', () => {
    expect(periodContains(july, '2026-06-30')).toBe(false)
    expect(periodContains(july, '2026-08-01')).toBe(false)
  })
})

describe('periodFor', () => {
  it('dispatches on grain', () => {
    expect(periodFor('monthly', '2026-07-15').grain).toBe('monthly')
    expect(periodFor('quarterly', '2026-07-15').grain).toBe('quarterly')
  })

  it('refuses to invent a custom period', () => {
    // A custom range is supplied by the caller; deriving one would be a guess.
    expect(() => periodFor('custom', '2026-07-15')).toThrow(/custom/)
  })
})

describe('periodsInRange', () => {
  it('returns every month overlapping the range', () => {
    const periods = periodsInRange('monthly', '2026-01-15', '2026-03-15')

    expect(periods.map((period) => period.start)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ])
  })

  it('includes boundary periods whole rather than clipping them', () => {
    // A partial month is still that month; clipping would produce a figure that
    // disagrees with the stored rollup for the same period.
    const periods = periodsInRange('monthly', '2026-01-31', '2026-02-01')

    expect(periods.map((period) => period.start)).toEqual(['2026-01-01', '2026-02-01'])
  })

  it('returns a single period when both ends fall inside one', () => {
    expect(periodsInRange('monthly', '2026-07-02', '2026-07-28')).toHaveLength(1)
  })

  it('walks quarters', () => {
    const periods = periodsInRange('quarterly', '2026-02-01', '2026-11-01')

    expect(periods.map((period) => period.start)).toEqual([
      '2026-01-01',
      '2026-04-01',
      '2026-07-01',
      '2026-10-01',
    ])
  })

  it('crosses a year boundary', () => {
    const periods = periodsInRange('monthly', '2025-11-15', '2026-02-15')

    expect(periods.map((period) => period.start)).toEqual([
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ])
  })

  it('returns nothing for an inverted range rather than looping', () => {
    expect(periodsInRange('monthly', '2026-07-01', '2026-01-01')).toEqual([])
  })

  it('caps a runaway range instead of scanning unbounded', () => {
    const periods = periodsInRange('monthly', '1990-01-01', '2026-01-01')

    expect(periods).toHaveLength(120)
  })
})

describe('nextPeriod', () => {
  it('steps forward a month, crossing the year', () => {
    expect(nextPeriod(monthlyPeriodFor('2026-12-10')).start).toBe('2027-01-01')
  })

  it('steps forward a quarter', () => {
    expect(nextPeriod(quarterlyPeriodFor('2026-10-10')).start).toBe('2027-01-01')
  })

  it('round-trips with previousPeriod', () => {
    const july = monthlyPeriodFor('2026-07-15')

    expect(previousPeriod(nextPeriod(july))).toEqual(july)
  })
})

describe('periodsFor / currentAndPreviousPeriods', () => {
  it('returns both grains containing an instant', () => {
    const periods = periodsFor('2026-07-21')

    expect(periods.map((period) => period.grain)).toEqual(['monthly', 'quarterly'])
  })

  it('returns current and previous at both grains — the cron working set', () => {
    const periods = currentAndPreviousPeriods('2026-07-21')

    expect(periods).toHaveLength(4)
    expect(periods.map((period) => `${period.grain}:${period.start}`)).toEqual([
      'monthly:2026-07-01',
      'monthly:2026-06-01',
      'quarterly:2026-07-01',
      'quarterly:2026-04-01',
    ])
  })
})
