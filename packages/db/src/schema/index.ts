/**
 * Drizzle schema — SPEC.md §4, a non-negotiable contract.
 *
 * Split to mirror the groupings in §4.3:
 *   _shared   enums (§4.2) and the column conventions from §4.1
 *   org       networks, agencies, accounts
 *   identity  users, memberships
 *   surveys   surveys, survey_questions, survey_responses, response_answers
 *   workflow  escalations, rcas, rca_whys, rca_causes, action_items
 *   ops       metric_rollups, sync_runs, ai_analyses, audit_logs
 *
 * All DDL goes through Drizzle Kit (`pnpm db:generate`, then `db:migrate`).
 * §12 forbids manual DDL in production.
 */
export * from './_shared'
export * from './auth'
export * from './identity'
export * from './ops'
export * from './org'
export * from './surveys'
export * from './workflow'
