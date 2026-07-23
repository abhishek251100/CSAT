import { formatMetric, NPS_BAND_LABEL } from '../lib/chart-theme'

export interface LeaderboardRow {
  accountId: string
  name: string
  csatPercent: number | null
  nps: number | null
  npsBand: string | null
  responseCount: number
  dsatCount: number
}

type SortKey = 'name' | 'csatPercent' | 'nps' | 'responseCount'

/**
 * Account leaderboard — SPEC.md §9: "at agency/network scope: account
 * leaderboard table (account, CSAT %, NPS, responses, trend) sortable, with
 * drill-down to the account view."
 *
 * Doubles as the table fallback §12 requires for the charts above it: every
 * figure on this page is also readable as text, so nothing depends on reading a
 * colour or a chart.
 *
 * Accounts with no responses sort last regardless of direction — a null is
 * "unknown", and letting it win a "best CSAT" sort would be actively
 * misleading.
 */
export function Leaderboard({
  rows,
  sortKey,
  descending,
  onSort,
  onDrillDown,
}: {
  rows: LeaderboardRow[]
  sortKey: SortKey
  descending: boolean
  onSort: (key: SortKey) => void
  onDrillDown: (accountId: string) => void
}) {
  const sorted = [...rows].sort((left, right) => {
    if (sortKey === 'name') {
      return descending ? right.name.localeCompare(left.name) : left.name.localeCompare(right.name)
    }

    const a = left[sortKey]
    const b = right[sortKey]

    // Nulls always sink, so "no data" never tops a ranking.
    if (a === null && b === null) return 0
    if (a === null) return 1
    if (b === null) return -1

    return descending ? b - a : a - b
  })

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <caption className="sr-only">
          Accounts in the selected scope with CSAT, NPS and response counts for the period
        </caption>
        <thead>
          <tr className="border-b border-slate-800 text-xs text-slate-400 uppercase">
            <SortableHeader label="Account" column="name" {...{ sortKey, descending, onSort }} />
            <SortableHeader
              label="CSAT %"
              column="csatPercent"
              align="right"
              {...{ sortKey, descending, onSort }}
            />
            <SortableHeader
              label="NPS"
              column="nps"
              align="right"
              {...{ sortKey, descending, onSort }}
            />
            <th className="px-3 py-2 font-medium">Band</th>
            <SortableHeader
              label="Responses"
              column="responseCount"
              align="right"
              {...{ sortKey, descending, onSort }}
            />
            <th className="px-3 py-2 text-right font-medium">DSAT</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.accountId} className="border-b border-slate-800/60 hover:bg-slate-800/40">
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onDrillDown(row.accountId)}
                  className="text-slate-100 underline-offset-4 hover:underline"
                >
                  {row.name}
                </button>
              </td>
              <td className="px-3 py-2 text-right text-slate-200 tabular-nums">
                {formatMetric(row.csatPercent, { suffix: '%' })}
              </td>
              <td className="px-3 py-2 text-right text-slate-200 tabular-nums">
                {formatMetric(row.nps)}
              </td>
              <td className="px-3 py-2 text-xs text-slate-400">
                {row.npsBand ? (NPS_BAND_LABEL[row.npsBand] ?? row.npsBand) : '—'}
              </td>
              <td className="px-3 py-2 text-right text-slate-200 tabular-nums">
                {row.responseCount}
              </td>
              <td className="px-3 py-2 text-right text-slate-200 tabular-nums">{row.dsatCount}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                No accounts in this scope.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function SortableHeader({
  label,
  column,
  align = 'left',
  sortKey,
  descending,
  onSort,
}: {
  label: string
  column: SortKey
  align?: 'left' | 'right'
  sortKey: SortKey
  descending: boolean
  onSort: (key: SortKey) => void
}) {
  const active = sortKey === column

  return (
    <th
      scope="col"
      aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
      className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : ''}`}
    >
      <button type="button" onClick={() => onSort(column)} className="hover:text-slate-200">
        {label}
        <span aria-hidden="true"> {active ? (descending ? '▾' : '▴') : ''}</span>
      </button>
    </th>
  )
}
