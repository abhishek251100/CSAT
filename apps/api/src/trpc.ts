import { initTRPC, TRPCError } from '@trpc/server'
import { can, type Capability } from '@zoo/shared'
import superjson from 'superjson'
import type { ApiContext, AuthenticatedSession } from './context'

/**
 * tRPC root and the auth/scope middleware chain — SPEC.md §5, §8, §12.
 *
 * superjson is configured from the start so Date, Map, and Set survive the wire
 * intact. Milestones 4+ return real timestamps from metric rollups; adding a
 * transformer later would silently change every existing payload's shape.
 */
const t = initTRPC.context<ApiContext>().create({
  transformer: superjson,
})

export const router = t.router
export const middleware = t.middleware
export const createCallerFactory = t.createCallerFactory

/**
 * Unauthenticated procedure.
 *
 * §8 requires every procedure to pass auth + scope middleware. The health check
 * is the one deliberate exception: a liveness probe that must answer before a
 * session exists, and reads no data.
 *
 * The other planned exception is the tokenised public survey submission in
 * §7.2, which carries its own token guard and rate limit. Nothing that reads
 * account data may be built on this.
 */
export const publicProcedure = t.procedure

/**
 * Rejects unauthenticated callers and narrows `session` to non-null.
 *
 * After this middleware the type system stops `ctx.session` being possibly
 * null, so a procedure cannot forget to check — omitting the check becomes a
 * compile error rather than a silent data leak.
 */
const requireAuth = t.middleware(({ ctx, next }) => {
  if (ctx.session === null) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign-in required.' })
  }

  return next({ ctx: { ...ctx, session: ctx.session } })
})

/**
 * Authenticated procedure. Scope is already resolved on the context by the time
 * this runs — see createContext in app.ts, which calls resolveVisibleAccounts
 * once per request.
 */
export const protectedProcedure = t.procedure.use(requireAuth)

/**
 * Guards a procedure behind a §5.3 capability.
 *
 * Capability and scope are independent checks and both apply: holding
 * `manage_users` says what a role may do, `visibleAccountIds` says where. An
 * agency_admin holds the capability but only ever over their own agency, which
 * is how §5.3's "scope only" cell is expressed.
 */
export function requireCapability(capability: Capability) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!ctx.session.roles.some((role) => can(role, capability))) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Your role does not permit ${capability}.`,
      })
    }

    return next({ ctx })
  })
}

/**
 * Asserts an account is inside the caller's resolved scope — SPEC.md §5.2:
 * "Every single-entity fetch checks membership before returning."
 *
 * Throws NOT_FOUND rather than FORBIDDEN on purpose. FORBIDDEN confirms the
 * account exists, which leaks the shape of the network to someone outside it;
 * an out-of-scope account should be indistinguishable from one that does not
 * exist.
 */
export function assertAccountInScope(session: AuthenticatedSession, accountId: string): void {
  if (!session.visibleAccountIds.includes(accountId)) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found.' })
  }
}

/**
 * Narrows a caller-supplied list of account ids to those actually in scope.
 *
 * The intersection is taken server-side and the client's list is treated purely
 * as a filter request, never as an authorisation claim (§12: "no trust in
 * client-sent scope"). Passing no filter means "everything I can see", not
 * "everything".
 */
export function intersectWithScope(
  session: AuthenticatedSession,
  requestedAccountIds?: readonly string[],
): string[] {
  if (!requestedAccountIds || requestedAccountIds.length === 0) {
    return [...session.visibleAccountIds]
  }

  const visible = new Set(session.visibleAccountIds)

  return requestedAccountIds.filter((accountId) => visible.has(accountId))
}
