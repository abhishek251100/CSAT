import type { AppDb } from '@zoo/db'
import { responseAnswers, surveyResponses, surveys } from '@zoo/db/schema'
import { manualResponseInputSchema, periodFor, type MetricType } from '@zoo/shared'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { recomputeForResponse } from '../rollups/recompute'
import {
  assertAccountInScope,
  intersectWithScope,
  protectedProcedure,
  requireCapability,
  router,
} from '../trpc'

/**
 * Responses router — SPEC.md §8.
 *
 * Milestone 4 covers manual entry and scoped reads, which is what gets real
 * numbers flowing before Google sync (§14.4). The Google path (§7.1) and the
 * tokenised native submission (§7.2) arrive in Milestones 8 and 9 and write to
 * these same tables.
 */
export const responsesRouter = router({
  /**
   * Records a response entered by hand.
   *
   * Two independent checks, as everywhere else: `enter_response` says the role
   * may do this at all, `assertAccountInScope` says it may do it *here*. Both
   * are derived server-side; the account id in the input is a target, never an
   * authorisation claim (§12).
   */
  createManual: requireCapability('enter_response')
    .input(manualResponseInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertAccountInScope(ctx.session, input.accountId)

      const survey = await ensureManualSurvey(ctx.db, input.accountId, input.type)

      /**
       * The period this response belongs to, using the account's cadence
       * (§4.3: `csat_cadence` monthly, `nps_cadence` quarterly).
       */
      const period = periodFor(input.type === 'csat' ? 'monthly' : 'quarterly', input.submittedAt)

      const [created] = await ctx.db
        .insert(surveyResponses)
        .values({
          surveyId: survey.id,
          accountId: input.accountId,
          type: input.type,
          score: input.score,
          respondentName: input.respondentName ?? null,
          respondentEmail: input.respondentEmail ?? null,
          /**
           * 'import' rather than 'native': §7.2 reserves 'native' for
           * submissions through our own survey UI. This is a staff member
           * transcribing feedback received elsewhere.
           */
          source: 'import',
          /**
           * Left null deliberately. The unique key is (source,
           * external_response_id), and Postgres treats nulls as distinct — so
           * manual entries never collide with each other or throttle the
           * Google idempotency key (§4.1).
           */
          externalResponseId: null,
          periodStart: period.start,
          periodEnd: period.end,
          submittedAt: input.submittedAt,
        })
        .returning()

      if (!created) throw new Error('Failed to record the response')

      if (input.comment) {
        await ctx.db.insert(responseAnswers).values({
          responseId: created.id,
          questionLabel: 'Comment',
          answerText: input.comment,
        })
      }

      /**
       * Recompute on write (§4.3), for the periods containing this response's
       * submitted_at rather than today's — manual entry is routinely backdated.
       *
       * Awaited rather than fired and forgotten so the caller cannot read a
       * stale dashboard immediately after a write. It is a handful of indexed
       * queries; if it ever becomes slow enough to matter, it moves to a queue
       * rather than becoming a race.
       */
      const rollups = await recomputeForResponse(ctx.db, input.accountId, input.submittedAt)

      return { response: created, rollups }
    }),

  /** Responses for accounts the caller can see, newest first. */
  list: protectedProcedure
    .input(
      z
        .object({
          accountIds: z.array(z.uuid()).optional(),
          type: z.enum(['csat', 'nps']).optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const scopedIds = intersectWithScope(ctx.session, input?.accountIds)

      if (scopedIds.length === 0) return []

      const filters = [
        inArray(surveyResponses.accountId, scopedIds),
        isNull(surveyResponses.deletedAt),
      ]

      if (input?.type) filters.push(eq(surveyResponses.type, input.type))

      return ctx.db
        .select({
          id: surveyResponses.id,
          accountId: surveyResponses.accountId,
          type: surveyResponses.type,
          score: surveyResponses.score,
          source: surveyResponses.source,
          respondentName: surveyResponses.respondentName,
          submittedAt: surveyResponses.submittedAt,
        })
        .from(surveyResponses)
        .where(and(...filters))
        .orderBy(desc(surveyResponses.submittedAt))
        .limit(input?.limit ?? 50)
    }),
})

/**
 * Finds or creates the per-account instrument that manual entries hang off.
 *
 * `survey_responses.survey_id` is NOT NULL (§4.3), so every response needs a
 * survey even when nobody filled one in. Rather than making the caller pick
 * one, manual entry gets a single implicit instrument per account and metric
 * type, which keeps `surveys` an honest registry of where responses came from.
 *
 * The read-then-insert has a benign race: two simultaneous first entries for
 * one account could create two manual surveys. Both would work identically, so
 * this is not worth a constraint that would over-restrict the Google path,
 * where one account legitimately has several source surveys.
 */
async function ensureManualSurvey(db: AppDb, accountId: string, type: MetricType) {
  const [existing] = await db
    .select({ id: surveys.id })
    .from(surveys)
    .where(
      and(eq(surveys.accountId, accountId), eq(surveys.type, type), eq(surveys.source, 'import')),
    )
    .limit(1)

  if (existing) return existing

  const [created] = await db
    .insert(surveys)
    .values({
      accountId,
      type,
      title: type === 'csat' ? 'Manual CSAT entry' : 'Manual NPS entry',
      source: 'import',
      cadence: type === 'csat' ? 'monthly' : 'quarterly',
    })
    .returning({ id: surveys.id })

  if (!created) throw new Error('Failed to create the manual-entry survey')

  return created
}
