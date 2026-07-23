import type { AppRouter } from '@zoo/api/router'
import { createTRPCContext } from '@trpc/tanstack-react-query'

/**
 * The client half of the end-to-end type contract.
 *
 * `AppRouter` is imported as a *type only*, so this line disappears at build
 * time and no server code is bundled into the browser. Every procedure name,
 * input shape, and return shape is inferred from the server's router
 * definition — there is no hand-written client API surface to drift.
 */
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>()
