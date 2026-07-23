import { accounts, agencies, networks } from '@zoo/db/schema'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { assertAccountInScope, intersectWithScope, protectedProcedure, router } from '../trpc'

/**
 * Org router — SPEC.md §8 ("account list scoped to caller").
 *
 * Every read here filters by `ctx.session.visibleAccountIds`, which was
 * resolved server-side from `memberships` before any procedure ran (§5.2).
 * There is no code path in this file that can return a row outside that set.
 */
export const orgRouter = router({
  /**
   * The scopes this caller may switch between — §9's "account or agency picker
   * (options limited by RBAC scope)".
   *
   * Derived from the resolved account set, so the picker cannot offer a scope
   * the server would then refuse. An agency appears only when *every* one of its
   * accounts is visible, matching `resolveScopeAccounts`: an aggregate figure
   * pools all of them, so partial visibility must not offer it.
   */
  scopeOptions: protectedProcedure.query(async ({ ctx }) => {
    const visible = new Set(ctx.session.visibleAccountIds)

    if (visible.size === 0) {
      return { networks: [], agencies: [], accounts: [] }
    }

    const rows = await ctx.db
      .select({
        accountId: accounts.id,
        accountName: accounts.name,
        agencyId: agencies.id,
        agencyName: agencies.name,
        networkId: networks.id,
        networkName: networks.name,
      })
      .from(accounts)
      .innerJoin(agencies, eq(accounts.agencyId, agencies.id))
      .innerJoin(networks, eq(agencies.networkId, networks.id))
      .where(isNull(accounts.deletedAt))
      .orderBy(asc(accounts.name))

    const accountOptions = rows
      .filter((row) => visible.has(row.accountId))
      .map((row) => ({ id: row.accountId, name: row.accountName, agencyId: row.agencyId }))

    const fullyVisible = (predicate: (row: (typeof rows)[number]) => boolean) =>
      rows.filter(predicate).every((row) => visible.has(row.accountId)) && rows.some(predicate)

    const agencyOptions = [...new Map(rows.map((row) => [row.agencyId, row])).values()]
      .filter((agency) => fullyVisible((row) => row.agencyId === agency.agencyId))
      .map((agency) => ({ id: agency.agencyId, name: agency.agencyName }))

    /** Network tier additionally requires the §5.3 capability, not just visibility. */
    const networkOptions = !ctx.session.canViewNetwork
      ? []
      : [...new Map(rows.map((row) => [row.networkId, row])).values()]
          .filter((network) => fullyVisible((row) => row.networkId === network.networkId))
          .map((network) => ({ id: network.networkId, name: network.networkName }))

    return { networks: networkOptions, agencies: agencyOptions, accounts: accountOptions }
  }),

  /**
   * Accounts the caller can see.
   *
   * `accountIds` is a *filter*, not a permission claim: it is intersected with
   * the resolved scope, so naming an account the caller cannot see narrows the
   * result rather than widening it (§12, "no trust in client-sent scope").
   */
  listAccounts: protectedProcedure
    .input(z.object({ accountIds: z.array(z.uuid()).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const scopedIds = intersectWithScope(ctx.session, input?.accountIds)

      // inArray with an empty list is invalid SQL in Postgres, and a user with
      // no memberships legitimately reaches here.
      if (scopedIds.length === 0) return []

      return ctx.db
        .select({
          id: accounts.id,
          name: accounts.name,
          slug: accounts.slug,
          agencyId: accounts.agencyId,
          status: accounts.status,
        })
        .from(accounts)
        .where(and(inArray(accounts.id, scopedIds), isNull(accounts.deletedAt)))
        .orderBy(asc(accounts.name))
    }),

  /**
   * A single account, if it is in scope.
   *
   * §5.2: "Every single-entity fetch checks membership before returning." The
   * check runs before the query, so an out-of-scope id is never even read.
   */
  getAccount: protectedProcedure
    .input(z.object({ accountId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      assertAccountInScope(ctx.session, input.accountId)

      const [account] = await ctx.db
        .select()
        .from(accounts)
        .where(and(inArray(accounts.id, [input.accountId]), isNull(accounts.deletedAt)))
        .limit(1)

      if (!account) {
        throw new Error('Account not found')
      }

      return account
    }),
})
