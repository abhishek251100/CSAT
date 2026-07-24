import type { AppDb } from '@zoo/db'
import { accounts, agencies, memberships } from '@zoo/db/schema'
import {
  can,
  GLOBAL_SCOPE_ID,
  resolveVisibleAccountIds,
  type RoleKey,
  type ScopeMembership,
  type ScopeType,
  type ViewScopeType,
} from '@zoo/shared'
import { TRPCError } from '@trpc/server'
import { and, eq, isNull } from 'drizzle-orm'

/**
 * Database-backed scope resolution — SPEC.md §5.2 + Global virtual scope.
 */

export async function resolveScopeAccounts(
  db: AppDb,
  session: { visibleAccountIds: readonly string[]; canViewNetwork: boolean },
  scopeType: ViewScopeType | ScopeType,
  scopeId: string,
): Promise<string[]> {
  const visible = new Set(session.visibleAccountIds)

  if (scopeType === 'global') {
    if (scopeId !== GLOBAL_SCOPE_ID) throw notFound()
    if (visible.size === 0) throw notFound()
    return [...visible]
  }

  if (scopeType === 'account') {
    if (!visible.has(scopeId)) throw notFound()

    return [scopeId]
  }

  if (scopeType === 'agency') {
    const rows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.agencyId, scopeId), isNull(accounts.deletedAt)))

    return assertAllVisible(rows, visible)
  }

  if (!session.canViewNetwork) throw notFound()

  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .innerJoin(agencies, eq(accounts.agencyId, agencies.id))
    .where(and(eq(agencies.networkId, scopeId), isNull(accounts.deletedAt)))

  return assertAllVisible(rows, visible)
}

function assertAllVisible(rows: { id: string }[], visible: ReadonlySet<string>): string[] {
  if (rows.length === 0) throw notFound()

  const ids = rows.map((row) => row.id)

  if (!ids.every((id) => visible.has(id))) throw notFound()

  return ids
}

function notFound() {
  return new TRPCError({ code: 'NOT_FOUND', message: 'Scope not found.' })
}

export interface ResolvedScope {
  readonly roles: readonly RoleKey[]
  readonly visibleAccountIds: readonly string[]
  readonly canViewNetwork: boolean
}

/**
 * Resolves everything scope-related for one user, in a single place.
 *
 * Soft-deleted accounts are excluded here rather than inside the pure resolver,
 * keeping deletion policy in the query layer (§4.1). An account a user would
 * otherwise see but which has been retired is simply not in the set.
 *
 * Called once per request by the tRPC context builder, so a request costs three
 * small indexed reads no matter how many procedures it touches.
 */
export async function resolveVisibleAccounts(db: AppDb, userId: string): Promise<ResolvedScope> {
  const rows = await db
    .select({
      scopeType: memberships.scopeType,
      scopeId: memberships.scopeId,
      role: memberships.role,
    })
    .from(memberships)
    .where(eq(memberships.userId, userId))

  // Closed by default (§5.2): no membership means no visibility, and there is
  // no reason to read the org tree to confirm an empty answer.
  if (rows.length === 0) {
    return { roles: [], visibleAccountIds: [], canViewNetwork: false }
  }

  const scopeMemberships: ScopeMembership[] = rows.map((row) => ({
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    role: row.role,
  }))

  const [agencyRows, accountRows] = await Promise.all([
    db.select({ id: agencies.id, networkId: agencies.networkId }).from(agencies),
    db
      .select({ id: accounts.id, agencyId: accounts.agencyId })
      .from(accounts)
      .where(isNull(accounts.deletedAt)),
  ])

  const roles = [...new Set(scopeMemberships.map((membership) => membership.role))]

  return {
    roles,
    visibleAccountIds: resolveVisibleAccountIds(scopeMemberships, {
      agencies: agencyRows,
      accounts: accountRows,
    }),
    /**
     * §5.3 restricts the network-level view to super_admin and network_admin.
     * Holding the capability is not enough — the membership must actually be at
     * network tier, so an agency_admin cannot reach a network rollup even if
     * the matrix were later loosened.
     */
    canViewNetwork: scopeMemberships.some(
      (membership) => membership.scopeType === 'network' && can(membership.role, 'view_network'),
    ),
  }
}
