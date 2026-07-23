import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { fileURLToPath, URL } from 'node:url'
import { uuidv7 } from 'uuidv7'
import { beforeAll, describe, expect, it } from 'vitest'
import * as schema from './index'

/**
 * Applies the real Drizzle Kit migrations to an in-process Postgres (PGlite)
 * and asserts that the integrity rules SPEC.md §4 calls out actually hold.
 *
 * This is the difference between "the constraint is in the generated SQL" and
 * "the constraint rejects bad data". These are contracts §4 marks
 * non-negotiable, so they are tested against a live engine rather than by
 * reading DDL. It needs no Neon connection, so it runs in CI.
 */

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

let db: ReturnType<typeof drizzle<typeof schema>>
let accountId: string
let surveyId: string
let escalationId: string
let dsatResponseId: string

beforeAll(async () => {
  const client = new PGlite()
  db = drizzle(client, { schema })

  await migrate(db, { migrationsFolder })

  const [network] = await db
    .insert(schema.networks)
    .values({ name: 'Zoo Media', slug: 'zoo-media' })
    .returning()
  const [agency] = await db
    .insert(schema.agencies)
    .values({ networkId: network!.id, name: 'The Starter Labs', slug: 'the-starter-labs' })
    .returning()
  const [account] = await db
    .insert(schema.accounts)
    .values({ agencyId: agency!.id, name: 'Mogu Mogu', slug: 'mogu-mogu' })
    .returning()
  accountId = account!.id

  const [survey] = await db
    .insert(schema.surveys)
    .values({
      accountId,
      type: 'csat',
      title: 'Monthly CSAT',
      source: 'google_form',
      cadence: 'monthly',
    })
    .returning()
  surveyId = survey!.id

  const [escalation] = await db
    .insert(schema.escalations)
    .values({
      accountId,
      source: 'email',
      severity: 'high',
      title: 'Missed deadline',
      reportedAt: new Date(),
    })
    .returning()
  escalationId = escalation!.id

  const [dsat] = await db
    .insert(schema.surveyResponses)
    .values({
      surveyId,
      accountId,
      type: 'csat',
      score: 2,
      source: 'native',
      submittedAt: new Date(),
    })
    .returning()
  dsatResponseId = dsat!.id
}, 60_000)

describe('migrations', () => {
  it('applies cleanly and creates all 18 tables from §4.3', async () => {
    const result = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    )
    const tables = result.rows.map((row) => row.table_name)

    for (const expected of [
      'networks',
      'agencies',
      'accounts',
      'users',
      'memberships',
      'surveys',
      'survey_questions',
      'survey_responses',
      'response_answers',
      'escalations',
      'rcas',
      'rca_whys',
      'rca_causes',
      'action_items',
      'metric_rollups',
      'sync_runs',
      'ai_analyses',
      'audit_logs',
    ]) {
      expect(tables).toContain(expected)
    }
  })

  it('creates every §4.2 enum as a Postgres enum', async () => {
    const result = await db.execute<{ typname: string }>(
      sql`SELECT typname FROM pg_type WHERE typtype = 'e'`,
    )
    const enums = result.rows.map((row) => row.typname)

    expect(enums).toEqual(
      expect.arrayContaining([
        'role_key',
        'scope_type',
        'metric_type',
        'survey_source',
        'question_kind',
        'escalation_source',
        'escalation_status',
        'severity',
        'rca_subject',
        'rca_method',
        'error_category',
        'action_status',
        'period_grain',
        'ai_kind',
        // Columns §4.3 leaves untyped, tightened to enums by decision.
        'account_status',
        'rca_status',
        'action_source_type',
        'sync_status',
        'action_priority',
      ]),
    )
  })
})

