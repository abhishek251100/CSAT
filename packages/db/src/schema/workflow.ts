import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './identity'
import { accounts } from './org'
import { surveyResponses } from './surveys'
import {
  actionPriorityEnum,
  actionSourceTypeEnum,
  actionStatusEnum,
  createdAt,
  deletedAt,
  errorCategoryEnum,
  escalationSourceEnum,
  escalationStatusEnum,
  primaryId,
  rcaMethodEnum,
  rcaStatusEnum,
  rcaSubjectEnum,
  severityEnum,
  updatedAt,
} from './_shared'

/**
 * Escalations, RCA and corrective actions — SPEC.md §4.3.
 *
 * The workflow the product operationalises (§1): critical feedback becomes an
 * escalation, every escalation and every DSAT requires an RCA, and each RCA
 * produces an error category plus corrective action items with owner and ETA.
 */

export const escalations = pgTable(
  'escalations',
  {
    id: primaryId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    /** SET NULL so removing a user does not erase the escalation history. */
    raisedByUserId: uuid('raised_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    source: escalationSourceEnum('source').notNull(),
    severity: severityEnum('severity').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: escalationStatusEnum('status').notNull().default('open'),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** Marks a synthetic demo escalation; removed by demo:purge. */
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index('escalations_account_status_reported_idx').on(
      table.accountId,
      table.status,
      table.reportedAt,
    ),
  ],
)

export const rcas = pgTable(
  'rcas',
  {
    id: primaryId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),

    subjectType: rcaSubjectEnum('subject_type').notNull(),
    escalationId: uuid('escalation_id').references(() => escalations.id, { onDelete: 'set null' }),
    responseId: uuid('response_id').references(() => surveyResponses.id, { onDelete: 'set null' }),

    method: rcaMethodEnum('method').notNull(),
    /**
     * Nullable until a human sets it. §11 is explicit that AI may suggest a
     * category but never sets the final value unaided, so "not yet decided"
     * must be representable. `errorCategoryDistribution` in @zoo/shared
     * excludes nulls from its denominator.
     */
    errorCategory: errorCategoryEnum('error_category'),
    problemStatement: text('problem_statement').notNull(),
    findings: jsonb('findings'),
    /** §4.3 leaves this untyped; tightened to an enum by decision. */
    status: rcaStatusEnum('status').notNull().default('open'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Marks a synthetic demo RCA; removed by demo:purge. */
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index('rcas_account_created_idx').on(table.accountId, table.createdAt),
    index('rcas_error_category_idx').on(table.errorCategory),

    /**
     * One-of subject FK (§4.3): exactly one of escalation_id / response_id is
     * set, and it must match subject_type. An RCA about an escalation cannot
     * also point at a response, and neither may be orphaned.
     *
     * Note the interaction with the SET NULL foreign keys above, which §4.3
     * also mandates: hard-deleting an escalation that has an RCA would null
     * escalation_id and violate this CHECK, so the delete fails instead of
     * silently orphaning the analysis. That is the safer outcome, and the
     * normal path is a soft delete via deleted_at anyway.
     */
    check(
      'rcas_one_of_subject_check',
      sql`(${table.subjectType} = 'escalation'    AND ${table.escalationId} IS NOT NULL AND ${table.responseId} IS NULL)
       OR (${table.subjectType} = 'dsat_response' AND ${table.responseId}   IS NOT NULL AND ${table.escalationId} IS NULL)`,
    ),
  ],
)

/** The 5 Whys chain (§4.3). CASCADE — owned child rows of an RCA. */
export const rcaWhys = pgTable(
  'rca_whys',
  {
    id: primaryId(),
    rcaId: uuid('rca_id')
      .notNull()
      .references(() => rcas.id, { onDelete: 'cascade' }),
    level: smallint('level').notNull(),
    question: text('question').notNull(),
    answer: text('answer'),
    createdAt: createdAt(),
  },
  (table) => [index('rca_whys_rca_id_level_idx').on(table.rcaId, table.level)],
)

/** Fishbone branches (§4.3). CASCADE — owned child rows of an RCA. */
export const rcaCauses = pgTable(
  'rca_causes',
  {
    id: primaryId(),
    rcaId: uuid('rca_id')
      .notNull()
      .references(() => rcas.id, { onDelete: 'cascade' }),
    bucket: text('bucket').notNull(),
    cause: text('cause').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('rca_causes_rca_id_idx').on(table.rcaId)],
)

export const actionItems = pgTable(
  'action_items',
  {
    id: primaryId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    /**
     * What spawned this item. §4.3 leaves it untyped; tightened to an enum by
     * decision. NOT NULL with a 'standalone' default because the enum now has
     * an explicit member for "neither an RCA nor an escalation" — keeping the
     * column nullable as well would make null and 'standalone' two spellings of
     * the same state.
     */
    sourceType: actionSourceTypeEnum('source_type').notNull().default('standalone'),
    rcaId: uuid('rca_id').references(() => rcas.id, { onDelete: 'set null' }),
    escalationId: uuid('escalation_id').references(() => escalations.id, { onDelete: 'set null' }),

    title: text('title').notNull(),
    description: text('description'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * A calendar date, not a timestamp. Overdue is `status != done AND eta <
     * today` (§6) and `overdueActionCount` in @zoo/shared compares ISO date
     * strings, so this never shifts a day across timezones.
     */
    eta: date('eta'),
    /**
     * §4.3 leaves this untyped; tightened to an enum by decision. Left
     * nullable — unlike source_type there is no natural "unset" member, and
     * defaulting to 'medium' would invent a triage decision nobody made.
     */
    priority: actionPriorityEnum('priority'),
    status: actionStatusEnum('status').notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Marks a synthetic demo action item; removed by demo:purge. */
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    // "My open actions" — the team_member's primary view (§5.1).
    index('action_items_owner_status_idx').on(table.ownerUserId, table.status),
    // Overdue and open-action queries per account (§9 View 2).
    index('action_items_account_status_eta_idx').on(table.accountId, table.status, table.eta),
  ],
)
