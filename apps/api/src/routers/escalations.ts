import type { AppDb } from '@zoo/db'
import { escalations } from '@zoo/db/schema'
import {
  can,
  canTransitionEscalation,
  createEscalationInputSchema,
  updateEscalationStatusInputSchema,
} from '@zoo/shared'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
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
 * Escalations router — SPEC.md §8.
 *
 * Every write is capability-gated (create_escalation) and scope-checked, and
 * every mutation writes an audit entry (§12). Status changes go through the
 * shared transition rules so an escalation cannot, for example, jump from open
 * straight to closed and hide an unresolved problem.
 */
export const escalationsRouter = router({
  create: requireCapability('create_escalation')
    .input(createEscalationInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertAccountInScope(ctx.session, input.accountId)

      const [created] = await ctx.db
        .insert(escalations)
        .values({
          accountId: input.accountId,
          raisedByUserId: ctx.session.userId,
          source: input.source,
          severity: input.severity,
          title: input.title,
          description: input.description ?? null,
          reportedAt: input.reportedAt,
        })
        .returning()

      if (!created) throw new Error('Failed to create the escalation')

      await writeAudit(ctx.db, {
        actorUserId: ctx.session.userId,
        action: 'escalation.create',
        entityType: 'escalation',
        entityId: created.id,
        diff: { title: created.title, severity: created.severity, status: created.status },
      })

      return created
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          accountIds: z.array(z.uuid()).optional(),
          status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const scopedIds = intersectWithScope(ctx.session, input?.accountIds)
      if (scopedIds.length === 0) return []

      const filters = [inArray(escalations.accountId, scopedIds), isNull(escalations.deletedAt)]
      if (input?.status) filters.push(eq(escalations.status, input.status))

      return ctx.db
        .select()
        .from(escalations)
        .where(and(...filters))
        .orderBy(desc(escalations.reportedAt))
    }),

  /**
   * Ops table for A tracker: number, account, submitter, RCA status, category.
   */
  listDetailed: protectedProcedure
    .input(z.object({ accountIds: z.array(z.uuid()).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { accounts, agencies, rcas, users } = await import('@zoo/db/schema')
      const scopedIds = intersectWithScope(ctx.session, input?.accountIds)
      if (scopedIds.length === 0) return []

      const rows = await ctx.db
        .select({
          id: escalations.id,
          accountId: escalations.accountId,
          accountName: accounts.name,
          agencyName: agencies.name,
          title: escalations.title,
          description: escalations.description,
          severity: escalations.severity,
          status: escalations.status,
          source: escalations.source,
          reportedAt: escalations.reportedAt,
          raisedByUserId: escalations.raisedByUserId,
          raisedByEmail: users.email,
          raisedByName: users.name,
        })
        .from(escalations)
        .innerJoin(accounts, eq(escalations.accountId, accounts.id))
        .innerJoin(agencies, eq(accounts.agencyId, agencies.id))
        .leftJoin(users, eq(escalations.raisedByUserId, users.id))
        .where(and(inArray(escalations.accountId, scopedIds), isNull(escalations.deletedAt)))
        .orderBy(desc(escalations.reportedAt))

      const escalationIds = rows.map((row) => row.id)
      const linked =
        escalationIds.length === 0
          ? []
          : await ctx.db
              .select({
                id: rcas.id,
                escalationId: rcas.escalationId,
                status: rcas.status,
                errorCategory: rcas.errorCategory,
              })
              .from(rcas)
              .where(and(inArray(rcas.escalationId, escalationIds), isNull(rcas.deletedAt)))

      const rcaByEscalation = new Map(
        linked.filter((row) => row.escalationId).map((row) => [row.escalationId!, row]),
      )

      return rows.map((row, index) => {
        const rca = rcaByEscalation.get(row.id)
        return {
          ...row,
          number: `ESC-${String(rows.length - index).padStart(4, '0')}`,
          submittedBy: row.raisedByName || row.raisedByEmail || 'Unknown',
          rcaStatus: rca?.status ?? ('pending' as const),
          errorCategory: rca?.errorCategory ?? null,
          rcaId: rca?.id ?? null,
        }
      })
    }),

  get: protectedProcedure
    .input(z.object({ escalationId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const escalation = await loadInScope(ctx.db, ctx.session, input.escalationId)

      return escalation
    }),

  /**
   * Moves an escalation through its lifecycle (§4.2). Sets resolved_at when the
   * escalation reaches resolved and clears it if it reopens, so the timestamp
   * always reflects the current state.
   *
   * Capability depends on the target (§5.3, by decision): reaching `resolved`
   * or `closed` needs `resolve_escalation` (director and up), while picking one
   * up (`in_progress`) or reopening (`open`) needs only `create_escalation`. So
   * a manager can work an escalation but not declare it done.
   */
  updateStatus: protectedProcedure
    .input(updateEscalationStatusInputSchema)
    .mutation(async ({ ctx, input }) => {
      const escalation = await loadInScope(ctx.db, ctx.session, input.escalationId)

      const isClosing = input.status === 'resolved' || input.status === 'closed'
      const required = isClosing ? 'resolve_escalation' : 'create_escalation'

      if (!ctx.session.roles.some((role) => can(role, required))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: isClosing
            ? 'Your role cannot resolve or close escalations.'
            : 'Your role cannot update escalations.',
        })
      }

      if (!canTransitionEscalation(escalation.status, input.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot move an escalation from ${escalation.status} to ${input.status}.`,
        })
      }

      const [updated] = await ctx.db
        .update(escalations)
        .set({
          status: input.status,
          resolvedAt: input.status === 'resolved' ? new Date() : null,
        })
        .where(eq(escalations.id, input.escalationId))
        .returning()

      await writeAudit(ctx.db, {
        actorUserId: ctx.session.userId,
        action: 'escalation.status',
        entityType: 'escalation',
        entityId: input.escalationId,
        diff: { from: escalation.status, to: input.status },
      })

      return updated
    }),
})

/**
 * Loads an escalation and confirms it is in scope, throwing NOT_FOUND otherwise
 * — the same not-found-not-forbidden discipline as elsewhere (§5.2), so an
 * out-of-scope id never confirms the escalation exists.
 */
async function loadInScope(db: AppDb, session: AuthenticatedSession, escalationId: string) {
  const [escalation] = await db
    .select()
    .from(escalations)
    .where(and(eq(escalations.id, escalationId), isNull(escalations.deletedAt)))
    .limit(1)

  if (!escalation) throw new TRPCError({ code: 'NOT_FOUND', message: 'Escalation not found.' })

  assertAccountInScope(session, escalation.accountId)

  return escalation
}
