import type { ReactNode } from 'react'

/**
 * A KPI card — SPEC.md §9 View 1.
 *
 * The delta is rendered with an arrow glyph *and* a sign, never colour alone
 * (§12: "colour is never the only signal, pair with labels/icons"). A null
 * delta renders as explanatory text rather than a zero, because "no prior
 * period" and "no change" are different facts (§6).
 */
export function KpiCard({
  label,
  value,
  delta,
  deltaGood,
  sublabel,
  footnote,
  children,
}: {
  label: string
  value: string
  delta?: string | null
  /** Whether a positive delta is good. False for DSAT rate, where up is bad. */
  deltaGood?: boolean
  sublabel?: string | null
  footnote?: string
  children?: ReactNode
}) {
  const rising = delta?.startsWith('+') ?? false
  const flat = delta === '0.0' || delta === '+0.0'
  const improving = deltaGood === false ? !rising : rising

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-xs font-medium tracking-wide text-slate-400 uppercase">{label}</h3>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-slate-50 tabular-nums">{value}</span>
        {sublabel && <span className="text-xs text-slate-400">{sublabel}</span>}
      </div>

      {delta ? (
        <p
          className={
            flat
              ? 'text-xs text-slate-400'
              : improving
                ? 'text-xs text-sky-300'
                : 'text-xs text-rose-300'
          }
        >
          <span aria-hidden="true">{flat ? '→' : rising ? '↑' : '↓'}</span> {delta} vs previous
          period
        </p>
      ) : (
        <p className="text-xs text-slate-500">No previous period to compare</p>
      )}

      {children}
      {footnote && <p className="text-xs text-slate-500">{footnote}</p>}
    </article>
  )
}
