import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  date,
} from 'drizzle-orm/pg-core'
import { users } from './identity'
import { accounts } from './org'
import {
  aiKindEnum,
  createdAt,
  periodGrainEnum,
  primaryId,
  scopeTypeEnum,
  surveySourceEnum,
  syncStatusEnum,
} from './_shared'

/**
 * Aggregation and ops — SPEC.md §4.3.
 */

/**
 * Precomputed metrics per scope per period (§4.3, §12).
 *
 * Dashboards read this table, not raw responses; only custom ranges fall back
 * to live compute (§8 metrics router). A cron recomputes the current and
 * previous period on a schedule and on write.
 *
 * Values are produced exclusively by the metric functions in @zoo/shared, never
 * by SQL aggregates — that is what keeps one definition of each metric (§3).
 */
export const metricRollups = pgTable(
  'metric_rollups',
  {
    id: primaryId(),
    scopeType: scopeTypeEnum('scope_type').notNull(),
    /** Soft FK to networks / agencies / accounts, per scope_type (as §4.3 §5.2). */
    scopeId: uuid('scope_id').notNull(),
    /** 'csat_percent', 'nps', 'dsat_count', 'escalation_count', 'response_count'. */
    metric: text('metric').notNull(),
    periodGrain: periodGrainEnum('period_grain').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),

    /**
     * Nullable on purpose, matching the empty-set convention in @zoo/shared:
     * a period with no responses stores NULL, not 0. "No data" and "zero
     * percent" must stay distinguishable all the way to the KPI card.
     *
     * numeric, not float — §4.1 forbids floats for score-derived values.
     */
    value: numeric('value'),
    sampleSize: integer('sample_size').notNull().default(0),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    /** Makes rollup recomputation an idempotent upsert (§4.3). */
    unique('metric_rollups_scope_metric_period_key').on(
      table.scopeType,
      table.scopeId,
      table.metric,
      table.periodGrain,
      table.periodStart,
    ),
    index('metric_rollups_scope_metric_start_idx').on(
      table.scopeType,
      table.scopeId,
      table.metric,
      table.periodStart,
    ),
  ],
)

/** Google sync run history (§4.3, §7.1). */
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: primaryId(),
    source: surveySourceEnum('source').notNull(),
    /** SET NULL: run history outlives an account being removed. */
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /**
     * §4.3 leaves this untyped; tightened to an enum by decision. No default —
     * a run must declare itself 'running' when it starts, so a crashed job is
     * never silently indistinguishable from one that never began.
     */
    status: syncStatusEnum('status').notNull(),
    rowsSeen: integer('rows_seen').notNull().default(0),
    rowsImported: integer('rows_imported').notNull().default(0),
    /** Includes rows rejected for a missing or out-of-range score (§7.1). */
    rowsSkipped: integer('rows_skipped').notNull().default(0),
    error: text('error'),
    createdAt: createdAt(),
  },
  (table) => [index('sync_runs_account_started_idx').on(table.accountId, table.startedAt)],
)

/**
 * AI output cache (§4.3, §11).
 *
 * The unique key on (entity, kind, input_hash) is what makes identical input
 * free on repeat: an unchanged problem statement never re-bills a completion.
 * Output is advisory and never a system-of-record field (§11 guardrails).
 */
export const aiAnalyses = pgTable(
  'ai_analyses',
  {
    id: primaryId(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    kind: aiKindEnum('kind').notNull(),
    /** Logged per §11 so output can be traced to a model and prompt version. */
    model: text('model').notNull(),
    inputHash: text('input_hash').notNull(),
    output: jsonb('output').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique('ai_analyses_entity_kind_hash_key').on(
      table.entityType,
      table.entityId,
      table.kind,
      table.inputHash,
    ),
  ],
)

/**
 * Audit trail (§4.1, §12): every create/update/delete of escalations, RCAs,
 * actions, accounts and memberships.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    /** SET NULL: the trail must survive the actor being deleted. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    diff: jsonb('diff'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_logs_entity_idx').on(table.entityType, table.entityId),
    index('audit_logs_actor_created_idx').on(table.actorUserId, table.createdAt),
  ],
)
