import { agencies, memberships, networks, users } from '@zoo/db/schema'
import { ROLE_KEYS, SCOPE_TYPES, canAny } from '@zoo/shared'
import { TRPCError } from '@trpc/server'
import { and, asc, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { writeAudit } from '../audit'
import { protectedProcedure, requireCapability, router } from '../trpc'

/**
 * User / membership admin — SPEC.md §8 users router (delivery overhaul).
 */
export const usersRouter = router({
  meCapabilities: protectedProcedure.query(({ ctx }) => ({
    manageUsers: canAny(ctx.session.roles, 'manage_users'),
    enterResponse: canAny(ctx.session.roles, 'enter_response'),
    createEscalation: canAny(ctx.session.roles, 'create_escalation'),
    authorRca: canAny(ctx.session.roles, 'author_rca'),
    createActionItem: canAny(ctx.session.roles, 'create_action_item'),
  })),

  list: requireCapability('manage_users').query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        isActive: users.isActive,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .orderBy(asc(users.email))

    const allMemberships = await ctx.db
      .select({
        id: memberships.id,
        userId: memberships.userId,
        scopeType: memberships.scopeType,
        scopeId: memberships.scopeId,
        role: memberships.role,
      })
      .from(memberships)

    const networkRows = await ctx.db.select({ id: networks.id, name: networks.name }).from(networks)
    const agencyRows = await ctx.db.select({ id: agencies.id, name: agencies.name }).from(agencies)
    const networkName = new Map(networkRows.map((row) => [row.id, row.name]))
    const agencyName = new Map(agencyRows.map((row) => [row.id, row.name]))

    return rows.map((user) => ({
      ...user,
      memberships: allMemberships
        .filter((membership) => membership.userId === user.id)
        .map((membership) => ({
          ...membership,
          scopeLabel:
            membership.scopeType === 'network'
              ? (networkName.get(membership.scopeId) ?? membership.scopeId)
              : membership.scopeType === 'agency'
                ? (agencyName.get(membership.scopeId) ?? membership.scopeId)
                : membership.scopeId,
        })),
    }))
  }),

  grantMembership: requireCapability('manage_users')
    .input(
      z.object({
        userId: z.uuid(),
        scopeType: z.enum(SCOPE_TYPES),
        scopeId: z.uuid(),
        role: z.enum(ROLE_KEYS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, input.userId),
            eq(memberships.scopeType, input.scopeType),
            eq(memberships.scopeId, input.scopeId),
          ),
        )
        .limit(1)

      if (existing) {
        await ctx.db
          .update(memberships)
          .set({ role: input.role })
          .where(eq(memberships.id, existing.id))

        await writeAudit(ctx.db, {
          actorUserId: ctx.session.userId,
          action: 'membership.update',
          entityType: 'membership',
          entityId: existing.id,
          diff: { role: input.role, from: existing.role },
        })

        return { id: existing.id, created: false }
      }

      const id = uuidv7()
      await ctx.db.insert(memberships).values({
        id,
        userId: input.userId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        role: input.role,
      })

      await writeAudit(ctx.db, {
        actorUserId: ctx.session.userId,
        action: 'membership.create',
        entityType: 'membership',
        entityId: id,
        diff: input,
      })

      return { id, created: true }
    }),

  revokeMembership: requireCapability('manage_users')
    .input(z.object({ membershipId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(memberships)
        .where(eq(memberships.id, input.membershipId))
        .limit(1)

      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Membership not found.' })
      }

      await ctx.db.delete(memberships).where(eq(memberships.id, input.membershipId))

      await writeAudit(ctx.db, {
        actorUserId: ctx.session.userId,
        action: 'membership.delete',
        entityType: 'membership',
        entityId: input.membershipId,
        diff: { userId: row.userId, scopeType: row.scopeType, scopeId: row.scopeId },
      })

      return { ok: true }
    }),

  /** Networks and agencies the admin can target when granting memberships. */
  grantTargets: requireCapability('manage_users').query(async ({ ctx }) => {
    const networkRows = await ctx.db
      .select({ id: networks.id, name: networks.name })
      .from(networks)
      .orderBy(asc(networks.name))
    const agencyRows = await ctx.db
      .select({ id: agencies.id, name: agencies.name, networkId: agencies.networkId })
      .from(agencies)
      .orderBy(asc(agencies.name))

    // Network admins see everything in their visible networks; super_admin sees all.
    const canSeeAll = canAny(ctx.session.roles, 'platform_config')
    if (canSeeAll) {
      return { networks: networkRows, agencies: agencyRows }
    }

    return {
      networks: networkRows.filter(() => ctx.session.canViewNetwork),
      agencies: agencyRows,
    }
  }),
})
