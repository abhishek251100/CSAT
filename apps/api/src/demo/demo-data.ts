import type { AppDb } from '@zoo/db'
import {
  accounts,
  actionItems,
  agencies,
  escalations,
  metricRollups,
  networks,
  rcas,
  responseAnswers,
  surveyQuestions,
  surveyResponses,
  surveys,
  users,
} from '@zoo/db/schema'
import {
  isDsatScore,
  monthlyPeriodFor,
  quarterlyPeriodFor,
  type ErrorCategory,
  type EscalationSource,
  type Period,
  type RcaMethod,
  type Severity,
} from '@zoo/shared'
import { and, eq, inArray, isNull } from 'drizzle-orm'

/**
 * Rich, purgeable demo dataset — exercises the ENTIRE flow across a two-agency
 * structure so account / agency / network rollups are genuinely distinguishable.
 *
 * What it adds, ALL marked `is_demo` and removed by `purgeDemo`:
 *   - ONE second agency ("Demo Agency") under the real network, with a handful
 *     of demo accounts.
 *   - Demo responses (CSAT monthly, NPS quarterly) on those demo accounts AND on
 *     a subset of the REAL TSL accounts, so both agencies carry data and pool to
 *     different network numbers.
 *   - Escalations across both agencies (every severity, channel and status).
 *   - RCAs from both DSATs and escalations, all three error categories, both
 *     methods. Some DSATs are left WITHOUT an RCA so `rca.pending` lights up.
 *   - Action items from RCAs, with owners and ETAs, every status, some overdue.
 *
 * What it never touches: the real network, the real TSL agency, and the 16 real
 * account rows. `purgeDemo` leaves those with zero associated rows.
 *
 * Everything is deterministic (no RNG) so a re-seed reproduces the same
 * dashboards. Escalation `raised_by` and action `owner` use the break-glass
 * admin (the one guaranteed user); no demo users are created.
 */

export interface DemoScope {
  /** Every account (real + demo) whose rollups the caller must recompute. */
  readonly accountIds: string[]
  readonly periods: Period[]
}

const MONTHS_BACK = 6 // ~6 months of monthly CSAT

/**
 * Account health profiles, chosen so the leaderboard has real spread and every
 * CSAT band and NPS band appears somewhere.
 */
type Profile = 'healthy' | 'struggling' | 'middling'

interface DemoAccountPlan {
  readonly name: string
  readonly slug: string
  readonly profile: Profile
}

/** The second agency's own accounts. */
const DEMO_ACCOUNTS: readonly DemoAccountPlan[] = [
  { name: 'Aurora Foods', slug: 'demo-aurora-foods', profile: 'healthy' },
  { name: 'Borealis Bank', slug: 'demo-borealis-bank', profile: 'struggling' },
  { name: 'Cirrus Tech', slug: 'demo-cirrus-tech', profile: 'middling' },
  { name: 'Delta Retail', slug: 'demo-delta-retail', profile: 'healthy' },
  { name: 'Everest Media', slug: 'demo-everest-media', profile: 'struggling' },
]

/** Real TSL accounts (by slug) that also receive demo data, with a profile. */
const REAL_ACCOUNT_PROFILES: ReadonlyArray<{ slug: string; profile: Profile }> = [
  { slug: 'mogu-mogu', profile: 'healthy' },
  { slug: 'chemistry', profile: 'middling' },
  { slug: 'inkspired', profile: 'healthy' },
  { slug: 'soa', profile: 'middling' },
  { slug: 'the-croffle-guys', profile: 'healthy' },
  { slug: 'anemos', profile: 'healthy' },
  { slug: 'whiteoak', profile: 'healthy' },
  { slug: 'buildwell', profile: 'middling' },
]

/** Foxy agency brands — deliberately more DSAT so network vs agency differs. */
const FOXY_ACCOUNT_PROFILES: ReadonlyArray<{ slug: string; profile: Profile }> = [
  { slug: 'foxy-retail-co', profile: 'struggling' },
  { slug: 'foxy-hospitality', profile: 'struggling' },
  { slug: 'foxy-fintech', profile: 'middling' },
  { slug: 'foxy-health', profile: 'struggling' },
]

