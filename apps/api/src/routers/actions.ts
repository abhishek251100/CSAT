import type { AppDb } from '@zoo/db'
import { actionItems } from '@zoo/db/schema'
import {
  can,
  canTransitionAction,
  createActionInputSchema,
  updateActionInputSchema,
} from '@zoo/shared'
import { TRPCError } from '@trpc/server'
import { and, asc, eq, inArray, isNull, lt, ne } from 'drizzle-orm'
import { z } from 'zod'
import { writeAudit } from '../audit'
import type { AuthenticatedSession } from '../context'
import {
  assertAccountInScope,
  intersectWithScope,
  protectedProcedure,
  requireCapability,
  router,
} from '../trpc'

/**
 * Action items router — SPEC.md §8, §5.3.
 *
 * The §5.3 matrix splits action permissions three ways, and this router honours
 * all three:
 *  - create_action_item: manager and up may create.
 *  - update_own_action_item: a team_member may update an action they own.
 *  - close_others_action_item: only director and up may change an action owned
 *    by someone else.
 *
 * So the update rule is not a single capability: it depends on whether the
 * caller owns the action. That check lives in `assertMayUpdate` below.
 */
export const actionsRouter = router({
  create: requireCapability('create_action_item')
    .input(createActionInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertAccountInScope(ctx.session, input.accountId)

      const [created] = await ctx.db
        .insert(actionItems)
        .values({
          accountId: input.accountId,
          title: input.title,
          description: input.description ?? null,
          rcaId: input.rcaId ?? null,
          escalationId: input.escalationId ?? null,
          ownerUserId: input.ownerUserId ?? null,
          eta: input.eta ?? null,
          priority: input.priority ?? null,
          sourceType: input.rcaId ? 'rca' : input.escalationId ? 'escalation' : 'standalone',
        })
        .returning()

      if (!created) throw new Error('Failed to create the action item')

      await writeAudit(ctx.db, {
        actorUserId: ctx.session.userId,
        action: 'action.create',
        entityType: 'action_item',
        entityId: created.id,
        diff: { title: created.title, ownerUserId: created.ownerUserId },
      })

      return created
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          accountIds: z.array(z.uuid()).optional(),
          status: z.enum(['open', 'in_progress', 'blocked', 'done']).optional(),
          ownedByMe: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const scopedIds = intersectWithScope(ctx.session, input?.accountIds)
      if (scopedIds.length === 0) return []

      const filters = [inArray(actionItems.accountId, scopedIds), isNull(actionItems.deletedAt)]
      if (input?.status) filters.push(eq(actionItems.status, input.status))
      if (input?.ownedByMe) filters.push(eq(actionItems.ownerUserId, ctx.session.userId))

      return ctx.db
        .select()
        .from(actionItems)
        .where(and(...filters))
        .orderBy(asc(actionItems.eta))
    }),

  /**
   * Overdue actions in scope: `status != done AND eta < today` (§6).
   *
   * `today` is computed in UTC and compared as an ISO date string, matching the
   * pure `overdueActionCount` in @zoo/shared, so the boundary never shifts a day
   * across timezones.
   */
  overdue: protectedProcedure
    .input(z.object({ accountIds: z.array(z.uuid()).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const scopedIds = intersectWithScope(ctx.session, input?.accountIds)
      if (scopedIds.length === 0) return []

      const today = new Date().toISOString().slice(0, 10)

      return ctx.db
        .select()
        .from(actionItems)
        .where(
          and(
            inArray(actionItems.accountId, scopedIds),
            isNull(actionItems.deletedAt),
            ne(actionItems.status, 'done'),
            lt(actionItems.eta, today),
          ),
        )
        .orderBy(asc(actionItems.eta))
    }),

  update: protectedProcedure.input(updateActionInputSchema).mutation(async ({ ctx, input }) => {
    const action = await loadInScope(ctx.db, ctx.session, input.actionId)

    assertMayUpdate(ctx.session, action.ownerUserId)

    if (input.status && !canTransitionAction(action.status, input.status)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot move an action from ${action.status} to ${input.status}.`,
      })
    }

    const [updated] = await ctx.db
      .update(actionItems)
      .set({
        status: input.status ?? action.status,
        // Stamp closed_at when an action reaches done, clear it if it reopens.
        closedAt: input.status === 'done' ? new Date() : input.status ? null : action.closedAt,
        ownerUserId: input.ownerUserId === undefined ? action.ownerUserId : input.ownerUserId,
        eta: input.eta === undefined ? action.eta : input.eta,
        priority: input.priority === undefined ? action.priority : input.priority,
        title: input.title ?? action.title,
        description: input.description === undefined ? action.description : input.description,
      })
      .where(eq(actionItems.id, action.id))
      .returning()

    await writeAudit(ctx.db, {
      actorUserId: ctx.session.userId,
      action: 'action.update',
      entityType: 'action_item',
      entityId: action.id,
      diff: { status: input.status, ownerUserId: input.ownerUserId },
    })

    return updated
  }),
})

/**
 * Enforces the §5.3 split. Updating an action you own needs only
 * `update_own_action_item`; touching someone else's needs
 * `close_others_action_item`.
 */
function assertMayUpdate(session: AuthenticatedSession, ownerUserId: string | null): void {
  const isOwner = ownerUserId !== null && ownerUserId === session.userId

  const capability = isOwner ? 'update_own_action_item' : 'close_others_action_item'

  if (!session.roles.some((role) => can(role, capability))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: isOwner
        ? 'Your role cannot update action items.'
        : "Your role cannot update another owner's action item.",
    })
  }
}

async function loadInScope(db: AppDb, session: AuthenticatedSession, actionId: string) {
  const [action] = await db
    .select()
    .from(actionItems)
    .where(and(eq(actionItems.id, actionId), isNull(actionItems.deletedAt)))
    .limit(1)

  if (!action) throw new TRPCError({ code: 'NOT_FOUND', message: 'Action item not found.' })

  assertAccountInScope(session, action.accountId)

  return action
}
