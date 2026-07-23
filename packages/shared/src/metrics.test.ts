import { describe, expect, it } from 'vitest'
import type { MetricResponse } from './metrics'
import {
  averageCsat,
  csatDistribution,
  csatPercent,
  dsatCount,
  dsatPercent,
  dsatRate,
  errorCategoryDistribution,
  npsBand,
  npsBreakdown,
  npsScore,
  overdueActionCount,
} from './metrics'

/** Terse builders so each test reads as the response set it describes. */
const csat = (...scores: number[]): MetricResponse[] =>
  scores.map((score) => ({ type: 'csat', score }))

const nps = (...scores: number[]): MetricResponse[] =>
  scores.map((score) => ({ type: 'nps', score }))

describe('csatPercent', () => {
  it('scores 4 and 5 count as satisfied', () => {
    // 3 of 4 satisfied
    expect(csatPercent(csat(4, 5, 5, 3))).toBe(75)
  })

  it('treats 3 as dissatisfied, not satisfied', () => {
    // The 4/5-vs-1/2/3 split is the core rule in §1. A 3 must not count.
    expect(csatPercent(csat(3, 3, 3, 3))).toBe(0)
    expect(csatPercent(csat(4, 4, 4, 4))).toBe(100)
  })

  it('reports to one decimal place (§6)', () => {
    // 3/7 = 42.857142...
    expect(csatPercent(csat(4, 4, 5, 3, 3, 2, 1))).toBe(42.9)
  })

  it('rounds half away from zero rather than to even', () => {
    // 1/8 = 12.5 exactly at 1dp already; 5/8 = 62.5
    expect(csatPercent(csat(4, 1, 1, 1, 1, 1, 1, 1))).toBe(12.5)
  })

  it('ignores NPS responses mixed into the set', () => {
    // A pooled scope query returns both metric types; each formula filters.
    expect(csatPercent([...csat(4, 5), ...nps(0, 0, 0, 0)])).toBe(100)
  })

  it('returns null for an empty set rather than 0', () => {
    // 0% and "no data" are different facts and must render differently.
    expect(csatPercent([])).toBeNull()
    expect(csatPercent(nps(9, 10))).toBeNull()
  })
})

describe('averageCsat', () => {
  it('is the mean of the 1-5 scores (§6 secondary figure)', () => {
    expect(averageCsat(csat(1, 2, 3, 4, 5))).toBe(3)
    expect(averageCsat(csat(4, 5))).toBe(4.5)
  })

  it('reports to one decimal place', () => {
    // 4/3 = 1.333...
    expect(averageCsat(csat(1, 1, 2))).toBe(1.3)
  })

  it('returns null for an empty set', () => {
    expect(averageCsat([])).toBeNull()
  })
})

describe('dsatCount / dsatRate / dsatPercent', () => {
  it('counts scores 1, 2 and 3 (§6)', () => {
    expect(dsatCount(csat(1, 2, 3, 4, 5))).toBe(3)
  })

  it('counts nothing when every response is satisfied', () => {
    expect(dsatCount(csat(4, 5, 4, 5))).toBe(0)
  })

  it('ignores NPS rows, whose low scores are not DSAT', () => {
    // An NPS 1 is a detractor, not a DSAT. Conflating them would double-count.
    expect(dsatCount([...csat(4, 5), ...nps(0, 1, 2, 3)])).toBe(0)
  })

  it('expresses rate as a 0..1 ratio, exactly as §6 defines it', () => {
    expect(dsatRate(csat(1, 2, 3, 4, 5))).toBeCloseTo(0.6, 10)
    expect(dsatRate(csat(1, 2, 3, 4, 5, 5, 5))).toBeCloseTo(3 / 7, 10)
  })

  it('expresses the same quantity as a 1dp percentage for display', () => {
    expect(dsatPercent(csat(1, 2, 3, 4, 5, 5, 5))).toBe(42.9)
  })

  it('returns null rates for an empty set but a zero count', () => {
    expect(dsatCount([])).toBe(0)
    expect(dsatRate([])).toBeNull()
    expect(dsatPercent([])).toBeNull()
  })

  it('is the exact complement of csatPercent', () => {
    // Every CSAT response is either satisfied or DSAT — no third bucket.
    const set = csat(1, 2, 3, 4, 5, 5, 4, 2)
    expect((csatPercent(set) ?? 0) + (dsatPercent(set) ?? 0)).toBeCloseTo(100, 10)
  })
})