/**
 * The real CSAT form's questions (the shared sheet). Q1 is the overall
 * satisfaction question and, by decision, IS the headline CSAT score; Q2-Q6 are
 * diagnostic drivers stored alongside in response_answers. The seventh is the
 * open-text critical-feedback field.
 */
const CSAT_QUESTIONS: readonly string[] = [
  'How satisfied were you with the Service/Deliverable you received this quarter?',
  'How satisfied were you with the quality of the work delivered?',
  'How satisfied were you with the frequency and clarity of updates from your Account Manager?',
  'How satisfied were you with the timeliness of delivery against agreed timelines?',
  'How easy was it to get your requests actioned or issues resolved this quarter?',
  'How satisfied were you with how proactively the team brought ideas, flagged risks, or spotted opportunities?',
]
const CSAT_FEEDBACK_QUESTION =
  'Add any critical feedback you have for us, and let us know how we can improve the service for you.'

/** The single NPS question (a separate instrument from the CSAT form). */
const NPS_QUESTION = 'How likely are you to recommend us to a colleague or peer?'

/** Realistic written feedback, keyed to whichever driver (Q2-Q6) scored lowest. */
const DRIVER_FEEDBACK: readonly string[] = [
  '', // Q1 overall — no driver-specific comment
  'A few deliverables needed rework before we could use them; quality was inconsistent.',
  "We'd like more frequent and clearer updates from our account manager.",
  'Some deliverables slipped past the agreed timelines this quarter.',
  'It took too long to get a couple of our requests actioned.',
  "We'd love the team to flag risks and bring proactive ideas more often.",
]
const POSITIVE_FEEDBACK =
  'Strong quarter overall — responsive team and dependable delivery. Keep it up.'

const SEVERITIES: readonly Severity[] = ['low', 'medium', 'high', 'critical']
const CHANNELS: readonly EscalationSource[] = ['form', 'email', 'call', 'meeting']
const CATEGORIES: readonly ErrorCategory[] = ['people', 'process', 'product']
const METHODS: readonly RcaMethod[] = ['five_whys', 'fishbone']

// --------------------------------------------------------------- score shaping

/** A deterministic CSAT score (1-5) for a profile, varied by two indices. */
function csatScore(profile: Profile, i: number, n: number): number {
  const pattern: Record<Profile, number[]> = {
    // Mostly 4-5, occasional 3.
    healthy: [5, 4, 5, 4, 5, 3, 5, 4],
    // Frequent 1-3, some 4.
    struggling: [1, 3, 2, 4, 1, 2, 3, 1],
    // A genuine spread across all bands.
    middling: [3, 4, 2, 5, 3, 1, 4, 5],
  }
  const seq = pattern[profile]
  return seq[(i + n) % seq.length]!
}