describe('enums tightened from text (§4.3 untyped columns)', () => {
  it('accepts every declared account_status and rejects anything else', async () => {
    const [agency] = await db.select().from(schema.agencies).limit(1)

    for (const status of ['prospect', 'active', 'paused', 'churned'] as const) {
      await expect(
        db
          .insert(schema.accounts)
          .values({ agencyId: agency!.id, name: status, slug: `probe-${status}`, status }),
      ).resolves.toBeDefined()
    }

    await expect(
      db.execute(
        sql`INSERT INTO accounts (id, agency_id, name, slug, status)
            VALUES (${uuidv7()}, ${agency!.id}, 'Bad', 'probe-bad', 'archived')`,
      ),
    ).rejects.toThrow()
  })

  it('rejects an undeclared rca_status', async () => {
    await expect(
      db.execute(
        sql`INSERT INTO rcas (id, account_id, subject_type, escalation_id, method, problem_statement, status)
            VALUES (${uuidv7()}, ${accountId}, 'escalation', ${escalationId}, 'five_whys', 'Probe', 'archived')`,
      ),
    ).rejects.toThrow()
  })

  it('defaults action_items.source_type to standalone rather than null', async () => {
    const [action] = await db
      .insert(schema.actionItems)
      .values({ accountId, title: 'Unattached action' })
      .returning()

    expect(action!.sourceType).toBe('standalone')
  })

  it('leaves action_items.priority null when unset, inventing no triage', async () => {
    const [action] = await db
      .insert(schema.actionItems)
      .values({ accountId, title: 'Untriaged action' })
      .returning()

    expect(action!.priority).toBeNull()
  })

  it('rejects an undeclared action_priority', async () => {
    await expect(
      db.execute(
        sql`INSERT INTO action_items (id, account_id, title, priority)
            VALUES (${uuidv7()}, ${accountId}, 'Bad priority', 'blocker')`,
      ),
    ).rejects.toThrow()
  })

  it('requires sync_runs.status, so a crashed job is never indistinguishable from none', async () => {
    await expect(
      db.insert(schema.syncRuns).values({ source: 'google_form', accountId, status: 'running' }),
    ).resolves.toBeDefined()

    await expect(
      db.execute(
        sql`INSERT INTO sync_runs (id, source, account_id, status)
            VALUES (${uuidv7()}, 'google_form', ${accountId}, 'aborted')`,
      ),
    ).rejects.toThrow()
  })
})

describe('survey_responses idempotent sync key (§4.1, §7.1)', () => {
  const externalId = 'google-row-0001'

  it('accepts the first import of an external response', async () => {
    await db.insert(schema.surveyResponses).values({
      surveyId,
      accountId,
      type: 'csat',
      score: 5,
      source: 'google_form',
      externalResponseId: externalId,
      submittedAt: new Date(),
    })

    const rows = await db.select().from(schema.surveyResponses)
    expect(rows.filter((row) => row.externalResponseId === externalId)).toHaveLength(1)
  })

  it('rejects a duplicate (source, external_response_id), making re-sync safe', async () => {
    await expect(
      db.insert(schema.surveyResponses).values({
        surveyId,
        accountId,
        type: 'csat',
        score: 5,
        source: 'google_form',
        externalResponseId: externalId,
        submittedAt: new Date(),
      }),
    ).rejects.toThrow()
  })

  it('allows many native responses, whose external id is null', async () => {
    // Postgres treats NULLs as distinct in a unique constraint. Native and
    // manual entry must not be throttled by the Google idempotency key.
    const values = {
      surveyId,
      accountId,
      type: 'csat' as const,
      score: 4,
      source: 'native' as const,
      submittedAt: new Date(),
    }

    await db.insert(schema.surveyResponses).values(values)
    await db.insert(schema.surveyResponses).values(values)

    const rows = await db.select().from(schema.surveyResponses)
    expect(rows.filter((row) => row.source === 'native').length).toBeGreaterThanOrEqual(2)
  })
})

describe('survey_responses score range CHECK (§1, §4.3)', () => {
  /**
   * A function, not a const: the ids are assigned in beforeAll, which runs
   * after the describe body is evaluated. Capturing them eagerly would insert
   * a null survey_id and fail on NOT NULL before the CHECK was ever exercised.
   */
  const base = () => ({
    surveyId,
    accountId,
    source: 'native' as const,
    submittedAt: new Date(),
  })

  it('accepts CSAT scores 1 through 5', async () => {
    for (const score of [1, 2, 3, 4, 5]) {
      await expect(
        db.insert(schema.surveyResponses).values({ ...base(), type: 'csat', score }),
      ).resolves.toBeDefined()
    }
  })

  it('rejects a CSAT score of 0 or 6', async () => {
    await expect(
      db.insert(schema.surveyResponses).values({ ...base(), type: 'csat', score: 0 }),
    ).rejects.toThrow()

    await expect(
      db.insert(schema.surveyResponses).values({ ...base(), type: 'csat', score: 6 }),
    ).rejects.toThrow()
  })

  it('accepts NPS scores 0 through 10', async () => {
    for (const score of [0, 5, 10]) {
      await expect(
        db.insert(schema.surveyResponses).values({ ...base(), type: 'nps', score }),
      ).resolves.toBeDefined()
    }
  })

  it('rejects an NPS score of 11', async () => {
    await expect(
      db.insert(schema.surveyResponses).values({ ...base(), type: 'nps', score: 11 }),
    ).rejects.toThrow()
  })

  it('applies the bound per metric type, not globally', async () => {
    // 8 is a valid NPS score but out of range for CSAT's 1-5 scale.
    await expect(
      db.insert(schema.surveyResponses).values({ ...base(), type: 'nps', score: 8 }),
    ).resolves.toBeDefined()

    await expect(
      db.insert(schema.surveyResponses).values({ ...base(), type: 'csat', score: 8 }),
    ).rejects.toThrow()
  })
})

