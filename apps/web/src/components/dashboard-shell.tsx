import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { PeriodChip, ViewControls } from './view-controls'
import { formatMetric } from '../lib/chart-theme'
import type { DashboardScope } from '../lib/use-dashboard'
import { useTRPC } from '../lib/trpc'
import { DashboardHeader } from './dashboard-header'

/**
 * Sticky filter shell shared by CX metrics / DSAT / A tracker / Access.
 * Includes period chip and quick analysis summary.
 */
export function DashboardShell({
  dash,
  title,
  eyebrow,
  showAccess = false,
  children,
}: {
  dash: DashboardScope
  title: string
  eyebrow?: string
  showAccess?: boolean
  children: ReactNode
}) {
  const trpc = useTRPC()
  const caps = useQuery({
    ...trpc.users.meCapabilities.queryOptions(),
    enabled: dash.ready,
  })
  const scorecard = useQuery({
    ...trpc.metrics.getScorecard.queryOptions(dash.input),
    enabled: dash.enabled,
  })
  const overdue = useQuery({
    ...trpc.actions.overdue.queryOptions(
      dash.scopeAccountIds ? { accountIds: dash.scopeAccountIds } : undefined,
    ),
    enabled: dash.enabled && dash.scopeAccountIds !== null,
  })
  const escalations = useQuery({
    ...trpc.escalations.list.queryOptions(
      dash.scopeAccountIds ? { accountIds: dash.scopeAccountIds } : undefined,
    ),
    enabled: dash.enabled && dash.scopeAccountIds !== null,
  })
  const rcaTracker = useQuery({
    ...trpc.rca.tracker.queryOptions(
      dash.scopeAccountIds ? { accountIds: dash.scopeAccountIds } : undefined,
    ),
    enabled: dash.enabled && dash.scopeAccountIds !== null,
  })
  const agencyBreakdown = useQuery({
    ...trpc.metrics.getAgencyBreakdown.queryOptions(dash.input),
    enabled: dash.enabled && (dash.scopeType === 'network' || dash.scopeType === 'global'),
  })

  const openEscalations = (escalations.data ?? []).filter(
    (row) => row.status === 'open' || row.status === 'in_progress',
  ).length
  const pendingRcas = (rcaTracker.data ?? []).filter(
    (row) => row.status === 'open' || row.status === 'in_progress',
  ).length
  const current = scorecard.data?.current
  const accessVisible = showAccess || Boolean(caps.data?.manageUsers)

  if (!dash.ready) {
    return <main className="p-8 text-sm text-slate-400">Checking your session…</main>
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 p-6">
      <DashboardHeader
        email={dash.me?.email ?? dash.session?.user.email}
        onSignOut={dash.signOutAndRedirect}
        showAccess={accessVisible}
      />

      <div className="space-y-1">
        {eyebrow && (
          <p className="text-xs font-medium tracking-[0.2em] text-slate-500 uppercase">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-semibold text-slate-50">{title}</h1>
      </div>

      <div className="sticky top-0 z-30 -mx-1 space-y-2 bg-slate-950/95 px-1 pb-2 backdrop-blur">
        <PeriodChip
          scopeLabel={dash.scopeLabel}
          entityLabel={dash.entityLabel}
          grain={dash.grain}
          from={dash.from}
          to={dash.to}
        />
        {dash.scopeOptions && (
          <ViewControls
            options={dash.scopeOptions}
            scopeType={dash.scopeType}
            scopeId={dash.scopeId}
            grain={dash.grain}
            from={dash.from}
            to={dash.to}
            onChange={(next) => {
              if (next.scopeType || next.scopeId !== undefined) {
                dash.setScope(next.scopeType ?? dash.scopeType, next.scopeId ?? dash.scopeId)
              }
              if (next.grain) dash.setGrain(next.grain)
              if (next.from || next.to) dash.setRange({ from: next.from, to: next.to })
            }}
          />
        )}
      </div>

      {dash.me?.accountCount === 0 && (
        <p className="rounded-md border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          You have no account memberships yet, so there is nothing to show. An administrator needs
          to grant you one.
        </p>
      )}

      <section
        aria-label="Quick analysis summary"
        className="grid gap-2 rounded-lg border border-slate-800 bg-slate-900/80 p-3 text-xs sm:grid-cols-3 lg:grid-cols-6"
      >
        <SummaryStat
          label="CSAT %"
          value={formatMetric(current?.csatPercent, { suffix: '%' })}
          tone="sky"
        />
        <SummaryStat
          label="DSAT"
          value={
            current
              ? `${current.dsatCount} (${current.dsatRate === null ? '—' : `${(current.dsatRate * 100).toFixed(0)}%`})`
              : '—'
          }
          tone="rose"
        />
        <SummaryStat label="NPS" value={formatMetric(current?.nps)} tone="violet" />
        <SummaryStat label="Open escalations" value={String(openEscalations)} />
        <SummaryStat
          label="Pending RCAs"
          value={rcaTracker.data ? String(pendingRcas) : '—'}
          hint="Open or in-progress RCAs"
        />
        <SummaryStat
          label="Overdue actions"
          value={overdue.data ? String(overdue.data.length) : '—'}
          tone="amber"
        />
      </section>

      {(dash.scopeType === 'network' || dash.scopeType === 'global') &&
        (agencyBreakdown.data?.length ?? 0) > 0 && (
          <section
            aria-label="Agency breakdown"
            className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-3"
          >
            <h2 className="mb-2 text-sm font-medium text-slate-200">Agency performance</h2>
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400 uppercase">
                  <th className="px-2 py-1.5 font-medium">Agency</th>
                  <th className="px-2 py-1.5 text-right font-medium">CSAT %</th>
                  <th className="px-2 py-1.5 text-right font-medium">NPS</th>
                  <th className="px-2 py-1.5 text-right font-medium">DSAT</th>
                  <th className="px-2 py-1.5 text-right font-medium">Responses</th>
                </tr>
              </thead>
              <tbody>
                {agencyBreakdown.data!.map((row) => (
                  <tr key={row.agencyId} className="border-b border-slate-800/50">
                    <td className="px-2 py-1.5 text-slate-100">{row.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-200">
                      {formatMetric(row.csatPercent, { suffix: '%' })}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-200">
                      {formatMetric(row.nps)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-rose-300">
                      {row.dsatCount}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">
                      {row.responseCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

      {children}
    </main>
  )
}

function SummaryStat({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: string
  tone?: 'sky' | 'rose' | 'violet' | 'amber'
  hint?: string
}) {
  const color =
    tone === 'sky'
      ? 'text-sky-300'
      : tone === 'rose'
        ? 'text-rose-300'
        : tone === 'violet'
          ? 'text-violet-300'
          : tone === 'amber'
            ? 'text-amber-300'
            : 'text-slate-100'

  return (
    <div className="rounded-md bg-slate-950/60 px-2 py-1.5">
      <p className="text-[10px] tracking-wide text-slate-500 uppercase">{label}</p>
      <p className={`text-sm font-medium tabular-nums ${color}`} title={hint}>
        {value}
      </p>
    </div>
  )
}
