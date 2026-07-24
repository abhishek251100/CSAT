import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { ActionItemsTable, RcaTrackerTable } from '../components/actionables-tables'
import { ErrorCategoryPie, type CategorySlice } from '../components/charts'
import { DashboardShell } from '../components/dashboard-shell'
import { CHART, ERROR_CATEGORY_LABEL, SEVERITY_META } from '../lib/chart-theme'
import { useDashboard } from '../lib/use-dashboard'
import { useTRPC } from '../lib/trpc'

export const Route = createFileRoute('/tracker')({
  component: ATrackerTab,
})

/**
 * Tab 3 — A tracker: escalations, RCA ownership, action items + write flows.
 */
function ATrackerTab() {
  const dash = useDashboard()
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [selectedEscalationId, setSelectedEscalationId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const caps = useQuery({
    ...trpc.users.meCapabilities.queryOptions(),
    enabled: dash.enabled,
  })

  const listInput = dash.scopeAccountIds ? { accountIds: dash.scopeAccountIds } : undefined
  const listEnabled = dash.enabled && dash.scopeAccountIds !== null

  const escalations = useQuery({
    ...trpc.escalations.listDetailed.queryOptions(listInput),
    enabled: listEnabled,
  })
  const openActions = useQuery({
    ...trpc.actions.list.queryOptions({ ...listInput, status: undefined }),
    enabled: listEnabled,
  })
  const rcaTracker = useQuery({
    ...trpc.rca.tracker.queryOptions(listInput),
    enabled: listEnabled,
  })
  const errorBreakdown = useQuery({
    ...trpc.metrics.getErrorCategoryBreakdown.queryOptions(dash.input),
    enabled: dash.enabled,
  })

  const escalationDetail = useQuery({
    ...trpc.escalations.get.queryOptions({ escalationId: selectedEscalationId! }),
    enabled: Boolean(selectedEscalationId),
  })

  const openActionItems = useMemo(
    () => (openActions.data ?? []).filter((row) => row.status !== 'done'),
    [openActions.data],
  )

  const accountName = useMemo(() => {
    const map = new Map((dash.scopeOptions?.accounts ?? []).map((a) => [a.id, a.name]))
    return (id: string) => map.get(id) ?? '—'
  }, [dash.scopeOptions])

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

  return (
    <DashboardShell dash={dash} title="A tracker" eyebrow="Tab 3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Escalations, RCA ownership, and action items for the selected scope.
        </p>
        {caps.data?.createEscalation && (
          <button
            type="button"
            onClick={() => setShowCreate((value) => !value)}
            className="rounded-md border border-violet-800 bg-violet-950/40 px-3 py-1.5 text-sm text-violet-200 hover:bg-violet-950/70"
          >
            {showCreate ? 'Hide form' : 'Create escalation'}
          </button>
        )}
      </div>

      {showCreate && caps.data?.createEscalation && (
        <CreateEscalationForm
          accounts={dash.scopeOptions?.accounts ?? []}
          onDone={() => {
            setShowCreate(false)
            void queryClient.invalidateQueries()
          }}
        />
      )}

      <section className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-200">Escalations</h2>
          <p className="text-xs text-slate-500">Numbered ops table — click a row for drill-down</p>
        </div>
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-400 uppercase">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Brand</th>
              <th className="px-3 py-2 font-medium">Agency</th>
              <th className="px-3 py-2 font-medium">Submitted by</th>
              <th className="px-3 py-2 font-medium">Severity</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">RCA</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Opened</th>
            </tr>
          </thead>
          <tbody>
            {(escalations.data ?? []).map((row) => {
              const severity = SEVERITY_META[row.severity] ?? {
                label: row.severity,
                className: '',
              }
              return (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b border-slate-800/60 hover:bg-slate-800/50"
                  onClick={() => setSelectedEscalationId(row.id)}
                >
                  <td className="px-3 py-2 font-mono text-xs text-sky-300">{row.number}</td>
                  <td className="max-w-[12rem] truncate px-3 py-2 text-slate-100">{row.title}</td>
                  <td className="px-3 py-2 text-slate-300">{row.accountName}</td>
                  <td className="px-3 py-2 text-slate-400">{row.agencyName}</td>
                  <td className="px-3 py-2 text-slate-300">{row.submittedBy}</td>
                  <td className={`px-3 py-2 font-medium ${severity.className}`}>
                    <span aria-hidden="true">{row.severity === 'critical' ? '● ' : ''}</span>
                    {severity.label}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{labelStatus(row.status)}</td>
                  <td className="px-3 py-2 text-slate-300">{labelStatus(row.rcaStatus)}</td>
                  <td className="px-3 py-2 text-slate-400">
                    {row.errorCategory
                      ? (ERROR_CATEGORY_LABEL[row.errorCategory] ?? row.errorCategory)
                      : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-400">
                    {new Date(row.reportedAt).toLocaleDateString()}
                  </td>
                </tr>
              )
            })}
            {escalations.data?.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-sm text-slate-500">
                  No escalations in this scope.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="space-y-0.5">
            <h2 className="text-sm font-medium text-slate-200">Error categories</h2>
            <p className="text-xs text-slate-500">RCA root causes in period</p>
          </div>
          {pieData.length > 0 ? (
            <ErrorCategoryPie data={pieData} />
          ) : (
            <p className="py-12 text-center text-sm text-slate-500">No categorised RCAs.</p>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="space-y-0.5">
            <h2 className="text-sm font-medium text-slate-200">RCA status tracker</h2>
            <p className="text-xs text-slate-500">Ownership via subject · overdue via open status</p>
          </div>
          <RcaTrackerTable rows={rcaTracker.data ?? []} />
        </section>
      </div>

      <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="space-y-0.5">
          <h2 className="text-sm font-medium text-slate-200">Action items</h2>
          <p className="text-xs text-slate-500">Open items — overdue rows flagged</p>
        </div>
        <ActionItemsTable rows={openActionItems} accountName={accountName} />
      </section>

      {selectedEscalationId && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-label="Escalation detail"
        >
          <button
            type="button"
            className="flex-1 cursor-default"
            aria-label="Close"
            onClick={() => setSelectedEscalationId(null)}
          />
          <aside className="flex h-full w-full max-w-lg flex-col gap-4 overflow-y-auto border-l border-slate-800 bg-slate-950 p-5">
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold text-slate-50">Escalation detail</h2>
              <button
                type="button"
                onClick={() => setSelectedEscalationId(null)}
                className="text-sm text-slate-400 hover:text-slate-200"
              >
                Close
              </button>
            </div>
            {escalationDetail.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
            {escalationDetail.data && (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Title</dt>
                  <dd className="text-slate-100">{escalationDetail.data.title}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Description</dt>
                  <dd className="whitespace-pre-wrap text-slate-300">
                    {escalationDetail.data.description ?? '—'}
                  </dd>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <dt className="text-xs text-slate-500">Severity</dt>
                    <dd className="text-slate-200">{escalationDetail.data.severity}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Status</dt>
                    <dd className="text-slate-200">{escalationDetail.data.status}</dd>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Linked RCA and actions appear in the tables above. Use write APIs (or ask an admin)
                  to attach RCA / action items when your role allows.
                </p>
              </dl>
            )}
          </aside>
        </div>
      )}
    </DashboardShell>
  )
}

function CreateEscalationForm({
  accounts,
  onDone,
}: {
  accounts: { id: string; name: string }[]
  onDone: () => void
}) {
  const trpc = useTRPC()
  const create = useMutation(trpc.escalations.create.mutationOptions())
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="grid gap-3 rounded-lg border border-violet-900/50 bg-violet-950/20 p-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        create.mutate(
          {
            accountId,
            title,
            description: description || undefined,
            severity,
            source: 'other',
            reportedAt: new Date(),
          },
          {
            onSuccess: () => onDone(),
            onError: (err) => setError(err.message),
          },
        )
      }}
    >
      <h2 className="sm:col-span-2 text-sm font-medium text-violet-100">New escalation</h2>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Brand
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          required
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Severity
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as typeof severity)}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </label>
      <label className="sm:col-span-2 flex flex-col gap-1 text-xs text-slate-400">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          required
        />
      </label>
      <label className="sm:col-span-2 flex flex-col gap-1 text-xs text-slate-400">
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
        />
      </label>
      {error && (
        <p role="alert" className="sm:col-span-2 text-sm text-rose-300">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={create.isPending || !accountId}
          className="rounded-md bg-violet-700 px-3 py-1.5 text-sm text-white hover:bg-violet-600 disabled:opacity-50"
        >
          {create.isPending ? 'Saving…' : 'Create escalation'}
        </button>
      </div>
    </form>
  )
}

function labelStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}