describe('csatDistribution', () => {
  it('counts responses per 1-5 score for the §9 histogram', () => {
    expect(csatDistribution(csat(1, 3, 3, 5, 5, 5))).toEqual({ 1: 1, 2: 0, 3: 2, 4: 0, 5: 3 })
  })

  it('returns all-zero buckets for an empty set', () => {
    expect(csatDistribution([])).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
  })
})

describe('npsBreakdown', () => {
  it('bands 9-10 promoter, 7-8 passive, 0-6 detractor (§1)', () => {
    expect(npsBreakdown(nps(10, 9, 8, 7, 6, 0))).toEqual({
      promoters: 2,
      passives: 2,
      detractors: 2,
      total: 6,
    })
  })

  it('places every boundary score in the right band', () => {
    expect(npsBreakdown(nps(6)).detractors).toBe(1)
    expect(npsBreakdown(nps(7)).passives).toBe(1)
    expect(npsBreakdown(nps(8)).passives).toBe(1)
    expect(npsBreakdown(nps(9)).promoters).toBe(1)
  })
})

describe('npsScore', () => {
  it('is %promoters minus %detractors (§6)', () => {
    // 3 promoters, 2 passives, 2 detractors of 7:
    // 42.857 - 28.571 = 14.286
    expect(npsScore(nps(10, 10, 9, 8, 7, 6, 0))).toBe(14.3)
  })

  it('counts passives in the base but not the numerator', () => {
    // 1 promoter, 8 passives, 1 detractor => 10% - 10% = 0, not 0% - 0%.
    expect(npsScore(nps(10, 7, 7, 7, 7, 8, 8, 8, 8, 0))).toBe(0)
  })

  it('reaches +100 when every respondent promotes', () => {
    expect(npsScore(nps(9, 10, 10))).toBe(100)
  })

  it('reaches -100 when every respondent detracts', () => {
    expect(npsScore(nps(0, 3, 6))).toBe(-100)
  })

  it('is 0 when every respondent is passive', () => {
    expect(npsScore(nps(7, 8, 7, 8))).toBe(0)
  })

  it('ignores CSAT responses mixed into the set', () => {
    expect(npsScore([...nps(9, 10), ...csat(1, 1, 1)])).toBe(100)
  })

  it('returns null for an empty set rather than 0', () => {
    // 0 is a meaningful NPS (all passive); "no data" is not 0.
    expect(npsScore([])).toBeNull()
    expect(npsScore(csat(4, 5))).toBeNull()
  })
})

describe('npsBand', () => {
  it('labels negative scores worrisome (§6)', () => {
    expect(npsBand(-100)).toBe('worrisome')
    expect(npsBand(-0.1)).toBe('worrisome')
  })

  it('labels 30 to 50 good, inclusive of 30', () => {
    expect(npsBand(30)).toBe('good')
    expect(npsBand(49.9)).toBe('good')
  })

  it('labels 50 to 70 excellent, resolving the boundary upward', () => {
    // §6 writes the ranges as "30-50 good, 50-70 excellent" — 50 is listed in
    // both. Resolved so each band is half-open [min, max) and 50 is excellent.
    expect(npsBand(50)).toBe('excellent')
    expect(npsBand(69.9)).toBe('excellent')
  })

  it('labels 70 and above gold standard', () => {
    expect(npsBand(70)).toBe('gold_standard')
    expect(npsBand(100)).toBe('gold_standard')
  })

  it('labels the 0-30 range §6 leaves unnamed', () => {
    // SPEC GAP: §6 lists "<0 worrisome, 30-50 good, 50-70 excellent, 70+ gold
    // standard" and never names 0..30. Filled in as 'needs_improvement'
    // pending confirmation — see README.
    expect(npsBand(0)).toBe('needs_improvement')
    expect(npsBand(29.9)).toBe('needs_improvement')
  })
})

