import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@zoo/api/router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import superjson from 'superjson'
import { env } from './env'
import { TRPCProvider } from './lib/trpc'
import { routeTree } from './routeTree.gen'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

/**
 * superjson must match the server transformer configured in apps/api/src/trpc.ts.
 * If one side changes, payloads deserialise incorrectly rather than failing loudly.
 */
const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${env.VITE_API_URL}/api/trpc`,
      transformer: superjson,
      // Sends the better-auth session cookie once Milestone 3 lands.
      fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
    }),
  ],
})

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  context: { queryClient },
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element #root not found in index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <RouterProvider router={router} />
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>,
)
