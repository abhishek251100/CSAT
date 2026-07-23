import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import {
  CsatDistributionChart,
  CsatTrendChart,
  NpsBandChart,
  NpsTrendChart,
} from '../components/charts'
import { DashboardHeader } from '../components/dashboard-header'
import { KpiCard } from '../components/kpi-card'
import { Leaderboard } from '../components/leaderboard'
import { ViewControls, type Grain, type ScopeType } from '../components/view-controls'
import { signOut, useSession } from '../lib/auth-client'
import { formatDelta, formatMetric, NPS_BAND_LABEL } from '../lib/chart-theme'
import { useTRPC } from '../lib/trpc'

export const Route = createFileRoute('/')({
  component: SatisfactionAndLoyalty,
})

/**
 * View 1 — Customer Satisfaction and Loyalty (SPEC.md §9).
 *
 * Reads `metrics.getScorecard` and `metrics.getAccountLeaderboard`, which serve
 * from `metric_rollups` (§12). Nothing on this page recomputes a metric: the UI
 * formats numbers it is given and never derives one, so the dashboard and the
 * rollup job cannot disagree.
 *
 * All charts are Recharts. §10 reserves Three.js for three ambient surfaces and
 * forbids rendering metrics in 3D.
 */
function SatisfactionAndLoyalty() {
  const navigate = useNavigate()
  const { data: session, isPending: sessionPending } = useSession()
  const trpc = useTRPC()

  useEffect(() => {
    if (!sessionPending && !session) void navigate({ to: '/sign-in' })
  }, [sessionPending, session, navigate])

  const me = useQuery({ ...trpc.auth.me.queryOptions(), enabled: Boolean(session) })
  const scopeOptions = useQuery({
    ...trpc.org.scopeOptions.queryOptions(),
    enabled: Boolean(session),
  })

  const [scopeType, setScopeType] = useState<ScopeType>('account')
  const [scopeId, setScopeId] = useState('')
  const [grain, setGrain] = useState<Grain>('monthly')
  const [range, setRange] = useState(defaultRange)
  const [sortKey, setSortKey] = useState<'name' | 'csatPercent' | 'nps' | 'responseCount'>(
    'csatPercent',
  )
  const [descending, setDescending] = useState(true)

  /**
   * Default to the widest scope the caller actually holds, so a network admin
   * lands on the network view and an account manager on their account —
   * without either being offered something the server would refuse.
   */
  useEffect(() => {
    if (scopeId !== '' || !scopeOptions.data) return

    const { networks, agencies, accounts } = scopeOptions.data

    if (networks[0]) {
      setScopeType('network')
      setScopeId(networks[0].id)
    } else if (agencies[0]) {
      setScopeType('agency')
      setScopeId(agencies[0].id)
    } else if (accounts[0]) {
      setScopeType('account')
      setScopeId(accounts[0].id)
    }
  }, [scopeOptions.data, scopeId])

  const scorecardInput = { scopeType, scopeId, grain, from: range.from, to: range.to }
  const enabled = Boolean(session) && scopeId !== ''

  const scorecard = useQuery({
    ...trpc.metrics.getScorecard.queryOptions(scorecardInput),
    enabled,
  })
  const leaderboard = useQuery({
    ...trpc.metrics.getAccountLeaderboard.queryOptions(scorecardInput),
    // §9 places the leaderboard at agency and network scope only.
    enabled: enabled && scopeType !== 'account',
  })

  const distribution = useMemo(() => {
    const counts = scorecard.data?.current.distribution

    return ([1, 2, 3, 4, 5] as const).map((score) => ({
      score: String(score),
      count: counts?.[score] ?? 0,
      // §1: 4 and 5 are satisfied; 1, 2 and 3 are DSAT.
      satisfied: score >= 4,
    }))
  }, [scorecard.data])

  if (sessionPending || !session) {
    return <main className="p-8 text-sm text-slate-400">Checking your session…</main>
  }

  const current = scorecard.data?.current
  const deltas = scorecard.data?.deltas

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-6">
      <DashboardHeader
        email={me.data?.email ?? session.user.email}
        onSignOut={() => void signOut().then(() => navigate({ to: '/sign-in' }))}
      />

      <div className="space-y-1">
        <p className="text-xs font-medium tracking-[0.2em] text-slate-500 uppercase">View 1</p>
        <h1 className="text-2xl font-semibold text-slate-50">Customer Satisfaction and Loyalty</h1>
      </div>

      {scopeOptions.data && (
        <ViewControls
          options={scopeOptions.data}
          scopeType={scopeType}
          scopeId={scopeId}
          grain={grain}
          from={range.from}
          to={range.to}
          onChange={(next) => {
            if (next.scopeType) setScopeType(next.scopeType)
            if (next.scopeId !== undefined) setScopeId(next.scopeId)
            if (next.grain) setGrain(next.grain)
            if (next.from || next.to) {
              setRange((previous) => ({
                from: next.from ?? previous.from,
                to: next.to ?? previous.to,
              }))
            }
          }}
        />
      )}

      {me.data?.accountCount === 0 && (
        <p className="rounded-md border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          You have no account memberships yet, so there is nothing to show. An administrator needs
          to grant you one.
        </p>
      )}

      {scorecard.isError && (
        <p
          role="alert"
          className="rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-300"
        >
          {scorecard.error.message}
        </p>
      )}

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="CSAT %"
          value={formatMetric(current?.csatPercent, { suffix: '%' })}
          delta={formatDelta(deltas?.csatPercent, '%')}
          sublabel={current ? `${current.csatResponseCount} responses` : null}
        />
        <KpiCard
          label="NPS"
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
          label="Responses"
          value={current ? String(current.responseCount) : '—'}
          delta={formatDelta(deltas?.responseCount)}
        />
        <KpiCard
          label="DSAT rate"
          value={
            current?.dsatRate === null || current?.dsatRate === undefined
              ? '—'
              : `${(current.dsatRate * 100).toFixed(1)}%`
          }
          delta={formatDelta(deltas?.dsatRate, '%')}
          // Rising dissatisfaction is bad, so the arrow's meaning inverts here.
          deltaGood={false}
          sublabel={current ? `${current.dsatCount} of ${current.csatResponseCount}` : null}
        />
      </section>

      {grain === 'custom' ? (
        <p className="rounded-md border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
          A custom range is computed live from responses (§12) and has no period breakdown, so the
          trend charts are hidden. Switch to Monthly or Quarterly to see them.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="CSAT % over time" hint="Share of responses scoring 4 or 5">
            <CsatTrendChart data={scorecard.data?.trend ?? []} />
          </ChartCard>

          <ChartCard title="NPS over time" hint="Promoters minus detractors, −100 to +100">
            <NpsTrendChart data={scorecard.data?.trend ?? []} />
          </ChartCard>

          <ChartCard title="NPS breakdown" hint="Respondents by band, per period">
            <NpsBandChart data={scorecard.data?.trend ?? []} />
          </ChartCard>

          <ChartCard
            title="CSAT distribution"
            hint="Responses by score. Blue is satisfied (4-5); red is DSAT (1-3)"
          >
            <CsatDistributionChart data={distribution} />
          </ChartCard>
        </div>
      )}

      {scopeType !== 'account' && (
        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-slate-200">Accounts</h2>
            <p className="text-xs text-slate-500">Select an account to drill into its own view.</p>
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
            onDrillDown={(accountId) => {
              setScopeType('account')
              setScopeId(accountId)
            }}
          />
        </section>
      )}

      <footer className="text-xs text-slate-600">
        {scorecard.data
          ? `Served from ${scorecard.data.source === 'rollups' ? 'precomputed rollups' : 'a live scan'}.`
          : null}
      </footer>
    </main>
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

/** Defaults to the last six months, ending today. */
function defaultRange() {
  const today = new Date()
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1))

  return { from: start.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) }
}
