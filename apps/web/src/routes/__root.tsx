import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'

/**
 * Root route. The QueryClient is threaded through router context so future
 * route loaders can prefetch tRPC queries before a component renders
 * (Milestone 5 onwards).
 */
export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased">
      <Outlet />
    </div>
  )
}
