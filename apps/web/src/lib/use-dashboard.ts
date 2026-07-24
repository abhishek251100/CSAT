import { GLOBAL_SCOPE_ID, type ViewScopeType } from '@zoo/shared'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import type { Grain, ScopeOptions, ScopeType } from '../components/view-controls'
import { useSession } from './auth-client'
import { useTRPC } from './trpc'

const FILTER_KEY = 'cx-dashboard-filters'

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
  input: { scopeType: ScopeType; scopeId: string; grain: Grain; from: string; to: string }
  enabled: boolean
  scopeLabel: string
  entityLabel: string
  scopeAccountIds: string[] | null
  setScope: (scopeType: ScopeType, scopeId: string) => void
  setGrain: (grain: Grain) => void
  setRange: (next: { from?: string; to?: string }) => void
  signOutAndRedirect: () => void
}

/**
 * Shared dashboard shell used by CX metrics, DSAT, and A tracker.
 * Filter state persists in sessionStorage so tab switches keep scope/period.
 */
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

  const saved = readFilters()
  const [scopeType, setScopeType] = useState<ScopeType>(saved?.scopeType ?? 'global')
  const [scopeId, setScopeId] = useState(saved?.scopeId ?? '')
  const [grain, setGrainState] = useState<Grain>(saved?.grain ?? 'monthly')
  const [range, setRangeState] = useState(saved ? { from: saved.from, to: saved.to } : defaultRange)

  useEffect(() => {
    writeFilters({ scopeType, scopeId, grain, from: range.from, to: range.to })
  }, [scopeType, scopeId, grain, range.from, range.to])

  useEffect(() => {
    if (!scopeOptions.data) return
    if (scopeId !== '') return

    const { networks, agencies, accounts, global } = scopeOptions.data
    if (global || accounts.length > 0) setScope('global', GLOBAL_SCOPE_ID)
    else if (networks[0]) setScope('network', networks[0].id)
    else if (agencies[0]) setScope('agency', agencies[0].id)
    else if (accounts[0]) setScope('account', accounts[0].id)
  }, [scopeOptions.data, scopeId])

  function setScope(nextType: ScopeType, nextId: string) {
    setScopeType(nextType)
    setScopeId(nextId)
  }

  const entityLabel = useMemo(() => {
    if (!scopeOptions.data || !scopeId) return ''
    if (scopeType === 'global') return 'All visible accounts'
    if (scopeType === 'network')
      return scopeOptions.data.networks.find((row) => row.id === scopeId)?.name ?? ''
    if (scopeType === 'agency')
      return scopeOptions.data.agencies.find((row) => row.id === scopeId)?.name ?? ''
    return scopeOptions.data.accounts.find((row) => row.id === scopeId)?.name ?? ''
  }, [scopeOptions.data, scopeType, scopeId])

  const scopeAccountIds = useMemo(() => {
    if (!scopeOptions.data || scopeId === '') return null
    const { accounts } = scopeOptions.data
    if (scopeType === 'account') return [scopeId]
    if (scopeType === 'agency') {
      return accounts.filter((account) => account.agencyId === scopeId).map((account) => account.id)
    }
    // network + global: every visible account
    return accounts.map((account) => account.id)
  }, [scopeOptions.data, scopeType, scopeId])

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
    scopeLabel: scopeType.charAt(0).toUpperCase() + scopeType.slice(1),
    entityLabel,
    scopeAccountIds,
    setScope,
    setGrain: setGrainState,
    setRange: (next) =>
      setRangeState((prev) => ({ from: next.from ?? prev.from, to: next.to ?? prev.to })),
    signOutAndRedirect: () => {
      void import('./auth-client').then(({ signOut }) =>
        signOut().then(() => navigate({ to: '/sign-in' })),
      )
    },
  }
}

function defaultRange() {
  const today = new Date()
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1))
  return { from: start.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) }
}

function readFilters(): {
  scopeType: ViewScopeType
  scopeId: string
  grain: Grain
  from: string
  to: string
} | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(FILTER_KEY)
    if (!raw) return null
    return JSON.parse(raw) as {
      scopeType: ViewScopeType
      scopeId: string
      grain: Grain
      from: string
      to: string
    }
  } catch {
    return null
  }
}

function writeFilters(value: {
  scopeType: ScopeType
  scopeId: string
  grain: Grain
  from: string
  to: string
}) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(value))
  } catch {
    // ignore quota / private mode
  }
}
