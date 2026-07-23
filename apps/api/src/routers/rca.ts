import type { AppDb } from '@zoo/db'
import {
  accounts,
  actionItems,
  escalations,
  rcaCauses,
  rcas,
  rcaWhys,
  surveyResponses,
} from '@zoo/db/schema'
import {
  createRcaInputSchema,
  isDsatScore,
  rcaCausesInputSchema,
  rcaWhysInputSchema,
  setErrorCategoryInputSchema,
} from '@zoo/shared'
import { TRPCError } from '@trpc/server'
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
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
 * RCA router — SPEC.md §8, and the enforcement of the §8 rule that "RCA is
 * required for all escalations and CSAT 1,2,3".
 *
 * That rule is enforced by *derivation*, not a mutable flag: `pending` returns
 * every escalation and every DSAT response in scope that has no linked RCA.
 * Authoring the RCA is the only thing that clears it, so the requirement cannot
 * be dismissed or skipped — there is nothing to dismiss.
 */
export const rcaRouter = router({
  /**
   * Creates an RCA from an escalation or a DSAT response.
   *
   * The shared schema already enforces the one-of subject (§4.3); this
   * additionally verifies the referenced subject exists, is in scope, and — for
   * a DSAT subject — is genuinely a DSAT. Without that last check the rule could
   * be sidestepped by attaching an RCA to a satisfied response.
   */
  create: requireCapability('author_rca')
    .input(createRcaInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertAccountInScope(ctx.session, input.accountId)

      if (input.subjectType === 'escalation') {
        const [escalation] = await ctx.db
          .select()
          .from(escalations)
          .where(and(eq(escalations.id, input.escalationId!), isNull(escalations.deletedAt)))
          .limit(1)

        if (!escalation || escalation.accountId !== input.accountId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Escalation not found.' })
        }
      } else {
        const [response] = await ctx.db
          .select()
          .from(surveyResponses)
          .where(and(eq(surveyResponses.id, input.responseId!), isNull(surveyResponses.deletedAt)))
          .limit(1)

        if (!response || response.accountId !== input.accountId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Response not found.' })
        }

        if (!isDsatScore(response.type, response.score)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'An RCA can only be attached to a DSAT response (CSAT score 1-3).',
          })
        }
      }

      const [created] = await ctx.db
        .insert(rcas)
        .values({
          accountId: input.accountId,
          subjectType: input.subjectType,
          escalationId: input.escalationId ?? null,
          responseId: input.responseId ?? null,
          method: input.method,
          problemStatement: input.problemStatement,
          createdByUserId: ctx.session.userId,
        })
        .returning()

      if (!created) throw new Error('Failed to create the RCA')

      await writeAudit(ctx.db, {
        actorUserId: ctx.session.userId,
        action: 'rca.create',
        entityType: 'rca',
        entityId: created.id,
        diff: { subjectType: created.subjectType, method: created.method },
      })

      return created
    }),

  /** An RCA with its whys and causes, if in scope. */
  get: protectedProcedure.input(z.object({ rcaId: z.uuid() })).query(async ({ ctx, input }) => {
    const rca = await loadRcaInScope(ctx.db, ctx.session, input.rcaId)

    const [whys, causes] = await Promise.all([
      ctx.db.select().from(rcaWhys).where(eq(rcaWhys.rcaId, rca.id)).orderBy(rcaWhys.level),
      ctx.db.select().from(rcaCauses).where(eq(rcaCauses.rcaId, rca.id)),
    ])

    return { ...rca, whys, causes }
  }),

  list: protectedProcedure
    .input(z.object({ accountIds: z.array(z.uuid()).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const scopedIds = intersectWithScope(ctx.session, input?.accountIds)
      if (scopedIds.length === 0) return []

      return ctx.db
        .select()
        .from(rcas)
        .where(and(inArray(rcas.accountId, scopedIds), isNull(rcas.deletedAt)))
        .orderBy(desc(rcas.createdAt))
    }),

  /**
   * The RCA tracker for §9 View 2: subject, account, method, error category,
   * status and the count of linked action items — everything the table shows,
   * in one scoped query.
   *
   * The action count comes from a grouped subquery joined in, so the table does
   * not need a per-row round trip. Uses a left join so an RCA with no actions
   * still appears (with a count of 0).
   */
  tracker: protectedProcedure
    .input(z.object({ accountIds: z.array(z.uuid()).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const scopedIds = intersectWithScope(ctx.session, input?.accountIds)
      if (scopedIds.length === 0) return []

      const actionCounts = ctx.db
        .select({
          rcaId: actionItems.rcaId,
          linkedActions: count(actionItems.id).as('linked_actions'),
        })
        .from(actionItems)
        .where(isNull(actionItems.deletedAt))
        .groupBy(actionItems.rcaId)
        .as('action_counts')

      return ctx.db
        .select({
          id: rcas.id,
          accountId: rcas.accountId,
          accountName: accounts.name,
          subjectType: rcas.subjectType,
          method: rcas.method,
          errorCategory: rcas.errorCategory,
          status: rcas.status,
          createdAt: rcas.createdAt,
          linkedActions: sql<number>`coalesce(${actionCounts.linkedActions}, 0)`,
        })
        .from(rcas)
        .innerJoin(accounts, eq(rcas.accountId, accounts.id))
        .leftJoin(actionCounts, eq(actionCounts.rcaId, rcas.id))
        .where(and(inArray(rcas.accountId, scopedIds), isNull(rcas.deletedAt)))
        .orderBy(desc(rcas.createdAt))
    }),

  /**
   * Replaces the 5 Whys chain (§4.3 rca_whys). A full replace rather than an
   * append, because editing the chain mid-analysis is the normal case and
   * diffing individual whys would be needless ceremony.
   */
  setWhys: requireCapability('author_rca')
    .input(rcaWhysInputSchema)
    .mutation(async ({ ctx, input }) => {
      const rca = await loadRcaInScope(ctx.db, ctx.session, input.rcaId)

      await ctx.db.delete(rcaWhys).where(eq(rcaWhys.rcaId, rca.id))
      if (input.whys.length > 0) {
        await ctx.db.insert(rcaWhys).values(
          input.whys.map((why) => ({
            rcaId: rca.id,
            level: why.level,
            question: why.question,
            answer: why.answer ?? null,
          })),
        )
      }

      await writeAudit(ctx.db, {
        actorUserId: ctx.session.userId,
        action: 'rca.setWhys',
        entityType: 'rca',
        entityId: rca.id,
        diff: { count: input.whys.length },
      })

      return { rcaId: rca.id, count: input.whys.length }
    }),

  /** Replaces the fishbone causes (§4.3 rca_causes). */
  setCauses: requireCapability('author_rca')
    .input(rcaCausesInputSchema)
    .mutation(async ({ ctx, input }) => {
      const rca = await loadRcaInScope(ctx.db, ctx.session, input.rcaId)

      await ctx.db.delete(rcaCauses).where(eq(rcaCauses.rcaId, rca.id))
      if (input.causes.length > 0) {
        await ctx.db.insert(rcaCauses).values(
          input.causes.map((cause) => ({
            rcaId: rca.id,
            bucket: cause.bucket,
            cause: cause.cause,
          })),
        )
      }

      await writeAudit(ctx.db, {
        actorUserId: ctx.session.userId,
        action: 'rca.setCauses',
        entityType: 'rca',
        entityId: rca.id,
        diff: { count: input.causes.length },
      })

      return { rcaId: rca.id, count: input.causes.length }
    }),

  /**
   * Sets the people / process / product category (§4.3, §6).
   *
   * A human decision by design: §11 forbids AI setting the final category
   * unaided, so this is the confirmation step after any AI suggestion.
   */
  setErrorCategory: requireCapability('author_rca')
    .input(setErrorCategoryInputSchema)
    .mutation(async ({ ctx, input }) => {
      const rca = await loadRcaInScope(ctx.db, ctx.session, input.rcaId)

      const [updated] = await ctx.db
        .update(rcas)
        .set({ errorCategory: input.errorCategory })
        .where(eq(rcas.id, rca.id))
        .returning()

      await writeAudit(ctx.db, {
        actorUserId: ctx.session.userId,
        action: 'rca.setErrorCategory',
        entityType: 'rca',
        entityId: rca.id,
        diff: { from: rca.errorCategory, to: input.errorCategory },
      })

      return updated
    }),

  /**
   * The DSAT-triggers-RCA surface (§8) — every escalation and DSAT response in
   * scope that still needs an RCA.
   *
   * Derived on every call from live data, so it cannot drift or be dismissed:
   * the moment a DSAT response is recorded it appears here, and it disappears
   * only when an RCA is linked. This is what "the requirement cannot be skipped"
   * means concretely.
   */
  pending: protectedProcedure
    .input(z.object({ accountIds: z.array(z.uuid()).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const scopedIds = intersectWithScope(ctx.session, input?.accountIds)
      if (scopedIds.length === 0) {
        return { escalations: [], dsatResponses: [], total: 0 }
      }

      // Ids already covered by an RCA, so they are excluded from the pending set.
      const covered = await ctx.db
        .select({ escalationId: rcas.escalationId, responseId: rcas.responseId })
        .from(rcas)
        .where(and(inArray(rcas.accountId, scopedIds), isNull(rcas.deletedAt)))

      const coveredEscalations = new Set(
        covered.map((row) => row.escalationId).filter((id): id is string => id !== null),
      )
      const coveredResponses = new Set(
        covered.map((row) => row.responseId).filter((id): id is string => id !== null),
      )

      const openEscalations = await ctx.db
        .select({
          id: escalations.id,
          accountId: escalations.accountId,
          title: escalations.title,
          severity: escalations.severity,
          reportedAt: escalations.reportedAt,
        })
        .from(escalations)
        .where(and(inArray(escalations.accountId, scopedIds), isNull(escalations.deletedAt)))

      const dsatResponses = await ctx.db
        .select({
          id: surveyResponses.id,
          accountId: surveyResponses.accountId,
          score: surveyResponses.score,
          submittedAt: surveyResponses.submittedAt,
        })
        .from(surveyResponses)
        .where(
          and(
            inArray(surveyResponses.accountId, scopedIds),
            isNull(surveyResponses.deletedAt),
            eq(surveyResponses.type, 'csat'),
            // score <= 3 filtered in code below via isDsatScore for one definition.
            isNotNull(surveyResponses.score),
          ),
        )

      const pendingEscalations = openEscalations.filter((row) => !coveredEscalations.has(row.id))
      const pendingResponses = dsatResponses
        .filter((row) => isDsatScore('csat', row.score))
        .filter((row) => !coveredResponses.has(row.id))

      return {
        escalations: pendingEscalations,
        dsatResponses: pendingResponses,
        total: pendingEscalations.length + pendingResponses.length,
      }
    }),
})

async function loadRcaInScope(db: AppDb, session: AuthenticatedSession, rcaId: string) {
  const [rca] = await db
    .select()
    .from(rcas)
    .where(and(eq(rcas.id, rcaId), isNull(rcas.deletedAt)))
    .limit(1)

  if (!rca) throw new TRPCError({ code: 'NOT_FOUND', message: 'RCA not found.' })

  assertAccountInScope(session, rca.accountId)

  return rca
}
