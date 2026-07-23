import { z } from 'zod'
import { METRIC_TYPES, SCORE_BOUNDS } from './enums'

/**
 * Manual response entry — SPEC.md §8 (`responses: ... manual entry`).
 *
 * Defined once here and consumed by the tRPC procedure's `.input()` and, later,
 * by the react-hook-form resolver (§2: "Zod as the single validation layer,
 * shared between tRPC input schemas and forms"). The score bounds come from
 * SCORE_BOUNDS, the same constants the Postgres CHECK mirrors, so a score is
 * validated identically in the browser, at the API boundary, and in the
 * database.
 */
export const manualResponseInputSchema = z
  .object({
    accountId: z.uuid(),
    type: z.enum(METRIC_TYPES),
    /** 1-5 for CSAT, 0-10 for NPS. Refined against the type below. */
    score: z.number().int(),
    respondentName: z.string().trim().min(1).max(200).optional(),
    respondentEmail: z.email().max(320).optional(),
    /**
     * When the client actually gave this feedback, not when it was typed in.
     * Backdating is the normal case for manual entry — someone recording last
     * month's paper survey — and it decides which period the response rolls
     * into, so it is required rather than defaulted to now.
     */
    submittedAt: z.date(),
    /** Optional open-text, stored on `response_answers` (§4.3). */
    comment: z.string().trim().max(5000).optional(),
  })
  .superRefine((input, ctx) => {
    /**
     * The score bound depends on the metric type, so it cannot live on the
     * field itself. Same rule as the Postgres CHECK on `survey_responses`,
     * driven by the same SCORE_BOUNDS constants.
     */
    const bounds = SCORE_BOUNDS[input.type]

    if (input.score < bounds.min || input.score > bounds.max) {
      ctx.addIssue({
        code: 'custom',
        path: ['score'],
        message: `${input.type === 'csat' ? 'CSAT' : 'NPS'} score must be between ${bounds.min} and ${bounds.max}`,
      })
    }

    /**
     * A minute of slack absorbs clock skew between browser and server. Beyond
     * that a future date is a typo, and it would roll the response into a
     * period that has not happened yet.
     */
    if (input.submittedAt.getTime() > Date.now() + 60_000) {
      ctx.addIssue({
        code: 'custom',
        path: ['submittedAt'],
        message: 'submittedAt cannot be in the future',
      })
    }
  })

export type ManualResponseInput = z.infer<typeof manualResponseInputSchema>
