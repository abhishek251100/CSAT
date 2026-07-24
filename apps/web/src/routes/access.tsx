import { ROLE_KEYS, SCOPE_TYPES } from '@zoo/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { DashboardShell } from '../components/dashboard-shell'
import { useDashboard } from '../lib/use-dashboard'
import { useTRPC } from '../lib/trpc'

export const Route = createFileRoute('/access')({
  component: AccessAdmin,
})

/**
 * Admin → Access: list users, grant/revoke memberships (manage_users capability).
 */
function AccessAdmin() {
  const dash = useDashboard()
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const caps = useQuery({
    ...trpc.users.meCapabilities.queryOptions(),
    enabled: dash.ready,
  })

  const users = useQuery({
    ...trpc.users.list.queryOptions(),
    enabled: Boolean(caps.data?.manageUsers),
  })
  const targets = useQuery({
    ...trpc.users.grantTargets.queryOptions(),
    enabled: Boolean(caps.data?.manageUsers),
  })

  const revoke = useMutation(
    trpc.users.revokeMembership.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries(),
    }),
  )

  if (caps.data && !caps.data.manageUsers) {
    return (
      <DashboardShell dash={dash} title="Access" eyebrow="Admin" showAccess>
        <p role="alert" className="rounded-md border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-200">
          You need the manage users capability (super admin or network/agency admin) to open Access.
        </p>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell dash={dash} title="Access" eyebrow="Admin" showAccess>
      <p className="text-sm text-slate-400">
        Grant or revoke memberships. Scope stays network / agency / account — Global is a view filter
        only.
      </p>

      <GrantForm
        users={(users.data ?? []).map((u) => ({ id: u.id, email: u.email }))}
        networks={targets.data?.networks ?? []}
        agencies={targets.data?.agencies ?? []}
        accounts={dash.scopeOptions?.accounts ?? []}
        onDone={() => void queryClient.invalidateQueries()}
      />

      <section className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-400 uppercase">
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Memberships</th>
            </tr>
          </thead>
          <tbody>
            {(users.data ?? []).map((user) => (
              <tr key={user.id} className="border-b border-slate-800/60 align-top">
                <td className="px-3 py-3">
                  <p className="text-slate-100">{user.email}</p>
                  <p className="text-xs text-slate-500">{user.name ?? '—'}</p>
                </td>
                <td className="px-3 py-3">
                  <ul className="space-y-2">
                    {user.memberships.map((membership) => (
                      <li
                        key={membership.id}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-xs"
                      >
                        <span className="font-medium text-slate-200">{membership.role}</span>
                        <span className="text-slate-500">·</span>
                        <span className="text-slate-300">
                          {membership.scopeType}: {membership.scopeLabel}
                        </span>
                        <button
                          type="button"
                          className="ml-auto text-rose-300 hover:underline"
                          onClick={() => {
                            if (confirm(`Revoke ${membership.role} on ${membership.scopeLabel}?`)) {
                              revoke.mutate({ membershipId: membership.id })
                            }
                          }}
                        >
                          Revoke
                        </button>
                      </li>
                    ))}
                    {user.memberships.length === 0 && (
                      <li className="text-xs text-slate-500">No memberships</li>
                    )}
                  </ul>
                </td>
              </tr>
            ))}
            {users.data?.length === 0 && (
              <tr>
                <td colSpan={2} className="px-3 py-8 text-center text-slate-500">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </DashboardShell>
  )
}

function GrantForm({
  users,
  networks,
  agencies,
  accounts,
  onDone,
}: {
  users: { id: string; email: string }[]
  networks: { id: string; name: string }[]
  agencies: { id: string; name: string; networkId: string }[]
  accounts: { id: string; name: string }[]
  onDone: () => void
}) {
  const trpc = useTRPC()
  const grant = useMutation(trpc.users.grantMembership.mutationOptions())
  const [userId, setUserId] = useState(users[0]?.id ?? '')
  const [scopeType, setScopeType] = useState<(typeof SCOPE_TYPES)[number]>('network')
  const [scopeId, setScopeId] = useState(networks[0]?.id ?? '')
  const [role, setRole] = useState<(typeof ROLE_KEYS)[number]>('viewer')
  const [error, setError] = useState<string | null>(null)

  const scopeOptions =
    scopeType === 'network' ? networks : scopeType === 'agency' ? agencies : accounts

  return (
    <form
      className="grid gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        grant.mutate(
          { userId, scopeType, scopeId, role },
          {
            onSuccess: () => onDone(),
            onError: (err) => setError(err.message),
          },
        )
      }}
    >
      <h2 className="sm:col-span-2 lg:col-span-4 text-sm font-medium text-slate-200">
        Grant membership
      </h2>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        User
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          required
        >
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.email}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Scope type
        <select
          value={scopeType}
          onChange={(e) => {
            const next = e.target.value as (typeof SCOPE_TYPES)[number]
            setScopeType(next)
            const first =
              next === 'network' ? networks[0] : next === 'agency' ? agencies[0] : accounts[0]
            setScopeId(first?.id ?? '')
          }}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
        >
          {SCOPE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Scope
        <select
          value={scopeId}
          onChange={(e) => setScopeId(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          required
        >
          {scopeOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Role
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as (typeof ROLE_KEYS)[number])}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
        >
          {ROLE_KEYS.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="sm:col-span-2 lg:col-span-4 text-sm text-rose-300">
          {error}
        </p>
      )}
      <div className="sm:col-span-2 lg:col-span-4">
        <button
          type="submit"
          disabled={grant.isPending || !userId || !scopeId}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {grant.isPending ? 'Saving…' : 'Grant'}
        </button>
      </div>
    </form>
  )
}
