import { GLOBAL_SCOPE_ID, type ViewScopeType } from '@zoo/shared'
import type { ReactNode } from 'react'

export type ScopeType = ViewScopeType
export type Grain = 'monthly' | 'quarterly' | 'custom'

export interface ScopeOptions {
  global?: boolean
  networks: { id: string; name: string }[]
  agencies: { id: string; name: string }[]
  accounts: { id: string; name: string; agencyId: string }[]
}

/**
 * Global controls — scope switch (Global / Network / Agency / Account),
 * entity picker, period grain, date range, plus sticky period chip support.
 */
export function ViewControls({
  options,
  scopeType,
  scopeId,
  grain,
  from,
  to,
  onChange,
}: {
  options: ScopeOptions
  scopeType: ScopeType
  scopeId: string
  grain: Grain
  from: string
  to: string
  onChange: (next: {
    scopeType?: ScopeType
    scopeId?: string
    grain?: Grain
    from?: string
    to?: string
  }) => void
}) {
  const optionsFor = (tier: ScopeType) => {
    if (tier === 'global') return [{ id: GLOBAL_SCOPE_ID, name: 'All visible accounts' }]
    if (tier === 'network') return options.networks
    if (tier === 'agency') return options.agencies
    return options.accounts
  }

  const current = optionsFor(scopeType)
  const globalEnabled = options.global !== false && (options.accounts.length > 0 || options.global)

  return (
    <section
      aria-label="View controls"
      className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <Field label="Scope">
        <select
          value={scopeType}
          onChange={(event) => {
            const nextTier = event.target.value as ScopeType
            const first = optionsFor(nextTier)[0]
            onChange({ scopeType: nextTier, scopeId: first?.id ?? '' })
          }}
          className={selectClass}
        >
          <option value="global" disabled={!globalEnabled}>
            Global
          </option>
          <option value="network" disabled={options.networks.length === 0}>
            Network
          </option>
          <option value="agency" disabled={options.agencies.length === 0}>
            Agency
          </option>
          <option value="account" disabled={options.accounts.length === 0}>
            Account / Brand
          </option>
        </select>
      </Field>

      <Field
        label={
          scopeType === 'account'
            ? 'Brand'
            : scopeType === 'agency'
              ? 'Agency'
              : scopeType === 'network'
                ? 'Network'
                : 'Coverage'
        }
      >
        <select
          value={scopeId}
          onChange={(event) => onChange({ scopeId: event.target.value })}
          disabled={current.length === 0}
          className={selectClass}
        >
          {current.length === 0 && <option value="">None available</option>}
          {current.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Period">
        <select
          value={grain}
          onChange={(event) => onChange({ grain: event.target.value as Grain })}
          className={selectClass}
        >
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="custom">Custom</option>
        </select>
      </Field>

      <Field label="From">
        <input
          type="date"
          value={from}
          onChange={(event) => onChange({ from: event.target.value })}
          className={selectClass}
        />
      </Field>

      <Field label="To">
        <input
          type="date"
          value={to}
          onChange={(event) => onChange({ to: event.target.value })}
          className={selectClass}
        />
      </Field>
    </section>
  )
}

export function PeriodChip({
  scopeLabel,
  entityLabel,
  grain,
  from,
  to,
}: {
  scopeLabel: string
  entityLabel: string
  grain: Grain
  from: string
  to: string
}) {
  return (
    <p
      className="sticky top-0 z-20 border-b border-sky-900/60 bg-slate-950/95 px-1 py-2 text-sm text-sky-100 backdrop-blur"
      role="status"
    >
      <span className="font-medium text-sky-300">Viewing:</span> {scopeLabel}
      {entityLabel ? ` · ${entityLabel}` : ''} · {grain} · {from} → {to}
    </p>
  )
}

const selectClass =
  'rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 disabled:opacity-50'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      {children}
    </label>
  )
}
