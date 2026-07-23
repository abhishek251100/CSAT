import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { accounts } from './org'
import {
  createdAt,
  deletedAt,
  metricTypeEnum,
  periodGrainEnum,
  primaryId,
  questionKindEnum,
  surveySourceEnum,
  updatedAt,
} from './_shared'

/**
 * Surveys and responses — SPEC.md §4.3.
 *
 * Both ingestion paths in §7 land in the same normalised tables: Google Forms
 * sync writes with source='google_form' and an external_response_id, native
 * surveys write with source='native'. Dashboards never care which.
 */

export const surveys = pgTable(
  'surveys',
  {
    id: primaryId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    type: metricTypeEnum('type').notNull(),
    title: text('title').notNull(),
    source: surveySourceEnum('source').notNull(),
    sourceFormId: text('source_form_id'),
    cadence: periodGrainEnum('cadence').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    /**
     * Marks synthetic demo data (`pnpm --filter @zoo/api demo:seed`).
     *
     * A dedicated column, not a title convention, so demo rows are
     * unambiguously identifiable and `demo:purge` can remove them with a single
     * predicate that cannot accidentally match a real survey. Real data is
     * always `false`; the seed is the only writer that sets it true, and it
     * refuses to run when NODE_ENV=production.
     */
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('surveys_account_id_type_idx').on(table.accountId, table.type)],
)

/** Native surveys only (§7.2) — Google-sourced surveys have no question rows. */
export const surveyQuestions = pgTable(
  'survey_questions',
  {
    id: primaryId(),
    surveyId: uuid('survey_id')
      .notNull()
      // CASCADE: questions are owned child rows of a survey (§4.1).
      .references(() => surveys.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    kind: questionKindEnum('kind').notNull(),
    position: integer('position').notNull(),
    isRequired: boolean('is_required').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [index('survey_questions_survey_id_idx').on(table.surveyId)],
)

export const surveyResponses = pgTable(
  'survey_responses',
  {
    id: primaryId(),
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => surveys.id, { onDelete: 'restrict' }),
    /**
     * Denormalised from surveys.account_id on purpose: every dashboard query
     * filters responses by account and period, and §12 requires those reads to
     * avoid a join back through surveys.
     */
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    type: metricTypeEnum('type').notNull(),

    /**
     * The headline value: 1-5 for CSAT, 0-10 for NPS (§4.3). smallint, never a
     * float (§4.1). NOT NULL — §7.1 lists "missing score" as a sync failure
     * mode, and such rows are counted into sync_runs.rows_skipped rather than
     * stored as a scoreless response that would silently distort every average.
     *
     * DSAT is derived from this (`type='csat' AND score<=3`), never stored.
     */
    score: smallint('score').notNull(),

    respondentName: text('respondent_name'),
    respondentEmail: text('respondent_email'),
    source: surveySourceEnum('source').notNull(),
    externalResponseId: text('external_response_id'),

    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),

    /**
     * Marks synthetic demo data — see the same column on `surveys`. Real
     * responses are always `false`; `demo:purge` deletes exactly the rows where
     * this is true, so demo numbers can never be mistaken for real ones and can
     * be removed without touching a single genuine response.
     */
    isDemo: boolean('is_demo').notNull().default(false),

    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    /**
     * Idempotent import key (§4.1, §7.1): re-running a Google sync must not
     * duplicate rows.
     *
     * Postgres treats NULLs as distinct in a unique constraint, so native and
     * manually-entered responses — which have no external_response_id — are
     * unaffected and can be inserted freely. That is the intended behaviour,
     * not an oversight.
     */
    unique('survey_responses_source_external_id_key').on(table.source, table.externalResponseId),

    index('survey_responses_account_submitted_idx').on(table.accountId, table.submittedAt),
    index('survey_responses_type_submitted_idx').on(table.type, table.submittedAt),
    index('survey_responses_survey_id_idx').on(table.surveyId),

    /**
     * Score bounds per metric type (§1, §4.3). Mirrors SCORE_BOUNDS in
     * @zoo/shared so an out-of-range score cannot enter through any path —
     * ORM, raw SQL, or a drifted Google Form column mapping.
     */
    check(
      'survey_responses_score_range_check',
      sql`(${table.type} = 'csat' AND ${table.score} BETWEEN 1 AND 5)
       OR (${table.type} = 'nps'  AND ${table.score} BETWEEN 0 AND 10)`,
    ),
  ],
)

/** Open-text and secondary answers (§4.3). */
export const responseAnswers = pgTable(
  'response_answers',
  {
    id: primaryId(),
    responseId: uuid('response_id')
      .notNull()
      // CASCADE: answers are owned child rows of a response (§4.1).
      .references(() => surveyResponses.id, { onDelete: 'cascade' }),
    /**
     * SET NULL rather than CASCADE: deleting a question from a native survey
     * must not destroy answers already given to it. question_label preserves
     * what was actually asked.
     */
    questionId: uuid('question_id').references(() => surveyQuestions.id, { onDelete: 'set null' }),
    questionLabel: text('question_label'),
    answerText: text('answer_text'),
    answerValue: smallint('answer_value'),
    createdAt: createdAt(),
  },
  (table) => [index('response_answers_response_id_idx').on(table.responseId)],
)