/** A deterministic NPS score (0-10) for a profile. */
function npsScoreValue(profile: Profile, i: number, n: number): number {
  const pattern: Record<Profile, number[]> = {
    healthy: [10, 9, 8, 10, 9, 7], // positive: promoters + a passive
    struggling: [0, 3, 6, 2, 5, 4], // negative: detractors
    middling: [9, 7, 6, 8, 10, 3], // spans all three bands
  }
  const seq = pattern[profile]
  return seq[(i + n) % seq.length]!
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Six 1-5 answers for one CSAT response. answers[0] is the overall (Q1) — the
 * headline score — and Q2-Q6 vary coherently around it, so the drivers read as
 * a plausible breakdown of the same experience rather than random noise.
 */
function driverAnswers(headline: number, seed: number): number[] {
  const offsets = [0, -1, 1, -1, 0, 1] // Q1 fixed at headline; the rest nudge
  return offsets.map((base, k) =>
    k === 0 ? headline : clamp(headline + base + ((seed + k) % 3) - 1, 1, 5),
  )
}

// ------------------------------------------------------------------ seed

export async function seedDemo(db: AppDb, now: Date): Promise<DemoScope> {
  // Capture what the pre-seed purge touched, so the caller recomputes those
  // accounts/periods too — otherwise an account that had demo data last time
  // but not this time keeps a stale rollup computed from now-deleted responses.
  const purged = await purgeDemo(db)

  const [network] = await db.select({ id: networks.id }).from(networks).limit(1)
  if (!network) {
    throw new Error('No network found. Run the org seed first: pnpm --filter @zoo/db db:seed')
  }

  // A stable actor for raised_by / owner. Prefer the break-glass admin; fall
  // back to any user so the seed still works before the admin is seeded.
  const [admin] = await db.select({ id: users.id }).from(users).limit(1)
  const actorId = admin?.id ?? null

  // The second agency and its accounts (all demo).
  const [demoAgency] = await db
    .insert(agencies)
    .values({ networkId: network.id, name: 'Demo Agency', slug: 'demo-agency', isDemo: true })
    .returning({ id: agencies.id })
  if (!demoAgency) throw new Error('Failed to create the demo agency')

  const demoAccountRows = await db
    .insert(accounts)
    .values(
      DEMO_ACCOUNTS.map((plan) => ({
        agencyId: demoAgency.id,
        name: plan.name,
        slug: plan.slug,
        isDemo: true,
      })),
    )
    .returning({ id: accounts.id, slug: accounts.slug })

  // Selected real TSL + Foxy accounts that also receive demo data.
  const realAccountRows = await db
    .select({ id: accounts.id, slug: accounts.slug })
    .from(accounts)
    .where(
      and(
        eq(accounts.isDemo, false),
        isNull(accounts.deletedAt),
        inArray(
          accounts.slug,
          [...REAL_ACCOUNT_PROFILES, ...FOXY_ACCOUNT_PROFILES].map((r) => r.slug),
        ),
      ),
    )

  const profileOf = new Map<string, Profile>([
    ...DEMO_ACCOUNTS.map((p) => [p.slug, p.profile] as const),
    ...REAL_ACCOUNT_PROFILES.map((p) => [p.slug, p.profile] as const),
    ...FOXY_ACCOUNT_PROFILES.map((p) => [p.slug, p.profile] as const),
  ])

  const targets = [...demoAccountRows, ...realAccountRows].map((row) => ({
    id: row.id,
    profile: profileOf.get(row.slug) ?? 'middling',
  }))

  const touchedPeriods = new Map<string, Period>()
  const rememberPeriod = (when: Date) => {
    for (const period of [monthlyPeriodFor(when), quarterlyPeriodFor(when)]) {
      touchedPeriods.set(`${period.grain}:${period.start}`, period)
    }
  }

  // Track the responses we can attach RCAs to (some DSATs stay pending).
  const dsatResponses: { id: string; accountId: string; index: number }[] = []
  // Accumulate response_answers and batch-insert them, to keep round trips down.
  const answerRows: (typeof responseAnswers.$inferInsert)[] = []

  for (const [accountIndex, target] of targets.entries()) {
    const csat = await createCsatSurvey(db, target.id)
    const npsSurvey = await createNpsSurvey(db, target.id)

    // ~6 months of monthly CSAT, each a full 6-question form + optional feedback.
    for (let monthsAgo = MONTHS_BACK - 1; monthsAgo >= 0; monthsAgo -= 1) {
      const when = monthOffset(now, -monthsAgo)
      rememberPeriod(when)
      const count = 6 + ((accountIndex + monthsAgo) % 4)
      for (let n = 0; n < count; n += 1) {
        const overall = csatScore(target.profile, accountIndex + monthsAgo, n)
        const answers = driverAnswers(overall, accountIndex + monthsAgo + n)

        const [row] = await db
          .insert(surveyResponses)
          .values({
            surveyId: csat.surveyId,
            accountId: target.id,
            type: 'csat',
            score: overall, // headline = Q1 (overall), by decision
            source: 'import',
            submittedAt: when,
            isDemo: true,
          })
          .returning({ id: surveyResponses.id })
        if (!row) continue

        // Store all six ratings against their questions.
        for (let q = 0; q < CSAT_QUESTIONS.length; q += 1) {
          answerRows.push({
            responseId: row.id,
            questionId: csat.questionIds[q]!,
            questionLabel: CSAT_QUESTIONS[q]!,
            answerValue: answers[q]!,
          })
        }

        // Written feedback: always on a DSAT (people comment when unhappy),
        // occasionally on a happy one. Keyed to the lowest driver.
        const isDsat = isDsatScore('csat', overall)
        if (isDsat || (accountIndex + monthsAgo + n) % 4 === 0) {
          const lowestDriver = answers.indexOf(Math.min(...answers))
          answerRows.push({
            responseId: row.id,
            questionId: csat.feedbackQuestionId,
            questionLabel: CSAT_FEEDBACK_QUESTION,
            answerText: isDsat
              ? DRIVER_FEEDBACK[lowestDriver] || POSITIVE_FEEDBACK
              : POSITIVE_FEEDBACK,
          })
        }

        if (isDsat) dsatResponses.push({ id: row.id, accountId: target.id, index: accountIndex })
      }
    }

    // ~2 quarters of NPS (a separate single-question instrument).
    for (const quartersAgo of [1, 0]) {
      const when = quarterOffset(now, -quartersAgo)
      rememberPeriod(when)
      for (let n = 0; n < 5; n += 1) {
        const score = npsScoreValue(target.profile, accountIndex + quartersAgo, n)
        const [row] = await db
          .insert(surveyResponses)
          .values({
            surveyId: npsSurvey.surveyId,
            accountId: target.id,
            type: 'nps',
            score,
            source: 'import',
            submittedAt: when,
            isDemo: true,
          })
          .returning({ id: surveyResponses.id })
        if (row) {
          answerRows.push({
            responseId: row.id,
            questionId: npsSurvey.questionId,
            questionLabel: NPS_QUESTION,
            answerValue: score,
          })
        }
      }
    }
  }

  // Batch-insert all answers in chunks (keeps well under parameter limits).
  for (let i = 0; i < answerRows.length; i += 200) {
    await db.insert(responseAnswers).values(answerRows.slice(i, i + 200))
  }

  // Escalations across both agencies: every severity, channel and a status mix.
  const statuses = ['open', 'in_progress', 'resolved', 'closed'] as const
  const escalationRows: { id: string; accountId: string; index: number }[] = []
  for (const [i, target] of targets.entries()) {
    // 1-2 escalations per account, cycling the enums so all values appear.
    const howMany = (i % 2) + 1
    for (let k = 0; k < howMany; k += 1) {
      const status = statuses[(i + k) % statuses.length]!
      const [row] = await db
        .insert(escalations)
        .values({
          accountId: target.id,
          raisedByUserId: actorId,
          source: CHANNELS[(i + k) % CHANNELS.length]!,
          severity: SEVERITIES[(i + k) % SEVERITIES.length]!,
          title: `Demo escalation ${i + 1}.${k + 1}`,
          description: 'Synthetic demo escalation for the actionables view.',
          status,
          resolvedAt: status === 'resolved' || status === 'closed' ? monthOffset(now, 0) : null,
          reportedAt: monthOffset(now, 0),
          isDemo: true,
        })
        .returning({ id: escalations.id })
      if (row) escalationRows.push({ id: row.id, accountId: target.id, index: i })
    }
  }

  // RCAs: from escalations and from DSATs, cycling all three categories and both
  // methods. Leave roughly half the DSATs WITHOUT an RCA (pending state).
  const rcaRows: { id: string; accountId: string }[] = []
  for (const [i, esc] of escalationRows.entries()) {
    const [row] = await db
      .insert(rcas)
      .values({
        accountId: esc.accountId,
        subjectType: 'escalation',
        escalationId: esc.id,
        method: METHODS[i % METHODS.length]!,
        errorCategory: CATEGORIES[i % CATEGORIES.length]!,
        problemStatement: 'Demo root-cause analysis from an escalation.',
        createdByUserId: actorId,
        status: 'open',
        isDemo: true,
      })
      .returning({ id: rcas.id })
    if (row) rcaRows.push({ id: row.id, accountId: esc.accountId })
  }
  /**
   * Attach an RCA to just the FIRST DSAT of each account, so the tracker stays
   * readable while every account with DSATs shows both a completed RCA and — for
   * its remaining DSATs — the pending state. (Linking every DSAT would produce
   * hundreds of RCAs, since struggling accounts have many low scores.)
   */
  const firstDsatSeen = new Set<string>()
  let dsatRcaIndex = 0
  for (const dsat of dsatResponses) {
    if (firstDsatSeen.has(dsat.accountId)) continue
    firstDsatSeen.add(dsat.accountId)

    const [row] = await db
      .insert(rcas)
      .values({
        accountId: dsat.accountId,
        subjectType: 'dsat_response',
        responseId: dsat.id,
        method: METHODS[dsatRcaIndex % METHODS.length]!,
        errorCategory: CATEGORIES[(dsatRcaIndex + 1) % CATEGORIES.length]!,
        problemStatement: 'Demo root-cause analysis from a DSAT response.',
        createdByUserId: actorId,
        status: 'open',
        isDemo: true,
      })
      .returning({ id: rcas.id })
    if (row) rcaRows.push({ id: row.id, accountId: dsat.accountId })
    dsatRcaIndex += 1
  }

  // Action items from RCAs: every status, owners + ETAs, some overdue.
  const actionStatuses = ['open', 'in_progress', 'blocked', 'done'] as const
  const priorities = ['low', 'medium', 'high', 'urgent'] as const
  for (const [i, rca] of rcaRows.entries()) {
    const status = actionStatuses[i % actionStatuses.length]!
    // Every third item is overdue (ETA in the past, and not done).
    const overdue = i % 3 === 0 && status !== 'done'
    const eta = overdue ? isoDate(monthOffset(now, -2)) : isoDate(monthOffset(now, 2))
    await db.insert(actionItems).values({
      accountId: rca.accountId,
      rcaId: rca.id,
      sourceType: 'rca',
      title: `Demo corrective action ${i + 1}`,
      description: 'Synthetic demo action item.',
      ownerUserId: actorId,
      eta,
      priority: priorities[i % priorities.length]!,
      status,
      closedAt: status === 'done' ? monthOffset(now, 0) : null,
      isDemo: true,
    })
  }

  // Merge the pre-seed purge scope so accounts it cleared but this seed does not
  // re-populate are recomputed to null rather than left stale.
  for (const period of purged.periods) touchedPeriods.set(`${period.grain}:${period.start}`, period)

  return {
    accountIds: [...new Set([...targets.map((t) => t.id), ...purged.accountIds])],
    periods: [...touchedPeriods.values()],
  }
}

// ------------------------------------------------------------------ purge

export async function purgeDemo(db: AppDb): Promise<DemoScope> {
  // Gather the scope to recompute (real accounts that had demo data) BEFORE
  // deleting, and the demo scope ids to drop their orphaned rollups.
  const demoResponses = await db
    .select({ accountId: surveyResponses.accountId, submittedAt: surveyResponses.submittedAt })
    .from(surveyResponses)
    .where(eq(surveyResponses.isDemo, true))

  const demoAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.isDemo, true))
  const demoAgencyRows = await db
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.isDemo, true))

  const demoAccountIds = new Set(demoAccounts.map((r) => r.id))
  const touchedPeriods = new Map<string, Period>()
  for (const row of demoResponses) {
    for (const period of [monthlyPeriodFor(row.submittedAt), quarterlyPeriodFor(row.submittedAt)]) {
      touchedPeriods.set(`${period.grain}:${period.start}`, period)
    }
  }
  // Accounts to recompute = those that carried demo data but SURVIVE the purge
  // (the real TSL accounts). Demo accounts are deleted, so they are excluded.
  const survivingAffected = [
    ...new Set(demoResponses.map((r) => r.accountId).filter((id) => !demoAccountIds.has(id))),
  ]

  /**
   * Delete in FK-safe order. rcas reference escalations/responses with SET NULL,
   * but the rcas one-of CHECK would fail if a subject were nulled — so rcas go
   * before escalations and responses. Everything references accounts with
   * RESTRICT, so account rows go last, and demo agencies after their accounts.
   */
  await db.delete(actionItems).where(eq(actionItems.isDemo, true))
  await db.delete(rcas).where(eq(rcas.isDemo, true))
  await db.delete(escalations).where(eq(escalations.isDemo, true))
  await db.delete(surveyResponses).where(eq(surveyResponses.isDemo, true))
  await db.delete(surveys).where(eq(surveys.isDemo, true))
  await db.delete(accounts).where(eq(accounts.isDemo, true))
  await db.delete(agencies).where(eq(agencies.isDemo, true))

  // Drop orphaned rollups for the deleted demo scopes (accounts + agencies).
  const orphanScopeIds = [...demoAccountIds, ...demoAgencyRows.map((r) => r.id)]
  if (orphanScopeIds.length > 0) {
    await db.delete(metricRollups).where(inArray(metricRollups.scopeId, orphanScopeIds))
  }

  return { accountIds: survivingAffected, periods: [...touchedPeriods.values()] }
}

