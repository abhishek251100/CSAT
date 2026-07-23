import { ERROR_CATEGORY_LABEL, SEVERITY_META } from '../lib/chart-theme'

/**
 * The three tables of View 2 — SPEC.md §9: the open action items table (overdue
 * rows flagged), the RCA tracker, and the escalations list.
 *
 * Overdue and severity are shown with an icon and text, never colour alone
 * (§12). Every table scrolls inside its own container so the page body never
 * scrolls sideways.
 */

export interface ActionRow {
  id: string
  title: string
  accountId: string
  status: string
  eta: string | null
  priority: string | null
}

/** Overdue = not done and past its ETA (§6). Computed against today (UTC). */
function isOverdue(row: ActionRow, todayIso: string): boolean {
  return row.status !== 'done' && row.eta !== null && row.eta < todayIso
}

export function ActionItemsTable({
  rows,
  accountName,
}: {
  rows: ActionRow[]
  accountName: (id: string) => string
}) {
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-xs text-slate-400 uppercase">
            <th className="px-3 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium">Account</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Priority</th>
            <th className="px-3 py-2 font-medium">ETA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const overdue = isOverdue(row, today)

            return (
              <tr
                key={row.id}
                className={
                  overdue
                    ? 'border-b border-amber-900/40 bg-amber-950/20'
                    : 'border-b border-slate-800/60'
                }
              >
                <td className="px-3 py-2 text-slate-100">{row.title}</td>
                <td className="px-3 py-2 text-slate-300">{accountName(row.accountId)}</td>
                <td className="px-3 py-2 text-slate-300">{statusLabel(row.status)}</td>
                <td className="px-3 py-2 text-slate-300">{row.priority ?? '—'}</td>
                <td className="px-3 py-2 tabular-nums text-slate-300">
                  {row.eta ?? '—'}
                  {overdue && (
                    <span className="ml-2 text-xs text-amber-300">
                      <span aria-hidden="true">⚠ </span>Overdue
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                No open action items in this scope.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export interface RcaTrackerRow {
  id: string
  accountName: string
  subjectType: string
  method: string
  errorCategory: string | null
  status: string
  linkedActions: number
}

export function RcaTrackerTable({ rows }: { rows: RcaTrackerRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-xs text-slate-400 uppercase">
            <th className="px-3 py-2 font-medium">Subject</th>
            <th className="px-3 py-2 font-medium">Account</th>
            <th className="px-3 py-2 font-medium">Method</th>
            <th className="px-3 py-2 font-medium">Error category</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-800/60">
              <td className="px-3 py-2 text-slate-200">
                {row.subjectType === 'escalation' ? 'Escalation' : 'DSAT response'}
              </td>
              <td className="px-3 py-2 text-slate-300">{row.accountName}</td>
              <td className="px-3 py-2 text-slate-300">{methodLabel(row.method)}</td>
              <td className="px-3 py-2 text-slate-300">
                {row.errorCategory
                  ? (ERROR_CATEGORY_LABEL[row.errorCategory] ?? row.errorCategory)
                  : '—'}
              </td>
              <td className="px-3 py-2 text-slate-300">{statusLabel(row.status)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                {row.linkedActions}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                No RCAs in this scope.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export interface EscalationRow {
  id: string
  title: string
  accountId: string
  severity: string
  status: string
  /** A Date after superjson deserialisation on the client. */
  reportedAt: Date | string
}

export function EscalationsList({
  rows,
  accountName,
}: {
  rows: EscalationRow[]
  accountName: (id: string) => string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-xs text-slate-400 uppercase">
            <th className="px-3 py-2 font-medium">Escalation</th>
            <th className="px-3 py-2 font-medium">Account</th>
            <th className="px-3 py-2 font-medium">Severity</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Reported</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const severity = SEVERITY_META[row.severity] ?? { label: row.severity, className: '' }

            return (
              <tr key={row.id} className="border-b border-slate-800/60">
                <td className="px-3 py-2 text-slate-100">{row.title}</td>
                <td className="px-3 py-2 text-slate-300">{accountName(row.accountId)}</td>
                <td className={`px-3 py-2 font-medium ${severity.className}`}>
                  {/* Icon + text, so severity never reads by colour alone. */}
                  <span aria-hidden="true">{row.severity === 'critical' ? '● ' : ''}</span>
                  {severity.label}
                </td>
                <td className="px-3 py-2 text-slate-300">{statusLabel(row.status)}</td>
                <td className="px-3 py-2 tabular-nums text-slate-300">
                  {new Date(row.reportedAt).toLocaleDateString()}
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                No escalations in this scope.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function methodLabel(method: string): string {
  if (method === 'five_whys') return '5 Whys'
  if (method === 'fishbone') return 'Fishbone'
  return method.replace(/^\w/, (c) => c.toUpperCase())
}
