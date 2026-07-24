import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ERROR_CATEGORY_LABEL } from '../lib/chart-theme'
import { useDashboard } from '../lib/use-dashboard'
import { useTRPC } from '../lib/trpc'
import { DashboardShell } from '../components/dashboard-shell'
import { useState } from 'react'

export const Route = createFileRoute('/dsat')({
  component: DsatTab,
})

/**
 * Tab 2 — DSAT list, submitter, RCA status, drill-down, manual entry.
 */
function DsatTab() {
  const dash = useDashboard()
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showManual, setShowManual] = useState(false)

  const caps = useQuery({
    ...trpc.users.meCapabilities.queryOptions(),
    enabled: dash.enabled,
  })

  const list = useQuery({
    ...trpc.dsat.list.queryOptions(dash.input),
    enabled: dash.enabled,
  })

  const detail = useQuery({
    ...trpc.dsat.get.queryOptions({ responseId: selectedId! }),
    enabled: Boolean(selectedId),
  })

  const pendingCount = (list.data ?? []).filter((row) => row.rcaStatus === 'pending').length

  return (
    <DashboardShell dash={dash} title="DSAT" eyebrow="Tab 2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          {list.data
            ? `${list.data.length} DSAT response${list.data.length === 1 ? '' : 's'} · ${pendingCount} pending RCA`
            : 'Loading…'}
        </p>
        {caps.data?.enterResponse && (
          <button
            type="button"
            onClick={() => setShowManual((value) => !value)}
            className="rounded-md border border-sky-800 bg-sky-950/40 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-950/70"
          >
            {showManual ? 'Hide manual entry' : 'Manual response entry'}
          </button>
        )}
      </div>

      {showManual && caps.data?.enterResponse && (
        <ManualEntryForm
          accounts={dash.scopeOptions?.accounts ?? []}
          onDone={() => {
            setShowManual(false)
            void queryClient.invalidateQueries()
          }}
        />
      )}

      <section className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-400 uppercase">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Brand</th>
              <th className="px-3 py-2 font-medium">Agency</th>
              <th className="px-3 py-2 font-medium">Submitted by</th>
              <th className="px-3 py-2 text-right font-medium">Q1</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Feedback</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-slate-800/60 hover:bg-slate-800/50"
                onClick={() => setSelectedId(row.id)}
              >
                <td className="px-3 py-2 tabular-nums text-slate-300">
                  {new Date(row.submittedAt).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 text-slate-100">{row.accountName}</td>
                <td className="px-3 py-2 text-slate-300">{row.agencyName}</td>
                <td className="px-3 py-2 text-slate-300">{row.submittedBy}</td>
                <td className="px-3 py-2 text-right font-medium text-rose-300 tabular-nums">
                  {row.score}
                </td>
                <td className="px-3 py-2 text-slate-300">{rcaStatusLabel(row.rcaStatus)}</td>
                <td className="px-3 py-2 text-slate-400">
                  {row.errorCategory
                    ? (ERROR_CATEGORY_LABEL[row.errorCategory] ?? row.errorCategory)
                    : '—'}
                </td>
                <td className="max-w-[14rem] truncate px-3 py-2 text-slate-400">
                  {row.feedback ?? '—'}
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-500">
                  No DSAT responses in this period for this scope.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {selectedId && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-label="DSAT detail"
        >
          <button
            type="button"
            className="flex-1 cursor-default"
            aria-label="Close"
            onClick={() => setSelectedId(null)}
          />
          <aside className="flex h-full w-full max-w-lg flex-col gap-4 overflow-y-auto border-l border-slate-800 bg-slate-950 p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-50">DSAT detail</h2>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="text-sm text-slate-400 hover:text-slate-200"
              >
                Close
              </button>
            </div>
            {detail.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
            {detail.data && (
              <>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <DtDd label="Brand" value={detail.data.accountName} />
                  <DtDd label="Agency" value={detail.data.agencyName} />
                  <DtDd label="Q1 score" value={String(detail.data.score)} />
                  <DtDd
                    label="Submitted"
                    value={new Date(detail.data.submittedAt).toLocaleString()}
                  />
                  <DtDd
                    label="By"
                    value={
                      detail.data.respondentName ||
                      detail.data.respondentEmail ||
                      detail.data.source
                    }
                  />
                </dl>
                <div>
                  <h3 className="mb-2 text-sm font-medium text-slate-200">Driver answers</h3>
                  <ul className="space-y-2 text-sm">
                    {detail.data.answers.map((answer, index) => (
                      <li
                        key={`${answer.questionLabel}-${index}`}
                        className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2"
                      >
                        <p className="text-xs text-slate-500">{answer.questionLabel}</p>
                        <p className="text-slate-200">
                          {answer.answerText ??
                            (answer.answerValue !== null ? String(answer.answerValue) : '—')}
                        </p>
                      </li>
                    ))}
                    {detail.data.answers.length === 0 && (
                      <li className="text-slate-500">No driver answers stored.</li>
                    )}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-medium text-slate-200">RCA</h3>
                  {detail.data.rca ? (
                    <p className="text-sm text-slate-300">
                      Status: {rcaStatusLabel(detail.data.rca.status)}
                      {detail.data.rca.errorCategory
                        ? ` · ${ERROR_CATEGORY_LABEL[detail.data.rca.errorCategory] ?? detail.data.rca.errorCategory}`
                        : ''}
                    </p>
                  ) : (
                    <p className="text-sm text-amber-300">Pending RCA — no analysis linked yet.</p>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </DashboardShell>
  )
}

function ManualEntryForm({
  accounts,
  onDone,
}: {
  accounts: { id: string; name: string }[]
  onDone: () => void
}) {
  const trpc = useTRPC()
  const create = useMutation(trpc.responses.createManual.mutationOptions())
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [score, setScore] = useState(3)
  const [name, setName] = useState('')
  const [comment, setComment] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="grid gap-3 rounded-lg border border-sky-900/50 bg-sky-950/20 p-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        create.mutate(
          {
            accountId,
            type: 'csat',
            score,
            respondentName: name || undefined,
            comment: comment || undefined,
            submittedAt: new Date(`${date}T12:00:00.000Z`),
          },
          {
            onSuccess: () => onDone(),
            onError: (err) => setError(err.message),
          },
        )
      }}
    >
      <h2 className="sm:col-span-2 text-sm font-medium text-sky-100">Manual CSAT entry</h2>
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
        Q1 score (1–5; ≤3 is DSAT)
        <input
          type="number"
          min={1}
          max={5}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Submitted by (name)
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          placeholder="Client contact"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Date
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          required
        />
      </label>
      <label className="sm:col-span-2 flex flex-col gap-1 text-xs text-slate-400">
        Feedback
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
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
          className="rounded-md bg-sky-700 px-3 py-1.5 text-sm text-white hover:bg-sky-600 disabled:opacity-50"
        >
          {create.isPending ? 'Saving…' : 'Save response'}
        </button>
      </div>
    </form>
  )
}

function DtDd({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-slate-200">{value}</dd>
    </div>
  )
}

function rcaStatusLabel(status: string): string {
  if (status === 'pending') return 'Pending RCA'
  return status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}