describe('response-weighted pooling (§6, decision #3)', () => {
  it('pools CSAT over underlying responses, not over per-account averages', () => {
    // Account A: 90 responses, all satisfied. Account B: 10, all dissatisfied.
    // Response-weighted  = 90/100          = 90.0  <-- confirmed behaviour
    // Account-weighted   = (100 + 0) / 2   = 50.0  <-- explicitly NOT this
    const accountA = csat(...Array<number>(90).fill(5))
    const accountB = csat(...Array<number>(10).fill(1))

    expect(csatPercent([...accountA, ...accountB])).toBe(90)
  })

  it('pools NPS over underlying responses too', () => {
    // A: 80 promoters. B: 20 detractors.
    // Response-weighted = 80% - 20% = 60. Account-weighted mean would be 0.
    const accountA = nps(...Array<number>(80).fill(10))
    const accountB = nps(...Array<number>(20).fill(0))

    expect(npsScore([...accountA, ...accountB])).toBe(60)
  })

  it('is associative across scope levels, so agency equals sum of accounts', () => {
    // Rolling network = pool(agency sets) must equal pool(all account sets).
    const a = csat(5, 5, 4, 1)
    const b = csat(4, 2)
    const c = csat(5, 3, 3)

    expect(csatPercent([...a, ...b, ...c])).toBe(csatPercent([...[...a, ...b], ...c]))
  })
})

describe('errorCategoryDistribution', () => {
  it('shares out RCAs by error category for the §9 pie', () => {
    const result = errorCategoryDistribution([
      { errorCategory: 'people' },
      { errorCategory: 'people' },
      { errorCategory: 'process' },
      { errorCategory: 'product' },
    ])

    expect(result.total).toBe(4)
    expect(result.people).toEqual({ count: 2, sharePercent: 50 })
    expect(result.process).toEqual({ count: 1, sharePercent: 25 })
    expect(result.product).toEqual({ count: 1, sharePercent: 25 })
  })

  it('ignores RCAs whose category is not yet set', () => {
    // error_category is nullable until the author confirms it (§11 guardrail:
    // AI suggests, a human sets). Uncategorised RCAs must not skew the split.
    const result = errorCategoryDistribution([
      { errorCategory: 'people' },
      { errorCategory: null },
      { errorCategory: null },
    ])

    expect(result.total).toBe(1)
    expect(result.people.sharePercent).toBe(100)
  })

  it('returns zero counts and null shares when there are no categorised RCAs', () => {
    const result = errorCategoryDistribution([])

    expect(result.total).toBe(0)
    expect(result.people).toEqual({ count: 0, sharePercent: null })
  })
})

describe('overdueActionCount', () => {
  const asOf = '2026-07-20'

  it('counts unfinished items whose ETA has passed (§6)', () => {
    const count = overdueActionCount(
      [
        { status: 'open', eta: '2026-07-19' },
        { status: 'in_progress', eta: '2026-01-01' },
        { status: 'blocked', eta: '2026-07-19' },
      ],
      asOf,
    )

    expect(count).toBe(3)
  })

  it('never counts done items, however old the ETA', () => {
    expect(overdueActionCount([{ status: 'done', eta: '2020-01-01' }], asOf)).toBe(0)
  })

  it('treats an ETA of today as not yet overdue', () => {
    // §6 says `eta < today` — strictly before, so today still has time to run.
    expect(overdueActionCount([{ status: 'open', eta: asOf }], asOf)).toBe(0)
  })

  it('does not count items with no ETA set', () => {
    expect(overdueActionCount([{ status: 'open', eta: null }], asOf)).toBe(0)
  })

  it('compares dates as ISO strings, immune to timezone drift', () => {
    // eta is a Postgres `date`. Parsing to a JS Date would shift the day for
    // anyone east or west of UTC; lexicographic ISO comparison cannot.
    expect(overdueActionCount([{ status: 'open', eta: '2026-07-19' }], '2026-07-20')).toBe(1)
    expect(overdueActionCount([{ status: 'open', eta: '2026-07-21' }], '2026-07-20')).toBe(0)
  })
})
