import type { AppDb } from '@zoo/db'
import type { RoleKey } from '@zoo/shared'
import type { ServerEnv } from './env'

/**
 * Per-request tRPC context.
 *
 * Deliberately free of Node-specific types: apps/web pulls the AppRouter type
 * through this file, so anything referenced here must typecheck in a browser
 * project too.
 *
 * Declared as a type alias rather than an interface on purpose: @hono/trpc-server
 * requires the context to be assignable to `Record<string, unknown>`, and only
 * type aliases receive an implicit index signature.
 */

/**
 * The authenticated caller, derived from the session cookie on every request.
 *
 * Nothing here is ever read from client input — §12 forbids trusting
 * client-sent scope, so identity and scope are resolved server-side from the
 * session and the `memberships` table alone.
 */
export interface AuthenticatedSession {
  readonly userId: string
  readonly email: string
  readonly name: string
  /** Every role the user holds, across all scopes. Capability checks use these. */
  readonly roles: readonly RoleKey[]
  /**
   * The account ids this user may see, from `resolveVisibleAccounts` (§5.2).
   * Resolved once per request. Empty is a valid, common state: a user with no
   * membership sees nothing.
   */
  readonly visibleAccountIds: readonly string[]
  /** True when a network-tier membership grants the network-level view (§5.3). */
  readonly canViewNetwork: boolean
}

export type ApiContext = {
  readonly env: ServerEnv
  readonly db: AppDb
  /** Correlates log lines and audit entries for a single request. */
  readonly requestId: string
  /** Null for unauthenticated callers. `protectedProcedure` narrows it away. */
  readonly session: AuthenticatedSession | null
}
