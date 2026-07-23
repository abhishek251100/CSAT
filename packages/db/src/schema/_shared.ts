import {
  ACCOUNT_STATUSES,
  ACTION_PRIORITIES,
  ACTION_SOURCE_TYPES,
  ACTION_STATUSES,
  AI_KINDS,
  ERROR_CATEGORIES,
  ESCALATION_SOURCES,
  ESCALATION_STATUSES,
  METRIC_TYPES,
  PERIOD_GRAINS,
  QUESTION_KINDS,
  RCA_METHODS,
  RCA_STATUSES,
  RCA_SUBJECTS,
  ROLE_KEYS,
  SCOPE_TYPES,
  SEVERITIES,
  SURVEY_SOURCES,
  SYNC_STATUSES,
} from '@zoo/shared'
import { pgEnum, timestamp, uuid } from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'

/**
 * Postgres enums (SPEC.md §4.2) and the column conventions from §4.1.
 *
 * Every enum below is built from the tuple exported by @zoo/shared, so the
 * database type and the application type are literally the same list. Adding a
 * member means editing packages/shared/src/enums.ts and regenerating — there is
 * no second place to update.
 */

export const roleKeyEnum = pgEnum('role_key', ROLE_KEYS)
export const scopeTypeEnum = pgEnum('scope_type', SCOPE_TYPES)
export const metricTypeEnum = pgEnum('metric_type', METRIC_TYPES)
export const surveySourceEnum = pgEnum('survey_source', SURVEY_SOURCES)
export const questionKindEnum = pgEnum('question_kind', QUESTION_KINDS)
export const escalationSourceEnum = pgEnum('escalation_source', ESCALATION_SOURCES)
export const escalationStatusEnum = pgEnum('escalation_status', ESCALATION_STATUSES)
export const severityEnum = pgEnum('severity', SEVERITIES)
export const rcaSubjectEnum = pgEnum('rca_subject', RCA_SUBJECTS)
export const rcaMethodEnum = pgEnum('rca_method', RCA_METHODS)
export const errorCategoryEnum = pgEnum('error_category', ERROR_CATEGORIES)
export const actionStatusEnum = pgEnum('action_status', ACTION_STATUSES)
export const periodGrainEnum = pgEnum('period_grain', PERIOD_GRAINS)
export const aiKindEnum = pgEnum('ai_kind', AI_KINDS)

/** Columns §4.3 names but leaves untyped — tightened from text by decision. */
export const accountStatusEnum = pgEnum('account_status', ACCOUNT_STATUSES)
export const rcaStatusEnum = pgEnum('rca_status', RCA_STATUSES)
export const actionSourceTypeEnum = pgEnum('action_source_type', ACTION_SOURCE_TYPES)
export const syncStatusEnum = pgEnum('sync_status', SYNC_STATUSES)
export const actionPriorityEnum = pgEnum('action_priority', ACTION_PRIORITIES)

/**
 * Time-ordered UUID v7 primary key (§4.1: "Do not use bare serial ints").
 *
 * Generated in application code rather than by a Postgres default, because
 * `uuidv7()` is only built in from Postgres 18 and this must work on whatever
 * version a Neon branch runs. The trade-off is that raw SQL INSERTs must supply
 * an id — acceptable, since §12 routes all writes through the app and all DDL
 * through Drizzle Kit.
 *
 * v7 over v4 so ids sort by creation time, which keeps index inserts appending
 * to the right-hand edge of the B-tree instead of scattering across it.
 */
export const primaryId = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7())

/** §4.1: every table carries created_at. */
export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

/**
 * §4.1: updated_at on every table whose rows mutate, maintained by Drizzle
 * `$onUpdate`. A database trigger backstops this for writes that bypass the ORM
 * — see the custom migration in packages/db/drizzle.
 */
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

/**
 * §4.1: soft delete, only on tables that require retention — accounts,
 * escalations, rcas, action_items, survey_responses. Everything else hard
 * deletes.
 */
export const deletedAt = () => timestamp('deleted_at', { withTimezone: true })
