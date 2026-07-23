import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import {
  ActionItemsTable,
  EscalationsList,
  RcaTrackerTable,
} from '../components/actionables-tables'
import { ErrorCategoryPie, type CategorySlice } from '../components/charts'
import { DashboardHeader } from '../components/dashboard-header'
import { KpiCard } from '../components/kpi-card'
import { ViewControls } from '../components/view-controls'
import { CHART, ERROR_CATEGORY_LABEL } from '../lib/chart-theme'
import { useDashboard } from '../lib/use-dashboard'
import { useTRPC } from '../lib/trpc'

export const Route = createFileRoute('/actionables')({
  component: FeedbackAndActionables,
})

/**
 * View 2 — Customer Feedback and Actionables (SPEC.md §9).
 *
 * Reads the §8 workflow routers (escalations, rca, actions) and the metrics
 * router (DSAT count from rollups, error-category breakdown). Every query is
 * scoped by `resolveVisibleAccounts` server-side; this page only formats.
 *
 * All charts are Recharts (§10). The error-category pie uses a categorical trio
 * with per-slice labels and a legend, so nothing reads by colour alone (§12).
 */
function FeedbackAndActionables() {
  const dash = useDashboard()
  const trpc = useTRPC()

  const enabledAgg = dash.enabled

  // KPI + pie: DSAT count comes from rollups via the scorecard; the pie from the
  // error-category breakdown. Both are aggregate-scope queries.
  const scorecard = useQuery({
    ...trpc.metrics.getScorecard.queryOptions(dash.input),
    enabled: enabledAgg,
  })
  const errorBreakdown = useQuery({
    ...trpc.metrics.getErrorCategoryBreakdown.queryOptions(dash.input),
    enabled: enabledAgg,
  })

  // Lists come from the §8 routers, filtered to the selected scope's accounts.
  const scopeAccountIds = useScopeAccountIds(dash)

  const listInput = scopeAccountIds ? { accountIds: scopeAccountIds } : undefined
  const listEnabled = dash.enabled && scopeAccountIds !== null

  const escalations = useQuery({
    ...trpc.escalations.list.queryOptions(listInput),
    enabled: listEnabled,
  })
  const openActions = useQuery({
    ...trpc.actions.list.queryOptions({ ...listInput, status: undefined }),
    enabled: listEnabled,
  })
  const overdue = useQuery({
    ...trpc.actions.overdue.queryOptions(listInput),
    enabled: listEnabled,
  })
  const rcaTracker = useQuery({
    ...trpc.rca.tracker.queryOptions(listInput),
    // §9 places the RCA tracker at agency and network scope.
    enabled: listEnabled && dash.scopeType !== 'account',
  })

  const openEscalations = useMemo(
    () => (escalations.data ?? []).filter((e) => e.status === 'open' || e.status === 'in_progress'),
    [escalations.data],
  )
  const openActionItems = useMemo(
    () => (openActions.data ?? []).filter((a) => a.status !== 'done'),
    [openActions.data],
  )

  const accountName = useAccountNames(dash)

  const pieData: CategorySlice[] = useMemo(() => {
    const b = errorBreakdown.data
    if (!b) return []
    return (['people', 'process', 'product'] as const)
      .map((key) => ({
        key,
        label: ERROR_CATEGORY_LABEL[key]!,
        count: b[key].count,
        color:
          key === 'people'
            ? CHART.categoryPeople
            : key === 'process'
              ? CHART.categoryProcess
              : CHART.categoryProduct,
      }))
      .filter((slice) => slice.count > 0)
  }, [errorBreakdown.data])

  if (!dash.ready) {
    return <main className="p-8 text-sm text-slate-400">Checking your session…</main>
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-6">
      <DashboardHeader email={dash.me?.email} onSignOut={dash.signOutAndRedirect} />

      <div className="space-y-1">
        <p className="text-xs font-medium tracking-[0.2em] text-slate-500 uppercase">View 2</p>
        <h1 className="text-2xl font-semibold text-slate-50">Customer Feedback and Actionables</h1>
      </div>

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

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Open escalations" value={String(openEscalations.length)} />
        <KpiCard
          label="DSAT count"
          value={scorecard.data ? String(scorecard.data.current.dsatCount) : '—'}
          sublabel={
            scorecard.data ? `of ${scorecard.data.current.csatResponseCount} CSAT responses` : null
          }
        />
        <KpiCard label="Open action items" value={String(openActionItems.length)} />
        <KpiCard
          label="Overdue actions"
          value={overdue.data ? String(overdue.data.length) : '—'}
          footnote={overdue.data && overdue.data.length > 0 ? 'Past ETA and not done' : undefined}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="space-y-0.5">
            <h2 className="text-sm font-medium text-slate-200">Error categories</h2>
            <p className="text-xs text-slate-500">
              Share of RCAs by root cause (people / process / product)
            </p>
          </div>
          {pieData.length > 0 ? (
            <ErrorCategoryPie data={pieData} />
          ) : (
            <p className="py-12 text-center text-sm text-slate-500">
              No categorised RCAs in this period.
            </p>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="space-y-0.5">
            <h2 className="text-sm font-medium text-slate-200">Escalations</h2>
            <p className="text-xs text-slate-500">Critical feedback, by severity and status</p>
          </div>
          <EscalationsList rows={escalations.data ?? []} accountName={accountName} />
        </section>
      </div>

      <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="space-y-0.5">
          <h2 className="text-sm font-medium text-slate-200">Open action items</h2>
          <p className="text-xs text-slate-500">Overdue rows are flagged</p>
        </div>
        <ActionItemsTable rows={openActionItems} accountName={accountName} />
      </section>

      {dash.scopeType !== 'account' && (
        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="space-y-0.5">
            <h2 className="text-sm font-medium text-slate-200">RCA tracker</h2>
            <p className="text-xs text-slate-500">Root-cause analyses across the scope</p>
          </div>
          <RcaTrackerTable rows={rcaTracker.data ?? []} />
        </section>
      )}
    </main>
  )
}

/**
 * The account ids behind the selected scope, so the §8 list endpoints (which
 * take an accountIds filter) query exactly the scope's accounts. Derived from
 * the scope-options list the caller is already allowed to see.
 */
function useScopeAccountIds(dash: ReturnType<typeof useDashboard>): string[] | null {
  return useMemo(() => {
    if (!dash.scopeOptions || dash.scopeId === '') return null
    const { accounts } = dash.scopeOptions

    if (dash.scopeType === 'account') return [dash.scopeId]
    // Agency: only that agency's accounts, so the tables show that agency alone.
    if (dash.scopeType === 'agency') {
      return accounts.filter((a) => a.agencyId === dash.scopeId).map((a) => a.id)
    }
    // Network (single network in v1, §16 #8): every visible account.
    return accounts.map((a) => a.id)
  }, [dash.scopeOptions, dash.scopeType, dash.scopeId])
}

/** A name lookup for account ids, from the scope options. */
function useAccountNames(dash: ReturnType<typeof useDashboard>): (id: string) => string {
  return useMemo(() => {
    const map = new Map((dash.scopeOptions?.accounts ?? []).map((a) => [a.id, a.name]))
    return (id: string) => map.get(id) ?? '—'
  }, [dash.scopeOptions])
}