// ------------------------------------------------------------------ helpers

/**
 * Creates the CSAT survey and its seven questions (six scale drivers + one
 * open-text feedback field), matching the real form. Returns the ids so the
 * response loop can attach answers to the right questions.
 */
async function createCsatSurvey(
  db: AppDb,
  accountId: string,
): Promise<{ surveyId: string; questionIds: string[]; feedbackQuestionId: string }> {
  const [survey] = await db
    .insert(surveys)
    .values({
      accountId,
      type: 'csat',
      title: '[DEMO] Quarterly CSAT',
      source: 'import',
      cadence: 'monthly',
      isDemo: true,
    })
    .returning({ id: surveys.id })
  if (!survey) throw new Error('Failed to create demo CSAT survey')

  const questionRows = await db
    .insert(surveyQuestions)
    .values([
      ...CSAT_QUESTIONS.map((prompt, position) => ({
        surveyId: survey.id,
        prompt,
        kind: 'scale' as const,
        position,
        isRequired: true,
      })),
      {
        surveyId: survey.id,
        prompt: CSAT_FEEDBACK_QUESTION,
        kind: 'text' as const,
        position: CSAT_QUESTIONS.length,
        isRequired: false,
      },
    ])
    .returning({ id: surveyQuestions.id, position: surveyQuestions.position })

  const byPosition = new Map(questionRows.map((q) => [q.position, q.id]))
  return {
    surveyId: survey.id,
    questionIds: CSAT_QUESTIONS.map((_, position) => byPosition.get(position)!),
    feedbackQuestionId: byPosition.get(CSAT_QUESTIONS.length)!,
  }
}

