import { brandHealthFromCsat, BRAND_HEALTH_LABEL } from '@zoo/shared'
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
 * Brand-level overall scores — CSAT %, NPS, responses, health badge.
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

    if (a === null && b === null) return 0
    if (a === null) return 1
    if (b === null) return -1

    return descending ? b - a : a - b
  })

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">
          Brands in the selected scope with CSAT, NPS, response counts and health
        </caption>
        <thead>
          <tr className="border-b border-slate-800 text-xs text-slate-400 uppercase">
            <SortableHeader label="Brand" column="name" {...{ sortKey, descending, onSort }} />
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
            <th className="px-3 py-2 font-medium">Health</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const health = brandHealthFromCsat(row.csatPercent)
            const healthClass =
              health === 'good'
                ? 'text-emerald-300'
                : health === 'watch'
                  ? 'text-amber-300'
                  : health === 'poor'
                    ? 'text-rose-300'
                    : 'text-slate-500'

            return (
              <tr
                key={row.accountId}
                className="border-b border-slate-800/60 hover:bg-slate-800/40"
              >
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
                <td className={`px-3 py-2 text-xs font-medium ${healthClass}`}>
                  {BRAND_HEALTH_LABEL[health]}
                </td>
              </tr>
            )
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                No brands in this scope.
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
