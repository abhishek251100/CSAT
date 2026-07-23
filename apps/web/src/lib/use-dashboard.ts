import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { Grain, ScopeOptions, ScopeType } from '../components/view-controls'
import { useSession } from './auth-client'
import { useTRPC } from './trpc'

/**
 * Shared dashboard shell — SPEC.md §9's global controls, used by both View 1
 * and View 2.
 *
 * Extracted so the two views cannot drift on the parts §9 says they share: the
 * scope switch, the account/agency picker limited by `resolveVisibleAccounts`,
 * and the period grain + range. A view adds only its own data queries on top of
 * the `{ scopeType, scopeId, grain, from, to }` this returns.
 */
export interface DashboardScope {
  ready: boolean
  session: ReturnType<typeof useSession>['data']
  scopeOptions: ScopeOptions | undefined
  me: { email: string; accountCount: number } | undefined
  scopeType: ScopeType
  scopeId: string
  grain: Grain
  from: string
  to: string
  /** The scope query input every §9 procedure takes. */
  input: { scopeType: ScopeType; scopeId: string; grain: Grain; from: string; to: string }
  /** True once a scope is selected and a query may run. */
  enabled: boolean
  setScope: (scopeType: ScopeType, scopeId: string) => void
  setGrain: (grain: Grain) => void
  setRange: (next: { from?: string; to?: string }) => void
  signOutAndRedirect: () => void
}

export function useDashboard(): DashboardScope {
  const navigate = useNavigate()
  const { data: session, isPending } = useSession()
  const trpc = useTRPC()

  useEffect(() => {
    if (!isPending && !session) void navigate({ to: '/sign-in' })
  }, [isPending, session, navigate])

  const me = useQuery({ ...trpc.auth.me.queryOptions(), enabled: Boolean(session) })
  const scopeOptions = useQuery({
    ...trpc.org.scopeOptions.queryOptions(),
    enabled: Boolean(session),
  })

  const [scopeType, setScopeType] = useState<ScopeType>('account')
  const [scopeId, setScopeId] = useState('')
  const [grain, setGrain] = useState<Grain>('monthly')
  const [range, setRangeState] = useState(defaultRange)

  // Default to the widest scope the caller holds (network > agency > account),
  // so the picker never opens on something the server would refuse.
  useEffect(() => {
    if (scopeId !== '' || !scopeOptions.data) return

    const { networks, agencies, accounts } = scopeOptions.data
    if (networks[0]) setScope('network', networks[0].id)
    else if (agencies[0]) setScope('agency', agencies[0].id)
    else if (accounts[0]) setScope('account', accounts[0].id)
  }, [scopeOptions.data, scopeId])

  function setScope(nextType: ScopeType, nextId: string) {
    setScopeType(nextType)
    setScopeId(nextId)
  }

  return {
    ready: !isPending && Boolean(session),
    session,
    scopeOptions: scopeOptions.data,
    me: me.data ? { email: me.data.email, accountCount: me.data.accountCount } : undefined,
    scopeType,
    scopeId,
    grain,
    from: range.from,
    to: range.to,
    input: { scopeType, scopeId, grain, from: range.from, to: range.to },
    enabled: Boolean(session) && scopeId !== '',
    setScope,
    setGrain,
    setRange: (next) =>
      setRangeState((prev) => ({ from: next.from ?? prev.from, to: next.to ?? prev.to })),
    signOutAndRedirect: () => {
      void import('./auth-client').then(({ signOut }) =>
        signOut().then(() => navigate({ to: '/sign-in' })),
      )
    },
  }
}

/** Defaults to the last six months, ending today. */
function defaultRange() {
  const today = new Date()
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1))

  return { from: start.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) }
}