/** Creates the NPS survey and its single question. */
async function createNpsSurvey(
  db: AppDb,
  accountId: string,
): Promise<{ surveyId: string; questionId: string }> {
  const [survey] = await db
    .insert(surveys)
    .values({
      accountId,
      type: 'nps',
      title: '[DEMO] Quarterly NPS',
      source: 'import',
      cadence: 'quarterly',
      isDemo: true,
    })
    .returning({ id: surveys.id })
  if (!survey) throw new Error('Failed to create demo NPS survey')

  const [question] = await db
    .insert(surveyQuestions)
    .values({
      surveyId: survey.id,
      prompt: NPS_QUESTION,
      kind: 'scale',
      position: 0,
      isRequired: true,
    })
    .returning({ id: surveyQuestions.id })
  if (!question) throw new Error('Failed to create demo NPS question')

  return { surveyId: survey.id, questionId: question.id }
}

function monthOffset(now: Date, delta: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + delta, 12, 10, 0, 0))
}

function quarterOffset(now: Date, deltaQuarters: number): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + deltaQuarters * 3, 12, 10, 0, 0),
  )
}

function isoDate(when: Date): string {
  return when.toISOString().slice(0, 10)
}

/** Demo vs real response counts — for the CLI summary and tests. */
export async function demoRowCounts(db: AppDb): Promise<{ demo: number; real: number }> {
  const demo = await db
    .select({ id: surveyResponses.id })
    .from(surveyResponses)
    .where(eq(surveyResponses.isDemo, true))
  const real = await db
    .select({ id: surveyResponses.id })
    .from(surveyResponses)
    .where(and(eq(surveyResponses.isDemo, false), isNull(surveyResponses.deletedAt)))

  return { demo: demo.length, real: real.length }
}

