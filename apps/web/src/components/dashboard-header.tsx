import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/**
 * Shared header for the two dashboard views (§9), with tabs between them and
 * sign-out. The active tab is derived from the route, so the two views present
 * as one app rather than two pages.
 */
export function DashboardHeader({
  email,
  onSignOut,
}: {
  email: string | undefined
  onSignOut: () => void
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
      <nav className="flex items-center gap-1" aria-label="Views">
        <Tab to="/">Satisfaction &amp; Loyalty</Tab>
        <Tab to="/actionables">Feedback &amp; Actionables</Tab>
      </nav>
      <div className="flex items-center gap-3 text-xs text-slate-500">
        {email && <span>{email}</span>}
        <button
          type="button"
          onClick={onSignOut}
          className="underline-offset-4 hover:text-slate-300 hover:underline"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}

function Tab({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-md px-3 py-1.5 text-sm text-slate-400 transition hover:text-slate-200"
      activeOptions={{ exact: true }}
      activeProps={{
        className: 'rounded-md px-3 py-1.5 text-sm font-medium text-slate-50 bg-slate-800',
      }}
    >
      {children}
    </Link>
  )
}
