import { z } from 'zod'
import {
  actionPrioritySchema,
  actionStatusSchema,
  CSAT_SATISFIED_MIN,
  errorCategorySchema,
  escalationSourceSchema,
  escalationStatusSchema,
  rcaMethodSchema,
  severitySchema,
  type ActionStatus,
  type EscalationStatus,
  type MetricType,
} from './enums'

/**
 * Escalation, RCA and action-item logic — SPEC.md §4.3, §8.
 *
 * The status-transition rules and input schemas live here so the tRPC
 * procedures and, later, the forms validate against one definition — the same
 * arrangement as the metric functions (§3). Anything a Postgres CHECK also
 * enforces (the RCA one-of subject, score ranges) is mirrored here so the API
 * rejects bad input with a readable message before the database does.
 */

// ------------------------------------------------------- DSAT-triggers-RCA

/**
 * Is this response a DSAT — a CSAT score of 1, 2 or 3 (§1)?
 *
 * The single trigger for the §8 rule that every DSAT needs an RCA. A low NPS
 * score is a detractor, not a DSAT, so it is deliberately never true here.
 */
export function isDsatScore(type: MetricType, score: number): boolean {
  return type === 'csat' && score >= 1 && score < CSAT_SATISFIED_MIN
}

/**
 * Does this subject still require an RCA?
 *
 * §8: "RCA required for all escalations and CSAT 1,2,3." The requirement is
 * *derived* from data, never a mutable flag — an escalation or DSAT response
 * with no linked RCA requires one, and authoring the RCA is the only thing that
 * clears it. That is what makes the requirement impossible to skip: there is
 * nothing to dismiss.
 */
export type RcaSubjectState =
  | { kind: 'escalation'; hasRca: boolean }
  | { kind: 'dsat_response'; type: MetricType; score: number; hasRca: boolean }

export function requiresRca(subject: RcaSubjectState): boolean {
  if (subject.hasRca) return false

  if (subject.kind === 'escalation') return true

  return isDsatScore(subject.type, subject.score)
}

// --------------------------------------------------------- status transitions

/**
 * Allowed escalation status moves (§4.2 escalation_status).
 *
 * Forward through the lifecycle, with two deliberate affordances: a resolved
 * escalation can reopen to in_progress if the fix did not hold, and closed is
 * terminal. Skipping open -> closed is refused so an unresolved escalation
 * cannot be quietly closed.
 */
const ESCALATION_TRANSITIONS: Record<EscalationStatus, ReadonlySet<EscalationStatus>> = {
  open: new Set(['in_progress', 'resolved']),
  in_progress: new Set(['open', 'resolved']),
  resolved: new Set(['in_progress', 'closed']),
  closed: new Set([]),
}

export function canTransitionEscalation(from: EscalationStatus, to: EscalationStatus): boolean {
  if (from === to) return true

  return ESCALATION_TRANSITIONS[from].has(to)
}

/**
 * Allowed action status moves (§4.2 action_status).
 *
 * The three working states (open, in_progress, blocked) move freely between
 * each other; done can reopen because a corrective action sometimes proves
 * insufficient. An action cannot jump straight from done to blocked.
 */
const ACTION_TRANSITIONS: Record<ActionStatus, ReadonlySet<ActionStatus>> = {
  open: new Set(['in_progress', 'blocked', 'done']),
  in_progress: new Set(['open', 'blocked', 'done']),
  blocked: new Set(['open', 'in_progress', 'done']),
  done: new Set(['open', 'in_progress']),
}

export function canTransitionAction(from: ActionStatus, to: ActionStatus): boolean {
  if (from === to) return true

  return ACTION_TRANSITIONS[from].has(to)
}

// --------------------------------------------------------------- input schemas

const uuid = z.uuid()

/** Rejects a timestamp in the future, with a minute of slack for clock skew. */
const notFuture = z
  .date()
  .refine((value) => value.getTime() <= Date.now() + 60_000, 'cannot be in the future')

export const createEscalationInputSchema = z.object({
  accountId: uuid,
  source: escalationSourceSchema,
  severity: severitySchema,
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).optional(),
  reportedAt: notFuture,
})

export type CreateEscalationInput = z.infer<typeof createEscalationInputSchema>

export const updateEscalationStatusInputSchema = z.object({
  escalationId: uuid,
  status: escalationStatusSchema,
})

/**
 * RCA creation. The `.superRefine` mirrors the Postgres one-of CHECK on `rcas`
 * (§4.3): exactly one of escalationId / responseId is set, matching
 * subjectType. Enforcing it here means the API returns a readable field error
 * instead of a raw constraint violation.
 */
export const createRcaInputSchema = z
  .object({
    accountId: uuid,
    subjectType: z.enum(['escalation', 'dsat_response']),
    escalationId: uuid.optional(),
    responseId: uuid.optional(),
    method: rcaMethodSchema,
    problemStatement: z.string().trim().min(1).max(2000),
  })
  .superRefine((input, ctx) => {
    if (input.subjectType === 'escalation') {
      if (!input.escalationId) {
        ctx.addIssue({
          code: 'custom',
          path: ['escalationId'],
          message: 'An escalation-subject RCA requires escalationId',
        })
      }
      if (input.responseId) {
        ctx.addIssue({
          code: 'custom',
          path: ['responseId'],
          message: 'An escalation-subject RCA must not carry a responseId',
        })
      }
    } else {
      if (!input.responseId) {
        ctx.addIssue({
          code: 'custom',
          path: ['responseId'],
          message: 'A dsat_response-subject RCA requires responseId',
        })
      }
      if (input.escalationId) {
        ctx.addIssue({
          code: 'custom',
          path: ['escalationId'],
          message: 'A dsat_response-subject RCA must not carry an escalationId',
        })
      }
    }
  })

export type CreateRcaInput = z.infer<typeof createRcaInputSchema>

/** The 5 Whys chain (§4.3 rca_whys) — capped at five levels. */
export const rcaWhysInputSchema = z.object({
  rcaId: uuid,
  whys: z
    .array(
      z.object({
        level: z.number().int().min(1).max(5),
        question: z.string().trim().min(1).max(500),
        answer: z.string().trim().max(1000).optional(),
      }),
    )
    .max(5),
})

/** Fishbone branches (§4.3 rca_causes). */
export const rcaCausesInputSchema = z.object({
  rcaId: uuid,
  causes: z
    .array(
      z.object({
        bucket: z.string().trim().min(1).max(120),
        cause: z.string().trim().min(1).max(500),
      }),
    )
    .max(50),
})

/**
 * Setting the error category (§4.3, §6, §11).
 *
 * A human decision: §11 forbids AI setting the final category unaided, so this
 * procedure is what the author calls after reviewing any AI suggestion.
 */
export const setErrorCategoryInputSchema = z.object({
  rcaId: uuid,
  errorCategory: errorCategorySchema,
})

export const createActionInputSchema = z.object({
  accountId: uuid,
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).optional(),
  rcaId: uuid.optional(),
  escalationId: uuid.optional(),
  ownerUserId: uuid.optional(),
  eta: z.iso.date().optional(),
  priority: actionPrioritySchema.optional(),
})

export type CreateActionInput = z.infer<typeof createActionInputSchema>

export const updateActionInputSchema = z.object({
  actionId: uuid,
  status: actionStatusSchema.optional(),
  ownerUserId: uuid.nullable().optional(),
  eta: z.iso.date().nullable().optional(),
  priority: actionPrioritySchema.nullable().optional(),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(5000).optional(),
})
