import type { AppDb } from '@zoo/db'
import {
  accounts,
  actionItems,
  agencies,
  escalations,
  networks,
  rcas,
  responseAnswers,
  surveyQuestions,
  surveyResponses,
  surveys,
  users,
} from '@zoo/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '../testing/db'
import { demoRowCounts, purgeDemo, seedDemo } from './demo-data'

/**
 * The rich demo dataset must exercise the whole flow across two agencies, mark
 * everything it adds `is_demo`, and be fully removable — leaving the real
 * network, agency and accounts with zero associated rows.
 */

const NOW = new Date('2026-07-23T12:00:00.000Z')

let db: AppDb
const ids = { network: '', tsl: '', mogu: '', chemistry: '' }

/** Seeds the real org: network, real TSL agency, and two real accounts whose
 * slugs match the demo builder's REAL_ACCOUNT_PROFILES. */
async function seedOrg() {
  const [network] = await db.insert(networks).values({ name: 'Zoo Media', slug: 'zoo' }).returning()
  const [tsl] = await db
    .insert(agencies)
    .values({ networkId: network!.id, name: 'The Starter Labs', slug: 'tsl' })
    .returning()
  ids.network = network!.id
  ids.tsl = tsl!.id

  const [mogu] = await db
    .insert(accounts)
    .values({ agencyId: tsl!.id, name: 'Mogu Mogu', slug: 'mogu-mogu' })
    .returning()
  const [chemistry] = await db
    .insert(accounts)
    .values({ agencyId: tsl!.id, name: 'Chemistry', slug: 'chemistry' })
    .returning()
  ids.mogu = mogu!.id
  ids.chemistry = chemistry!.id

  // The break-glass admin, used by the builder for raised_by / owner.
  await db.insert(users).values({ email: 'admin@thestarterlabs.com', name: 'Admin' })
}

async function seedRealResponse(accountId: string) {
  const [survey] = await db
    .insert(surveys)
    .values({ accountId, type: 'csat', title: 'Manual', source: 'import', cadence: 'monthly' })
    .returning()
  await db.insert(surveyResponses).values({
    surveyId: survey!.id,
    accountId,
    type: 'csat',
    score: 5,
    source: 'import',
    submittedAt: NOW,
  })
}

