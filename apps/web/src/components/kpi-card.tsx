import type { ReactNode } from 'react'

export type KpiTone = 'neutral' | 'csat' | 'dsat' | 'nps'

/**
 * KPI card with optional colour tone (always paired with text labels).
 */
export function KpiCard({
  label,
  value,
  delta,
  deltaGood,
  sublabel,
  footnote,
  tone = 'neutral',
  children,
}: {
  label: string
  value: string
  delta?: string | null
  deltaGood?: boolean
  sublabel?: string | null
  footnote?: string
  tone?: KpiTone
  children?: ReactNode
}) {
  const rising = delta?.startsWith('+') ?? false
  const flat = delta === '0.0' || delta === '+0.0'
  const improving = deltaGood === false ? !rising : rising

  const toneBorder =
    tone === 'csat'
      ? 'border-sky-800/80'
      : tone === 'dsat'
        ? 'border-rose-900/80'
        : tone === 'nps'
          ? 'border-violet-900/80'
          : 'border-slate-800'

  const toneLabel =
    tone === 'csat'
      ? 'text-sky-300'
      : tone === 'dsat'
        ? 'text-rose-300'
        : tone === 'nps'
          ? 'text-violet-300'
          : 'text-slate-400'

  return (
    <article className={`flex flex-col gap-2 rounded-lg border bg-slate-900 p-4 ${toneBorder}`}>
      <h3 className={`text-xs font-medium tracking-wide uppercase ${toneLabel}`}>{label}</h3>

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
