import { z } from 'zod'

/**
 * Enum single source of truth — SPEC.md §4.2.
 *
 * §4.1 requires these to be Postgres enums declared via Drizzle `pgEnum`, and
 * §4.2 requires them to be listed here "so the app and DB agree". packages/db
 * builds its `pgEnum`s from these exact tuples, so adding a member here and
 * regenerating is the only way to change one — the two cannot drift.
 *
 * Each list is `as const` so the Zod enum, the TS union, and the pgEnum are all
 * derived from one literal tuple.
 */

export const ROLE_KEYS = [
  'super_admin',
  'network_admin',
  'agency_admin',
  'account_director',
  'account_manager',
  'team_member',
  'viewer',
] as const
export const roleKeySchema = z.enum(ROLE_KEYS)
export type RoleKey = z.infer<typeof roleKeySchema>

export const SCOPE_TYPES = ['network', 'agency', 'account'] as const
export const scopeTypeSchema = z.enum(SCOPE_TYPES)
export type ScopeType = z.infer<typeof scopeTypeSchema>

export const METRIC_TYPES = ['csat', 'nps'] as const
export const metricTypeSchema = z.enum(METRIC_TYPES)
export type MetricType = z.infer<typeof metricTypeSchema>

export const SURVEY_SOURCES = ['google_form', 'native', 'import'] as const
export const surveySourceSchema = z.enum(SURVEY_SOURCES)
export type SurveySource = z.infer<typeof surveySourceSchema>

export const QUESTION_KINDS = ['scale', 'text', 'single_choice', 'multi_choice'] as const
export const questionKindSchema = z.enum(QUESTION_KINDS)
export type QuestionKind = z.infer<typeof questionKindSchema>

export const ESCALATION_SOURCES = ['form', 'email', 'call', 'meeting', 'other'] as const
export const escalationSourceSchema = z.enum(ESCALATION_SOURCES)
export type EscalationSource = z.infer<typeof escalationSourceSchema>

export const ESCALATION_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const
export const escalationStatusSchema = z.enum(ESCALATION_STATUSES)
export type EscalationStatus = z.infer<typeof escalationStatusSchema>

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export const severitySchema = z.enum(SEVERITIES)
export type Severity = z.infer<typeof severitySchema>

export const RCA_SUBJECTS = ['escalation', 'dsat_response'] as const
export const rcaSubjectSchema = z.enum(RCA_SUBJECTS)
export type RcaSubject = z.infer<typeof rcaSubjectSchema>

export const RCA_METHODS = ['five_whys', 'fishbone', 'scatter'] as const
export const rcaMethodSchema = z.enum(RCA_METHODS)
export type RcaMethod = z.infer<typeof rcaMethodSchema>

export const ERROR_CATEGORIES = ['people', 'process', 'product'] as const
export const errorCategorySchema = z.enum(ERROR_CATEGORIES)
export type ErrorCategory = z.infer<typeof errorCategorySchema>

export const ACTION_STATUSES = ['open', 'in_progress', 'blocked', 'done'] as const
export const actionStatusSchema = z.enum(ACTION_STATUSES)
export type ActionStatus = z.infer<typeof actionStatusSchema>

export const PERIOD_GRAINS = ['monthly', 'quarterly', 'custom'] as const
export const periodGrainSchema = z.enum(PERIOD_GRAINS)
export type PeriodGrain = z.infer<typeof periodGrainSchema>

/**
 * The five enums below are not in §4.2. §4.3 names these columns but leaves
 * them untyped, and they were `text` through Milestone 2 for that reason.
 * Tightened to Postgres enums by decision while the schema was still empty,
 * so no data migration was needed.
 */

export const ACCOUNT_STATUSES = ['prospect', 'active', 'paused', 'churned'] as const
export const accountStatusSchema = z.enum(ACCOUNT_STATUSES)
export type AccountStatus = z.infer<typeof accountStatusSchema>

export const RCA_STATUSES = ['open', 'in_progress', 'closed'] as const
export const rcaStatusSchema = z.enum(RCA_STATUSES)
export type RcaStatus = z.infer<typeof rcaStatusSchema>

export const ACTION_SOURCE_TYPES = ['rca', 'escalation', 'standalone'] as const
export const actionSourceTypeSchema = z.enum(ACTION_SOURCE_TYPES)
export type ActionSourceType = z.infer<typeof actionSourceTypeSchema>

export const SYNC_STATUSES = ['running', 'success', 'partial', 'failed'] as const
export const syncStatusSchema = z.enum(SYNC_STATUSES)
export type SyncStatus = z.infer<typeof syncStatusSchema>

export const ACTION_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export const actionPrioritySchema = z.enum(ACTION_PRIORITIES)
export type ActionPriority = z.infer<typeof actionPrioritySchema>

export const AI_KINDS = ['sentiment', 'theme', 'category_suggestion', 'summary'] as const
export const aiKindSchema = z.enum(AI_KINDS)
export type AiKind = z.infer<typeof aiKindSchema>

/**
 * Score bounds per metric — §1 and §4.3. CSAT is a 1-5 transactional scale;
 * NPS is an 0-10 relationship scale. Enforced three times over: here for form
 * and tRPC input validation, and as a Postgres CHECK on survey_responses.
 */
export const SCORE_BOUNDS = {
  csat: { min: 1, max: 5 },
  nps: { min: 0, max: 10 },
} as const satisfies Record<MetricType, { min: number; max: number }>

/** Scores 4-5 are satisfied; 1-3 are DSAT (§1, §6). */
export const CSAT_SATISFIED_MIN = 4

/** NPS promoters score 9-10; detractors 0-6; passives 7-8 (§1, §6). */
export const NPS_PROMOTER_MIN = 9
export const NPS_DETRACTOR_MAX = 6
