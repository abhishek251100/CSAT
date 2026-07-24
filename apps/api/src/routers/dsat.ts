import {
  accounts,
  agencies,
  rcas,
  responseAnswers,
  surveyResponses,
} from '@zoo/db/schema'
import { VIEW_SCOPE_TYPES, isDsatScore } from '@zoo/shared'
import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import { z } from 'zod'
import { resolveScopeAccounts } from '../auth/scope'
import { protectedProcedure, router } from '../trpc'

const scopeInput = z.object({
  scopeType: z.enum(VIEW_SCOPE_TYPES),
  scopeId: z.string().min(1),
  grain: z.enum(['monthly', 'quarterly', 'custom']),
  from: z.iso.date(),
  to: z.iso.date(),
})

/**
 * DSAT-focused reads for the DSAT tab — list + detail with drivers, feedback,
 * and RCA status.
 */
export const dsatRouter = router({
  list: protectedProcedure.input(scopeInput).query(async ({ ctx, input }) => {
    const accountIds = await resolveScopeAccounts(
      ctx.db,
      ctx.session,
      input.scopeType,
      input.scopeId,
    )
    if (accountIds.length === 0) return []

    const startAt = new Date(`${input.from}T00:00:00.000Z`)
    const toParts = input.to.split('-').map(Number) as [number, number, number]
    const endAtExclusive = new Date(Date.UTC(toParts[0], toParts[1] - 1, toParts[2] + 1))

    const rows = await ctx.db
      .select({
        id: surveyResponses.id,
        accountId: surveyResponses.accountId,
        accountName: accounts.name,
        agencyId: agencies.id,
        agencyName: agencies.name,
        score: surveyResponses.score,
        source: surveyResponses.source,
        respondentName: surveyResponses.respondentName,
        respondentEmail: surveyResponses.respondentEmail,
        submittedAt: surveyResponses.submittedAt,
        isDemo: surveyResponses.isDemo,
      })
      .from(surveyResponses)
      .innerJoin(accounts, eq(surveyResponses.accountId, accounts.id))
      .innerJoin(agencies, eq(accounts.agencyId, agencies.id))
      .where(
        and(
          inArray(surveyResponses.accountId, accountIds),
          eq(surveyResponses.type, 'csat'),
          isNull(surveyResponses.deletedAt),
          gte(surveyResponses.submittedAt, startAt),
          lt(surveyResponses.submittedAt, endAtExclusive),
        ),
      )
      .orderBy(desc(surveyResponses.submittedAt))

    const dsats = rows.filter((row) => isDsatScore('csat', row.score))
    if (dsats.length === 0) return []

    const dsatIds = dsats.map((row) => row.id)
    const linkedRcas = await ctx.db
      .select({
        id: rcas.id,
        responseId: rcas.responseId,
        status: rcas.status,
        errorCategory: rcas.errorCategory,
      })
      .from(rcas)
      .where(and(inArray(rcas.responseId, dsatIds), isNull(rcas.deletedAt)))

    const rcaByResponse = new Map(
      linkedRcas.filter((row) => row.responseId).map((row) => [row.responseId!, row]),
    )

    const feedbackRows = await ctx.db
      .select({
        responseId: responseAnswers.responseId,
        answerText: responseAnswers.answerText,
      })
      .from(responseAnswers)
      .where(inArray(responseAnswers.responseId, dsatIds))

    const feedbackByResponse = new Map<string, string>()
    for (const row of feedbackRows) {
      if (row.answerText && !feedbackByResponse.has(row.responseId)) {
        feedbackByResponse.set(row.responseId, row.answerText)
      }
    }

    return dsats.map((row) => {
      const rca = rcaByResponse.get(row.id)
      return {
        id: row.id,
        accountId: row.accountId,
        accountName: row.accountName,
        agencyId: row.agencyId,
        agencyName: row.agencyName,
        score: row.score,
        source: row.source,
        submittedAt: row.submittedAt,
        isDemo: row.isDemo,
        submittedBy:
          row.respondentName ||
          row.respondentEmail ||
          (row.isDemo ? 'Demo seed' : row.source === 'import' ? 'Staff import' : 'Survey'),
        feedback: feedbackByResponse.get(row.id) ?? null,
        rcaStatus: rca?.status ?? ('pending' as const),
        errorCategory: rca?.errorCategory ?? null,
        rcaId: rca?.id ?? null,
      }
    })
  }),

  get: protectedProcedure
    .input(z.object({ responseId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          id: surveyResponses.id,
          accountId: surveyResponses.accountId,
          accountName: accounts.name,
          agencyName: agencies.name,
          score: surveyResponses.score,
          source: surveyResponses.source,
          respondentName: surveyResponses.respondentName,
          respondentEmail: surveyResponses.respondentEmail,
          submittedAt: surveyResponses.submittedAt,
          isDemo: surveyResponses.isDemo,
        })
        .from(surveyResponses)
        .innerJoin(accounts, eq(surveyResponses.accountId, accounts.id))
        .innerJoin(agencies, eq(accounts.agencyId, agencies.id))
        .where(and(eq(surveyResponses.id, input.responseId), isNull(surveyResponses.deletedAt)))
        .limit(1)

      if (!row || !ctx.session.visibleAccountIds.includes(row.accountId)) {
        return null
      }

      const answers = await ctx.db
        .select({
          questionLabel: responseAnswers.questionLabel,
          answerValue: responseAnswers.answerValue,
          answerText: responseAnswers.answerText,
        })
        .from(responseAnswers)
        .where(eq(responseAnswers.responseId, row.id))

      const [rca] = await ctx.db
        .select()
        .from(rcas)
        .where(and(eq(rcas.responseId, row.id), isNull(rcas.deletedAt)))
        .limit(1)

      return { ...row, answers, rca: rca ?? null }
    }),
})
