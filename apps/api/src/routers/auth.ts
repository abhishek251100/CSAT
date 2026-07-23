import { CAPABILITIES, can, type Capability } from '@zoo/shared'
import { protectedProcedure, router } from '../trpc'

/**
 * Auth router — SPEC.md §8 ("auth: session, me, logout").
 *
 * Sign-in and sign-out are handled by better-auth's own endpoints under
 * /api/auth, not by tRPC. What tRPC adds is `me`: the caller's identity plus
 * their *resolved* scope, which is what the UI needs to decide which scopes to
 * offer and which actions to render (§9).
 */
export const authRouter = router({
  /**
   * The authenticated caller, as the server sees them.
   *
   * Everything returned here is derived server-side from the session cookie and
   * the memberships table. The client cannot influence it, and re-sending any
   * of it back to the server would be ignored (§12).
   */
  me: protectedProcedure.query(({ ctx }) => {
    const capabilities = CAPABILITIES.filter((capability: Capability) =>
      ctx.session.roles.some((role) => can(role, capability)),
    )

    return {
      userId: ctx.session.userId,
      email: ctx.session.email,
      name: ctx.session.name,
      roles: ctx.session.roles,
      /**
       * Sent so the UI can hide actions the caller cannot perform. It is a
       * convenience, not a control: the server re-checks every capability on
       * the procedure that needs it.
       */
      capabilities,
      canViewNetwork: ctx.session.canViewNetwork,
      visibleAccountIds: ctx.session.visibleAccountIds,
      accountCount: ctx.session.visibleAccountIds.length,
    }
  }),
})
