import { describe, expect, it } from 'vitest'
import { csatPercent, npsScore, type MetricResponse } from './metrics'
import {
  addRollupCounts,
  composeScorecard,
  computeRollupMetrics,
  delta,
  EMPTY_ROLLUP_COUNTS,
  expandRollupCounts,
  METRIC_KEYS,
  type RollupCounts,
} from './rollups'

const csat = (...scores: number[]): MetricResponse[] =>
  scores.map((score) => ({ type: 'csat', score }))

const nps = (...scores: number[]): MetricResponse[] =>
  scores.map((score) => ({ type: 'nps', score }))

describe('computeRollupMetrics', () => {
  const metrics = computeRollupMetrics([...csat(5, 5, 4, 3, 1), ...nps(10, 9, 8, 6)], 2)

  it('produces a value for every declared key', () => {
    for (const key of METRIC_KEYS) {
      expect(metrics[key], `${key} should be present`).toBeDefined()
    }
  })

  it('stores the derived figures the trend lines plot', () => {
    // 3 of 5 satisfied = 60.0
    expect(metrics.csat_percent).toEqual({ value: 60, sampleSize: 5 })
    // 2 promoters, 1 passive, 1 detractor of 4: 50 - 25 = 25.0
    expect(metrics.nps).toEqual({ value: 25, sampleSize: 4 })
    expect(metrics.dsat_count).toEqual({ value: 2, sampleSize: 5 })
  })

  it('stores the CSAT distribution buckets', () => {
    expect(metrics.csat_score_1.value).toBe(1)
    expect(metrics.csat_score_2.value).toBe(0)
    expect(metrics.csat_score_3.value).toBe(1)
    expect(metrics.csat_score_4.value).toBe(1)
    expect(metrics.csat_score_5.value).toBe(2)
  })

  it('stores the NPS band buckets', () => {
    expect(metrics.nps_promoters.value).toBe(2)
    expect(metrics.nps_passives.value).toBe(1)
    expect(metrics.nps_detractors.value).toBe(1)
  })

  it('keeps buckets summing to their sample size', () => {
    const csatBuckets = [1, 2, 3, 4, 5].reduce(
      (total, score) => total + (metrics[`csat_score_${score}` as 'csat_score_1'].value ?? 0),
      0,
    )

    expect(csatBuckets).toBe(metrics.csat_percent.sampleSize)
  })
})

describe('expandRollupCounts reconstructs an equivalent response set', () => {
  it('rebuilds the exact CSAT multiset', () => {
    const original = csat(1, 3, 5, 5, 4)
    const counts = countsFrom(original)

    const rebuilt = expandRollupCounts(counts).filter((r) => r.type === 'csat')

    expect(rebuilt.map((r) => r.score).sort()).toEqual([1, 3, 4, 5, 5])
  })

  it('yields an identical CSAT % after a round trip', () => {
    const original = csat(5, 5, 4, 3, 2, 1)

    expect(csatPercent(expandRollupCounts(countsFrom(original)))).toBe(csatPercent(original))
  })

  it('yields an identical NPS after a round trip, despite storing only bands', () => {
    // npsScore depends only on band counts, so any representative score inside
    // each band reproduces it exactly.
    const original = nps(10, 9, 8, 7, 6, 3, 0)

    expect(npsScore(expandRollupCounts(countsFrom(original)))).toBe(npsScore(original))
  })

  it('returns nothing for empty counts', () => {
    expect(expandRollupCounts(EMPTY_ROLLUP_COUNTS)).toEqual([])
  })
})

describe('composeScorecard pools a window response-weighted (§6, decision #3)', () => {
  it('pools two periods by summing counts, not averaging percentages', () => {
    // January: 90 responses, all satisfied  -> 100.0
    // February: 10 responses, none satisfied ->   0.0
    // Mean of percentages = 50.0. Response-weighted = 90/100 = 90.0
    const january = countsFrom(csat(...Array<number>(90).fill(5)))
    const february = countsFrom(csat(...Array<number>(10).fill(1)))

    const pooled = composeScorecard(addRollupCounts(january, february))

    expect(pooled.csatPercent).toBe(90)
    expect(pooled.csatPercent).not.toBe(50)
    expect(pooled.csatResponseCount).toBe(100)
  })

  it('pools NPS the same way', () => {
    const q1 = countsFrom(nps(...Array<number>(80).fill(10)))
    const q2 = countsFrom(nps(...Array<number>(20).fill(0)))

    expect(composeScorecard(addRollupCounts(q1, q2)).nps).toBe(60)
  })

  it('is associative, so period order cannot change the result', () => {
    const a = countsFrom(csat(5, 4, 1))
    const b = countsFrom(csat(2, 5))
    const c = countsFrom(csat(3, 5, 5))

    const left = composeScorecard(addRollupCounts(addRollupCounts(a, b), c))
    const right = composeScorecard(addRollupCounts(a, addRollupCounts(b, c)))

    expect(left).toEqual(right)
  })

  it('derives DSAT rate from the pooled counts', () => {
    const pooled = composeScorecard(countsFrom(csat(1, 2, 3, 4, 5)))

    expect(pooled.dsatCount).toBe(3)
    expect(pooled.dsatRate).toBeCloseTo(0.6, 10)
  })

  it('reports nulls, not zeroes, for an empty window', () => {
    const empty = composeScorecard(EMPTY_ROLLUP_COUNTS)

    expect(empty.csatPercent).toBeNull()
    expect(empty.nps).toBeNull()
    expect(empty.averageCsat).toBeNull()
    expect(empty.dsatRate).toBeNull()
    // Counts are still true zeroes.
    expect(empty.dsatCount).toBe(0)
    expect(empty.responseCount).toBe(0)
  })

  it('computes the average from the exact distribution', () => {
    // (1+2+3+4+5)/5 = 3.0
    expect(composeScorecard(countsFrom(csat(1, 2, 3, 4, 5))).averageCsat).toBe(3)
  })

  it('carries the distribution and bands through for the §9 charts', () => {
    const scorecard = composeScorecard(countsFrom([...csat(5, 5, 1), ...nps(10, 8, 0)]))

    expect(scorecard.distribution[5]).toBe(2)
    expect(scorecard.distribution[1]).toBe(1)
    expect(scorecard.promoters).toBe(1)
    expect(scorecard.passives).toBe(1)
    expect(scorecard.detractors).toBe(1)
  })
})

describe('delta', () => {
  it('is the signed difference to one decimal', () => {
    expect(delta(75, 60)).toBe(15)
    expect(delta(60, 75)).toBe(-15)
    expect(delta(42.86, 40.1)).toBe(2.8)
  })

  it('is null when either side has no data', () => {
    // A first month of data is not a +75 point improvement from nothing.
    expect(delta(75, null)).toBeNull()
    expect(delta(null, 60)).toBeNull()
    expect(delta(null, null)).toBeNull()
  })

  it('is 0 for no change, which is different from null', () => {
    expect(delta(75, 75)).toBe(0)
  })
})

/** Builds count buckets from a response set, the way a rollup row would. */
function countsFrom(responses: readonly MetricResponse[]): RollupCounts {
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