describe('rcas one-of subject CHECK (§4.3)', () => {
  const base = { method: 'five_whys' as const, problemStatement: 'Deadline missed' }

  it('accepts an escalation-subject RCA pointing only at an escalation', async () => {
    await expect(
      db
        .insert(schema.rcas)
        .values({ ...base, accountId, subjectType: 'escalation', escalationId }),
    ).resolves.toBeDefined()
  })

  it('accepts a dsat_response-subject RCA pointing only at a response', async () => {
    await expect(
      db
        .insert(schema.rcas)
        .values({ ...base, accountId, subjectType: 'dsat_response', responseId: dsatResponseId }),
    ).resolves.toBeDefined()
  })

  it('rejects an RCA with neither subject set', async () => {
    await expect(
      db.insert(schema.rcas).values({ ...base, accountId, subjectType: 'escalation' }),
    ).rejects.toThrow()
  })

  it('rejects an RCA with both subjects set', async () => {
    await expect(
      db.insert(schema.rcas).values({
        ...base,
        accountId,
        subjectType: 'escalation',
        escalationId,
        responseId: dsatResponseId,
      }),
    ).rejects.toThrow()
  })

  it('rejects a subject_type that disagrees with the populated FK', async () => {
    // Claims to be about an escalation but points at a response.
    await expect(
      db
        .insert(schema.rcas)
        .values({ ...base, accountId, subjectType: 'escalation', responseId: dsatResponseId }),
    ).rejects.toThrow()
  })
})

describe('memberships uniqueness (§4.3, §5.2)', () => {
  it('permits one role per user per scope, and rejects a second', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'lead@thestarterlabs.com', name: 'Lead' })
      .returning()

    const membership = {
      userId: user!.id,
      scopeType: 'account' as const,
      scopeId: accountId,
      role: 'account_manager' as const,
    }

    await expect(db.insert(schema.memberships).values(membership)).resolves.toBeDefined()
    await expect(
      db.insert(schema.memberships).values({ ...membership, role: 'viewer' }),
    ).rejects.toThrow()
  })
})

describe('metric_rollups upsert key (§4.3)', () => {
  it('rejects a duplicate scope/metric/period, so recomputation must upsert', async () => {
    const rollup = {
      scopeType: 'account' as const,
      scopeId: accountId,
      metric: 'csat_percent',
      periodGrain: 'monthly' as const,
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      value: '82.5',
      sampleSize: 40,
    }

    await expect(db.insert(schema.metricRollups).values(rollup)).resolves.toBeDefined()
    await expect(db.insert(schema.metricRollups).values(rollup)).rejects.toThrow()
  })

  it('stores a null value for a period with no responses, distinct from zero', async () => {
    const [row] = await db
      .insert(schema.metricRollups)
      .values({
        scopeType: 'account',
        scopeId: accountId,
        metric: 'csat_percent',
        periodGrain: 'monthly',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        value: null,
        sampleSize: 0,
      })
      .returning()

    expect(row!.value).toBeNull()
  })
})

describe('ON DELETE behaviour (§4.1)', () => {
  it('RESTRICTs deleting an account that still has responses', async () => {
    await expect(db.execute(sql`DELETE FROM accounts WHERE id = ${accountId}`)).rejects.toThrow()
  })

  it('CASCADEs owned child rows: rca_whys die with their rca', async () => {
    const [rca] = await db
      .insert(schema.rcas)
      .values({
        accountId,
        subjectType: 'escalation',
        escalationId,
        method: 'five_whys',
        problemStatement: 'Cascade probe',
      })
      .returning()

    await db
      .insert(schema.rcaWhys)
      .values({ rcaId: rca!.id, level: 1, question: 'Why?', answer: 'Because.' })

    await db.execute(sql`DELETE FROM rcas WHERE id = ${rca!.id}`)

    const whys = await db.select().from(schema.rcaWhys)
    expect(whys.filter((why) => why.rcaId === rca!.id)).toHaveLength(0)
  })
})

describe('updated_at trigger backstop (§4.1)', () => {
  it('advances updated_at on a raw SQL update that bypasses the ORM', async () => {
    const [network] = await db
      .insert(schema.networks)
      .values({ id: uuidv7(), name: 'Trigger Probe', slug: 'trigger-probe' })
      .returning()

    const before = network!.updatedAt

    // Deliberately raw: $onUpdate cannot fire here, so only the DB trigger can
    // keep updated_at honest. This is exactly the gap §4.1 asks it to cover.
    await db.execute(sql`UPDATE networks SET name = 'Renamed' WHERE id = ${network!.id}`)

    const [after] = await db
      .select()
      .from(schema.networks)
      .where(sql`id = ${network!.id}`)

    expect(after!.updatedAt.getTime()).toBeGreaterThan(before.getTime())
  })
})
