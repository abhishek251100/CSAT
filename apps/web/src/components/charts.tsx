import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CHART } from '../lib/chart-theme'

/**
 * View 1 charts — SPEC.md §9.
 *
 * All Recharts. §10 is explicit that data charts stay 2D and that Three.js is
 * limited to three ambient surfaces; nothing here renders a metric in 3D.
 *
 * Shared conventions, from the data-viz method:
 *  - 2px lines, ≥8px markers, recessive grid and axes
 *  - a legend whenever there are two or more series (one series is named by the
 *    chart title instead)
 *  - a tooltip on every chart, since an SVG chart is interactive by default
 *  - null renders as a gap, never as zero (§6's empty-set convention)
 */

const axisProps = {
  stroke: CHART.axis,
  tick: { fill: CHART.tickText, fontSize: 11 },
  tickLine: false,
} as const

/**
 * Recharts hands the formatter `undefined` for a gap in the series, which is
 * exactly what a period with no responses produces. Rendering an em dash keeps
 * "no data" distinct from a real zero (§6) instead of showing "undefined".
 */
function formatPoint(name: string, suffix = '') {
  return (value: unknown): [string, string] =>
    typeof value === 'number' ? [`${value}${suffix}`, name] : ['—', name]
}

const tooltipProps = {
  contentStyle: {
    background: CHART.tooltipBg,
    border: `1px solid ${CHART.tooltipBorder}`,
    borderRadius: 6,
    fontSize: 12,
  },
  labelStyle: { color: '#e2e8f0' },
  cursor: { stroke: CHART.axis },
} as const

export interface TrendPoint {
  label: string
  csatPercent: number | null
  nps: number | null
  responseCount: number
  promoters: number
  passives: number
  detractors: number
}

/** CSAT % over the selected grain (§9 View 1). Single series — no legend. */
export function CsatTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis domain={[0, 100]} unit="%" {...axisProps} />
        <Tooltip {...tooltipProps} formatter={formatPoint('CSAT', '%')} />
        <Line
          type="monotone"
          dataKey="csatPercent"
          name="CSAT %"
          stroke={CHART.series}
          strokeWidth={2}
          dot={{ r: 4, fill: CHART.series }}
          activeDot={{ r: 6 }}
          // A period with no responses breaks the line rather than dropping to
          // zero, which would read as "nobody was satisfied".
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** NPS over the selected grain. Range is fixed to -100..100 (§6). */
export function NpsTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis domain={[-100, 100]} {...axisProps} />
        <Tooltip {...tooltipProps} formatter={formatPoint('NPS')} />
        <Line
          type="monotone"
          dataKey="nps"
          name="NPS"
          stroke={CHART.series}
          strokeWidth={2}
          dot={{ r: 4, fill: CHART.series }}
          activeDot={{ r: 6 }}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

/**
 * Promoters / passives / detractors per period (§9 View 1).
 *
 * Blue and red poles with a neutral middle — not green and red, which are
 * indistinguishable under deuteranopia. Legend, direct segment order and a 2px
 * surface gap between segments give the secondary encoding the neutral
 * midpoint requires.
 */
export function NpsBandChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} />
        <Tooltip {...tooltipProps} />
        <Legend wrapperStyle={{ fontSize: 12, color: CHART.tickText }} />
        <Bar
          dataKey="promoters"
          name="Promoters (9-10)"
          stackId="nps"
          fill={CHART.positive}
          stroke={CHART.surface}
          strokeWidth={2}
        />
        <Bar
          dataKey="passives"
          name="Passives (7-8)"
          stackId="nps"
          fill={CHART.neutral}
          stroke={CHART.surface}
          strokeWidth={2}
        />
        <Bar
          dataKey="detractors"
          name="Detractors (0-6)"
          stackId="nps"
          fill={CHART.negative}
          stroke={CHART.surface}
          strokeWidth={2}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

export interface CategorySlice {
  key: string
  label: string
  count: number
  color: string
}

/**
 * People / process / product error-category pie (§9 View 2, §6).
 *
 * A categorical trio validated all-pairs on this surface. Each slice is
 * labelled and appears in the legend, and the centre shows the total, so the
 * split never depends on colour alone (§12). Empty state (no categorised RCAs)
 * is handled by the caller.
 */
export function ErrorCategoryPie({ data }: { data: CategorySlice[] }) {
  const total = data.reduce((sum, slice) => sum + slice.count, 0)

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Tooltip
            {...tooltipProps}
            formatter={(value: unknown, _name: unknown, entry: { payload?: CategorySlice }) => [
              `${value} (${total > 0 ? Math.round((Number(value) / total) * 100) : 0}%)`,
              entry.payload?.label ?? '',
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: CHART.tickText }} />
          <Pie
            data={data}
            dataKey="count"
            nameKey="label"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
            stroke={CHART.surface}
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((slice) => (
              <Cell key={slice.key} fill={slice.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {/*
        Text breakdown beside the chart — the §12 table fallback, and the
        secondary encoding that keeps the split legible without reading colour.
      */}
      <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-slate-300">
        {data.map((slice) => (
          <li key={slice.key} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: slice.color }}
            />
            <span className="font-medium text-slate-200">{slice.label}</span>
            <span className="tabular-nums">
              {slice.count} ({total > 0 ? Math.round((slice.count / total) * 100) : 0}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface DistributionBar {
  score: string
  count: number
  satisfied: boolean
}

/**
 * CSAT 1-5 histogram (§9 View 1).
 *
 * Colour carries §1's rule that 4-5 are satisfied and 1-3 are DSAT. The axis
 * labels and the legend state the same thing, so the split never depends on
 * hue alone.
 */
export function CsatDistributionChart({ data }: { data: DistributionBar[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="score" {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} />
        <Tooltip {...tooltipProps} formatter={formatPoint('Responses')} />
        <Bar dataKey="count" name="Responses" radius={[4, 4, 0, 0]}>
          {data.map((bar) => (
            <Cell
              key={bar.score}
              fill={bar.satisfied ? CHART.positive : CHART.negative}
              stroke={CHART.surface}
              strokeWidth={2}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