/** Live real accounts a demo purge leaves untouched — for the CLI summary. */
export async function realAccountCount(db: AppDb): Promise<number> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.isDemo, false), isNull(accounts.deletedAt)))

  return rows.length
}

export interface DemoSummary {
  readonly perEntity: {
    demoAgencies: number
    demoAccounts: number
    surveys: number
    questions: number
    responses: number
    answers: number
    escalations: number
    rcas: number
    actionItems: number
  }
  readonly perAgency: { name: string; isDemo: boolean; accounts: number; responses: number }[]
}

/** Per-entity and per-agency counts of the current demo data — for the CLI. */
export async function demoSummary(db: AppDb): Promise<DemoSummary> {
  const countOf = async (rows: Promise<{ id: string }[]>) => (await rows).length

  const agencyRows = await db
    .select({ id: agencies.id, name: agencies.name, isDemo: agencies.isDemo })
    .from(agencies)

  const perAgency = []
  for (const agency of agencyRows) {
    const accountIds = (
      await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.agencyId, agency.id), isNull(accounts.deletedAt)))
    ).map((a) => a.id)

    const responses =
      accountIds.length === 0
        ? 0
        : (
            await db
              .select({ id: surveyResponses.id })
              .from(surveyResponses)
              .where(
                and(
                  inArray(surveyResponses.accountId, accountIds),
                  eq(surveyResponses.isDemo, true),
                ),
              )
          ).length

    perAgency.push({
      name: agency.name,
      isDemo: agency.isDemo,
      accounts: accountIds.length,
      responses,
    })
  }

  return {
    perEntity: {
      demoAgencies: await countOf(
        db.select({ id: agencies.id }).from(agencies).where(eq(agencies.isDemo, true)),
      ),
      demoAccounts: await countOf(
        db.select({ id: accounts.id }).from(accounts).where(eq(accounts.isDemo, true)),
      ),
      surveys: await countOf(
        db.select({ id: surveys.id }).from(surveys).where(eq(surveys.isDemo, true)),
      ),
      // Questions and answers cascade from demo surveys/responses, so counting
      // via the demo surveys/responses gives the demo total.
      questions: await countOf(
        db
          .select({ id: surveyQuestions.id })
          .from(surveyQuestions)
          .innerJoin(surveys, eq(surveyQuestions.surveyId, surveys.id))
          .where(eq(surveys.isDemo, true)),
      ),
      responses: await countOf(
        db
          .select({ id: surveyResponses.id })
          .from(surveyResponses)
          .where(eq(surveyResponses.isDemo, true)),
      ),
      answers: await countOf(
        db
          .select({ id: responseAnswers.id })
          .from(responseAnswers)
          .innerJoin(surveyResponses, eq(responseAnswers.responseId, surveyResponses.id))
          .where(eq(surveyResponses.isDemo, true)),
      ),
      escalations: await countOf(
        db.select({ id: escalations.id }).from(escalations).where(eq(escalations.isDemo, true)),
      ),
      rcas: await countOf(db.select({ id: rcas.id }).from(rcas).where(eq(rcas.isDemo, true))),
      actionItems: await countOf(
        db.select({ id: actionItems.id }).from(actionItems).where(eq(actionItems.isDemo, true)),
      ),
    },
    perAgency,
  }
}
