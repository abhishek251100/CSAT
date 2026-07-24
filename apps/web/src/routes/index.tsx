import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import {
  CsatDistributionChart,
  CsatTrendChart,
  NpsBandChart,
} from '../components/charts'
import { DashboardShell } from '../components/dashboard-shell'
import { KpiCard } from '../components/kpi-card'
import { Leaderboard } from '../components/leaderboard'
import { formatDelta, formatMetric, NPS_BAND_LABEL } from '../lib/chart-theme'
import { useDashboard } from '../lib/use-dashboard'
import { useTRPC } from '../lib/trpc'

export const Route = createFileRoute('/')({
  component: CxMetrics,
})

/**
 * Tab 1 — CX metrics: coloured KPIs, CSAT-left charts, brand overall scores.
 */
function CxMetrics() {
  const dash = useDashboard()
  const trpc = useTRPC()
  const [sortKey, setSortKey] = useState<'name' | 'csatPercent' | 'nps' | 'responseCount'>(
    'csatPercent',
  )
  const [descending, setDescending] = useState(true)

  const scorecard = useQuery({
    ...trpc.metrics.getScorecard.queryOptions(dash.input),
    enabled: dash.enabled,
  })
  const leaderboard = useQuery({
    ...trpc.metrics.getAccountLeaderboard.queryOptions(dash.input),
    enabled: dash.enabled && dash.scopeType !== 'account',
  })

  const distribution = useMemo(() => {
    const counts = scorecard.data?.current.distribution
    return ([1, 2, 3, 4, 5] as const).map((score) => ({
      score: String(score),
      count: counts?.[score] ?? 0,
      satisfied: score >= 4,
    }))
  }, [scorecard.data])

  const current = scorecard.data?.current
  const deltas = scorecard.data?.deltas
  const noSurveys = current !== undefined && current.csatResponseCount === 0 && current.npsResponseCount === 0

  return (
    <DashboardShell dash={dash} title="CX metrics" eyebrow="Tab 1">
      {scorecard.isError && (
        <p
          role="alert"
          className="rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-300"
        >
          {scorecard.error.message}
        </p>
      )}

      {noSurveys && (
        <p
          role="status"
          className="rounded-md border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-200"
        >
          No survey responses in this period for this scope. Adjust the date range or switch entity.
        </p>
      )}

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="CSAT %"
          tone="csat"
          value={formatMetric(current?.csatPercent, { suffix: '%' })}
          delta={formatDelta(deltas?.csatPercent, '%')}
          sublabel={current ? `${current.csatResponseCount} CSAT responses` : null}
        />
        <KpiCard
          label="CSAT"
          tone="csat"
          value={current ? String(current.csatResponseCount) : '—'}
          delta={null}
          footnote="Count of CSAT responses only"
        />
        <KpiCard
          label="NPS"
          tone="nps"
          value={formatMetric(current?.nps)}
          delta={formatDelta(deltas?.nps)}
          sublabel={
            scorecard.data?.npsBand
              ? (NPS_BAND_LABEL[scorecard.data.npsBand] ?? scorecard.data.npsBand)
              : null
          }
          footnote={current ? `${current.npsResponseCount} NPS responses` : undefined}
        />
        <KpiCard
          label="DSAT rate"
          tone="dsat"
          value={
            current?.dsatRate === null || current?.dsatRate === undefined
              ? '—'
              : `${(current.dsatRate * 100).toFixed(1)}%`
          }
          delta={formatDelta(deltas?.dsatRate, '%')}
          deltaGood={false}
          sublabel={
            current ? `${current.dsatCount} of which DSAT (of ${current.csatResponseCount})` : null
          }
        />
      </section>

      {dash.grain === 'custom' ? (
        <p className="rounded-md border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
          A custom range is computed live and has no period breakdown, so trend charts are hidden.
          Switch to Monthly or Quarterly to see them.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <ChartCard title="CSAT % over time" hint="Share of responses scoring 4 or 5 (0–100%)">
              <CsatTrendChart data={scorecard.data?.trend ?? []} />
            </ChartCard>
            <ChartCard
              title="CSAT distribution"
              hint="Responses by score 1–5. Blue = satisfied (4–5); red = DSAT (1–3)"
            >
              <CsatDistributionChart data={distribution} />
            </ChartCard>
            {current && current.dsatCount > 0 && (
              <p className="rounded-md border border-rose-900/60 bg-rose-950/30 p-3 text-sm text-rose-200">
                <span className="font-medium">DSAT callout:</span> {current.dsatCount} dissatisfied
                response{current.dsatCount === 1 ? '' : 's'} in this period (
                {current.dsatRate === null ? '—' : `${(current.dsatRate * 100).toFixed(1)}%`} of
                CSAT). Open the DSAT tab for detail and RCA.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <ChartCard title="NPS band mix" hint="Promoters / passives / detractors per period">
              <NpsBandChart data={scorecard.data?.trend ?? []} />
            </ChartCard>

            {dash.scopeType !== 'account' && (
              <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
                <div className="space-y-1">
                  <h2 className="text-sm font-medium text-slate-200">Brand overall scores</h2>
                  <p className="text-xs text-slate-500">
                    Click a brand to drill into Account scope.
                  </p>
                </div>
                <Leaderboard
                  rows={leaderboard.data ?? []}
                  sortKey={sortKey}
                  descending={descending}
                  onSort={(key) => {
                    if (key === sortKey) setDescending((value) => !value)
                    else {
                      setSortKey(key)
                      setDescending(key !== 'name')
                    }
                  }}
                  onDrillDown={(accountId) => dash.setScope('account', accountId)}
                />
              </section>
            )}
          </div>
        </div>
      )}

      <footer className="text-xs text-slate-600">
        {scorecard.data
          ? `Served from ${scorecard.data.source === 'rollups' ? 'precomputed rollups' : 'a live scan'}.`
          : null}
      </footer>
    </DashboardShell>
  )
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium text-slate-200">{title}</h2>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      {children}
    </section>
  )
}