beforeAll(async () => {
  db = await createTestDb()
}, 60_000)

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE response_answers, survey_questions, survey_responses, surveys, action_items, rcas, escalations, accounts, agencies, networks, users RESTART IDENTITY CASCADE`,
  )
  await seedOrg()
})

describe('seedDemo — two-agency structure', () => {
  it('adds exactly one demo agency, marked is_demo, under the real network', async () => {
    await seedDemo(db, NOW)

    const demoAgencies = await db.select().from(agencies).where(eq(agencies.isDemo, true))
    expect(demoAgencies).toHaveLength(1)
    expect(demoAgencies[0]!.networkId).toBe(ids.network)

    const realAgencies = await db.select().from(agencies).where(eq(agencies.isDemo, false))
    expect(realAgencies).toHaveLength(1) // TSL untouched
  })

  it('adds demo accounts under the demo agency, all marked', async () => {
    await seedDemo(db, NOW)

    const demoAccounts = await db.select().from(accounts).where(eq(accounts.isDemo, true))
    expect(demoAccounts.length).toBeGreaterThanOrEqual(5)
    expect(demoAccounts.every((a) => a.isDemo)).toBe(true)
  })

  it('leaves the two real accounts as real (never re-marked)', async () => {
    await seedDemo(db, NOW)

    const real = await db.select().from(accounts).where(eq(accounts.isDemo, false))
    expect(real.map((a) => a.slug).sort()).toEqual(['chemistry', 'mogu-mogu'])
  })
})

describe('seedDemo marks every entity it writes', () => {
  it('sets is_demo on surveys, responses, escalations, rcas and actions', async () => {
    await seedDemo(db, NOW)

    for (const table of [surveys, surveyResponses, escalations, rcas, actionItems]) {
      const rows = await db.select().from(table as typeof surveys)
      expect(rows.length, 'each entity type is populated').toBeGreaterThan(0)
      expect(
        rows.every((r) => (r as { isDemo: boolean }).isDemo),
        'every row is is_demo',
      ).toBe(true)
    }
  })

  it('puts demo data on BOTH agencies (real accounts and demo accounts)', async () => {
    await seedDemo(db, NOW)

    // Real TSL accounts carry demo responses...
    const onReal = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(surveyResponses)
      .where(and(eq(surveyResponses.accountId, ids.mogu), eq(surveyResponses.isDemo, true)))
    expect(onReal[0]!.n).toBeGreaterThan(0)

    // ...and demo accounts carry demo responses.
    const demoAccountIds = (
      await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.isDemo, true))
    ).map((a) => a.id)
    const onDemo = await db.select().from(surveyResponses).where(eq(surveyResponses.isDemo, true))
    expect(onDemo.some((r) => demoAccountIds.includes(r.accountId))).toBe(true)
  })
})

describe('seedDemo produces full flow coverage', () => {
  it('includes every CSAT band 1-5', async () => {
    await seedDemo(db, NOW)
    const scores = await db
      .select({ score: surveyResponses.score })
      .from(surveyResponses)
      .where(eq(surveyResponses.type, 'csat'))
    const present = new Set(scores.map((s) => s.score))
    for (const band of [1, 2, 3, 4, 5]) expect(present.has(band), `CSAT ${band}`).toBe(true)
  })

  it('includes NPS promoters, passives and detractors', async () => {
    await seedDemo(db, NOW)
    const scores = (
      await db
        .select({ score: surveyResponses.score })
        .from(surveyResponses)
        .where(eq(surveyResponses.type, 'nps'))
    ).map((s) => s.score)
    expect(
      scores.some((s) => s >= 9),
      'promoters',
    ).toBe(true)
    expect(
      scores.some((s) => s >= 7 && s <= 8),
      'passives',
    ).toBe(true)
    expect(
      scores.some((s) => s <= 6),
      'detractors',
    ).toBe(true)
  })

  it('leaves some DSATs pending (no RCA) and links others', async () => {
    await seedDemo(db, NOW)

    const dsats = await db
      .select({ id: surveyResponses.id })
      .from(surveyResponses)
      .where(and(eq(surveyResponses.type, 'csat'), sql`${surveyResponses.score} <= 3`))
    const linked = await db
      .select({ responseId: rcas.responseId })
      .from(rcas)
      .where(eq(rcas.subjectType, 'dsat_response'))
    const linkedIds = new Set(linked.map((r) => r.responseId))

    const pending = dsats.filter((d) => !linkedIds.has(d.id))
    expect(pending.length, 'some DSATs pending an RCA').toBeGreaterThan(0)
    expect(linkedIds.size, 'some DSATs have an RCA').toBeGreaterThan(0)
  })

  it('produces RCAs in all three error categories', async () => {
    await seedDemo(db, NOW)
    const cats = new Set(
      (await db.select({ c: rcas.errorCategory }).from(rcas)).map((r) => r.c).filter(Boolean),
    )
    expect(cats.has('people')).toBe(true)
    expect(cats.has('process')).toBe(true)
    expect(cats.has('product')).toBe(true)
  })

  it('uses both RCA methods', async () => {
    await seedDemo(db, NOW)
    const methods = new Set((await db.select({ m: rcas.method }).from(rcas)).map((r) => r.m))
    expect(methods.has('five_whys')).toBe(true)
    expect(methods.has('fishbone')).toBe(true)
  })

  it('spans every escalation severity and channel', async () => {
    await seedDemo(db, NOW)
    const rows = await db.select().from(escalations)
    const sev = new Set(rows.map((r) => r.severity))
    const chan = new Set(rows.map((r) => r.source))
    for (const s of ['low', 'medium', 'high', 'critical']) expect(sev.has(s as never)).toBe(true)
    for (const c of ['form', 'email', 'call', 'meeting']) expect(chan.has(c as never)).toBe(true)
  })

  it('includes overdue action items (past ETA, not done)', async () => {
    await seedDemo(db, NOW)
    const today = NOW.toISOString().slice(0, 10)
    const rows = await db.select().from(actionItems)
    const overdue = rows.filter((r) => r.status !== 'done' && r.eta !== null && r.eta < today)
    expect(overdue.length).toBeGreaterThan(0)
    // And a spread of statuses.
    expect(new Set(rows.map((r) => r.status)).size).toBeGreaterThanOrEqual(3)
  })
})

describe('seedDemo matches the real 6-question CSAT form', () => {
  it('seeds seven CSAT questions per survey: six scales + one text feedback', async () => {
    await seedDemo(db, NOW)

    // Take one demo CSAT survey and read its questions.
    const [csatSurvey] = await db
      .select({ id: surveys.id })
      .from(surveys)
      .where(and(eq(surveys.type, 'csat'), eq(surveys.isDemo, true)))
      .limit(1)
    expect(csatSurvey).toBeDefined()

    const questions = await db
      .select()
      .from(surveyQuestions)
      .where(eq(surveyQuestions.surveyId, csatSurvey!.id))
    expect(questions).toHaveLength(7)

    const scales = questions.filter((q) => q.kind === 'scale')
    const texts = questions.filter((q) => q.kind === 'text')
    expect(scales).toHaveLength(6)
    expect(texts).toHaveLength(1)

    // Q1 (position 0) is the overall Service/Deliverable satisfaction question.
    const q1 = questions.find((q) => q.position === 0)
    expect(q1!.prompt).toMatch(/Service\/Deliverable/i)
  })

  it('stores the headline score AND all six driver answers per CSAT response', async () => {
    await seedDemo(db, NOW)

    // Pick one CSAT response and read its answers.
    const [resp] = await db
      .select({ id: surveyResponses.id, score: surveyResponses.score })
      .from(surveyResponses)
      .where(and(eq(surveyResponses.type, 'csat'), eq(surveyResponses.isDemo, true)))
      .limit(1)
    expect(resp).toBeDefined()

    const answers = await db
      .select()
      .from(responseAnswers)
      .where(eq(responseAnswers.responseId, resp!.id))
    const scaleAnswers = answers.filter((a) => a.answerValue !== null)
    expect(scaleAnswers).toHaveLength(6)

    // The headline response.score equals the Q1 (overall) driver answer.
    const q1Answer = scaleAnswers.find((a) => a.questionLabel!.match(/Service\/Deliverable/i))
    expect(q1Answer!.answerValue).toBe(resp!.score)
  })

  it('captures written feedback text on DSAT responses', async () => {
    await seedDemo(db, NOW)

    // Every demo DSAT response should carry an open-text feedback answer.
    const dsats = await db
      .select({ id: surveyResponses.id })
      .from(surveyResponses)
      .where(
        and(
          eq(surveyResponses.type, 'csat'),
          eq(surveyResponses.isDemo, true),
          sql`${surveyResponses.score} <= 3`,
        ),
      )
    expect(dsats.length).toBeGreaterThan(0)

    const feedback = await db
      .select({ responseId: responseAnswers.responseId })
      .from(responseAnswers)
      .where(
        and(
          inArray(
            responseAnswers.responseId,
            dsats.map((d) => d.id),
          ),
          sql`${responseAnswers.answerText} is not null`,
        ),
      )
    // At least some DSATs carry written feedback.
    expect(feedback.length).toBeGreaterThan(0)
  })

  it('seeds one NPS question per NPS survey', async () => {
    await seedDemo(db, NOW)

    const [npsSurvey] = await db
      .select({ id: surveys.id })
      .from(surveys)
      .where(and(eq(surveys.type, 'nps'), eq(surveys.isDemo, true)))
      .limit(1)
    const questions = await db
      .select()
      .from(surveyQuestions)
      .where(eq(surveyQuestions.surveyId, npsSurvey!.id))
    expect(questions).toHaveLength(1)
    expect(questions[0]!.kind).toBe('scale')
  })
})

describe('purgeDemo removes every demo entity', () => {
  it('deletes all demo rows across every table', async () => {
    await seedDemo(db, NOW)
    await purgeDemo(db)

    for (const table of [surveyResponses, surveys, actionItems, rcas, escalations]) {
      const demo = await db
        .select()
        .from(table as typeof surveys)
        .where(eq((table as typeof surveys).isDemo, true))
      expect(demo, `${'name' in table ? '' : ''}no demo rows remain`).toEqual([])
    }
    expect(await db.select().from(accounts).where(eq(accounts.isDemo, true))).toEqual([])
    expect(await db.select().from(agencies).where(eq(agencies.isDemo, true))).toEqual([])

    // Questions and answers cascade away with their surveys/responses.
    expect(await db.select().from(surveyQuestions)).toEqual([])
    expect(await db.select().from(responseAnswers)).toEqual([])
  })

  it('leaves the real network, agency and accounts with zero associated rows', async () => {
    await seedDemo(db, NOW)
    await purgeDemo(db)

    // Real org rows survive.
    expect(await db.select().from(networks)).toHaveLength(1)
    const realAgencies = await db.select().from(agencies)
    expect(realAgencies).toHaveLength(1)
    expect(realAgencies[0]!.id).toBe(ids.tsl)
    const realAccounts = await db.select().from(accounts)
    expect(realAccounts.map((a) => a.slug).sort()).toEqual(['chemistry', 'mogu-mogu'])

    // ...with zero associated data rows.
    expect(await db.select().from(surveyResponses)).toEqual([])
    expect(await db.select().from(escalations)).toEqual([])
    expect(await db.select().from(rcas)).toEqual([])
    expect(await db.select().from(actionItems)).toEqual([])
  })

  it('never deletes a genuine response', async () => {
    await seedRealResponse(ids.mogu)
    await seedDemo(db, NOW)
    await purgeDemo(db)

    const real = await db.select().from(surveyResponses).where(eq(surveyResponses.isDemo, false))
    expect(real).toHaveLength(1)
  })

  it('is idempotent — a second seed does not accumulate', async () => {
    await seedDemo(db, NOW)
    const first = (await demoRowCounts(db)).demo
    await seedDemo(db, NOW)
    const second = (await demoRowCounts(db)).demo
    expect(second).toBe(first)
  })

  it('reports the surviving real accounts it must recompute', async () => {
    await seedDemo(db, NOW)
    const scope = await purgeDemo(db)
    // The two real accounts carried demo data and survive; demo accounts are gone.
    expect(scope.accountIds.sort()).toEqual([ids.chemistry, ids.mogu].sort())
  })
})
