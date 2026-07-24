/**
 * Brand / account health labels for leaderboards — derived from CSAT %.
 * Text accompanies colour so colour is never the only signal (§12).
 */
export type BrandHealth = 'good' | 'watch' | 'poor' | 'nodata'

export function brandHealthFromCsat(csatPercent: number | null): BrandHealth {
  if (csatPercent === null) return 'nodata'
  if (csatPercent >= 70) return 'good'
  if (csatPercent >= 50) return 'watch'
  return 'poor'
}

export const BRAND_HEALTH_LABEL: Record<BrandHealth, string> = {
  good: 'Good',
  watch: 'Watch',
  poor: 'Needs attention',
  nodata: 'No data',
}
