/**
 * Chart palette and chrome for View 1 — SPEC.md §9, §12 (accessibility).
 *
 * Every colour below was checked with the data-viz validator against this
 * application's actual dark chart surface (#0f172a), not chosen by eye.
 *
 * The one substantive finding: **promoters/detractors are blue and red, not
 * green and red.** Green vs red measures ΔE 4.1 under deuteranopia — the two
 * most important bars in the NPS breakdown would be indistinguishable to a
 * red-green colourblind reader. Blue vs red measures 19.2 under protanopia and
 * 29.0 for normal vision, passing every gate. §12 requires colour never be the
 * only signal, and this is the case where the default instinct breaks it.
 *
 * The neutral grey used for passives is deliberately outside the categorical
 * gates: it is a diverging *midpoint*, whose job is to read as "neither".
 * It therefore ships with the secondary encoding the method requires — a
 * legend, direct value labels, and a 2px surface gap between stacked segments —
 * so the three bands are never distinguished by hue alone.
 */

export const CHART = {
  /** The card background charts are drawn on; the validator's reference surface. */
  surface: '#0f172a',

  /** Single-series lines. One series needs no legend — the title names it. */
  series: '#3987e5',

  /**
   * Diverging pair for polarity: satisfied/promoters against
   * dissatisfied/detractors, with a neutral midpoint.
   */
  positive: '#3987e5',
  neutral: '#8a8a86',
  negative: '#e66767',

  /**
   * Categorical trio for the error-category pie (people / process / product).
   * The reference palette's first three dark slots, validated all-pairs on this
   * surface (worst CVD ΔE 13.0). Not semantic — three distinct identities, each
   * paired with a label so hue is never the only signal.
   */
  categoryPeople: '#3987e5',
  categoryProcess: '#008300',
  categoryProduct: '#d55181',

  /** Status accent for overdue rows — amber, always paired with an icon + text. */
  warning: '#fbbf24',

  /** Recessive chrome, per the method: grid and axes must not compete. */
  grid: '#1e293b',
  axis: '#334155',
  tickText: '#94a3b8',
  tooltipBg: '#0b1220',
  tooltipBorder: '#334155',
} as const

/** Severity labels + accent for escalations (§9). Paired with text, not colour alone. */
export const SEVERITY_META: Record<string, { label: string; className: string }> = {
  low: { label: 'Low', className: 'text-slate-400' },
  medium: { label: 'Medium', className: 'text-sky-300' },
  high: { label: 'High', className: 'text-amber-300' },
  critical: { label: 'Critical', className: 'text-rose-300' },
}

/** Error-category labels for the §9 pie and RCA tracker. */
export const ERROR_CATEGORY_LABEL: Record<string, string> = {
  people: 'People',
  process: 'Process',
  product: 'Product',
}

/** NPS band colours (§6). Paired with the band label — never colour alone. */
export const NPS_BAND_LABEL: Record<string, string> = {
  worrisome: 'Worrisome',
  needs_improvement: 'Needs improvement',
  good: 'Good',
  excellent: 'Excellent',
  gold_standard: 'Gold standard',
}

/** Formats a metric that is legitimately absent, distinctly from zero (§6). */
export function formatMetric(
  value: number | null | undefined,
  options: { suffix?: string; decimals?: number } = {},
): string {
  if (value === null || value === undefined) return '—'

  const { suffix = '', decimals = 1 } = options

  return `${value.toFixed(decimals)}${suffix}`
}

export function formatDelta(value: number | null | undefined, suffix = ''): string | null {
  if (value === null || value === undefined) return null

  const sign = value > 0 ? '+' : ''

  return `${sign}${value.toFixed(1)}${suffix}`
}
