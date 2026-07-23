export type ScopeType = 'network' | 'agency' | 'account'
export type Grain = 'monthly' | 'quarterly' | 'custom'

export interface ScopeOptions {
  networks: { id: string; name: string }[]
  agencies: { id: string; name: string }[]
  /** `agencyId` lets View 2 narrow the account set to the selected agency. */
  accounts: { id: string; name: string; agencyId: string }[]
}

/**
 * Global controls — SPEC.md §9: "scope switch (Network / Agency / Account),
 * account or agency picker (options limited by RBAC scope), period grain
 * (Monthly / Quarterly / Custom), date range."
 *
 * The picker is populated from `org.scopeOptions`, which derives its list from
 * `resolveVisibleAccounts` — so a scope the server would refuse is never
 * offered. A tier with no options is disabled rather than hidden, so the
 * hierarchy stays legible: an account manager can see that network and agency
 * views exist without being able to select them.
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
  const optionsFor = (tier: ScopeType) =>
    tier === 'network' ? options.networks : tier === 'agency' ? options.agencies : options.accounts

  const current = optionsFor(scopeType)

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

            // Move the selection with the tier; an empty tier keeps the id blank
            // and the dashboard renders its empty state rather than querying.
            onChange({ scopeType: nextTier, scopeId: first?.id ?? '' })
          }}
          className={selectClass}
        >
          <option value="network" disabled={options.networks.length === 0}>
            Network
          </option>
          <option value="agency" disabled={options.agencies.length === 0}>
            Agency
          </option>
          <option value="account" disabled={options.accounts.length === 0}>
            Account
          </option>
        </select>
      </Field>

      <Field
        label={scopeType === 'account' ? 'Account' : scopeType === 'agency' ? 'Agency' : 'Network'}
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

const selectClass =
  'rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 disabled:opacity-50'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      {children}
    </label>
  )
}
