import type { AppDb } from '@zoo/db'
import {
  accounts,
  agencies,
  auditLogs,
  memberships,
  networks,
  surveyResponses,
  surveys,
  users,
} from '@zoo/db/schema'
import type { RoleKey } from '@zoo/shared'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolveVisibleAccounts } from '../auth/scope'
import type { ApiContext, AuthenticatedSession } from '../context'
import { createTestDb } from '../testing/db'
import { testServerEnv } from '../testing/fixtures'
import { createCallerFactory } from '../trpc'
import { appRouter } from './_app'

/**
 * Escalations -> RCA -> action items, and the DSAT-triggers-RCA rule — SPEC.md
 * §4.3, §8, §5.3.
 */

const env = testServerEnv()
const NOW = new Date('2026-07-20T10:00:00.000Z')

let db: AppDb
const ids = { network: '', agency: '', otherAgency: '', mogu: '', outsider: '' }
const userIds: Record<string, string> = {}

async function callerFor(userKey: string) {
  const userId = userIds[userKey]!
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  const scope = await resolveVisibleAccounts(db, userId)

  const session: AuthenticatedSession = {
    userId,
    email: user!.email,
    name: user!.name,
    roles: scope.roles,
    visibleAccountIds: scope.visibleAccountIds,
    canViewNetwork: scope.canViewNetwork,
  }

  const ctx: ApiContext = { env, db, requestId: `test-${userKey}`, session }

  return createCallerFactory(appRouter)(ctx)
}

async function seedUser(
  key: string,
  role: RoleKey,
  scopeType: 'account' | 'agency',
  scopeId: string,
) {
  const [user] = await db
    .insert(users)
    .values({ email: `${key}@thestarterlabs.com`, name: key })
    .returning()
  userIds[key] = user!.id
  await db.insert(memberships).values({ userId: user!.id, scopeType, scopeId, role })
}

/** Inserts a response directly, returning its id. */
async function seedResponse(accountId: string, type: 'csat' | 'nps', score: number) {
  const [survey] = await db
    .insert(surveys)
    .values({ accountId, type, title: 'fixture', source: 'import', cadence: 'monthly' })
    .returning()
  const [response] = await db
    .insert(surveyResponses)
    .values({ surveyId: survey!.id, accountId, type, score, source: 'import', submittedAt: NOW })
    .returning()

  return response!.id
}

beforeAll(async () => {
  db = await createTestDb()

  const [network] = await db.insert(networks).values({ name: 'Zoo', slug: 'zoo' }).returning()
  ids.network = network!.id
  const [agency] = await db
    .insert(agencies)
    .values({ networkId: network!.id, name: 'TSL', slug: 'tsl' })
    .returning()
  const [otherAgency] = await db
    .insert(agencies)
    .values({ networkId: network!.id, name: 'Other', slug: 'other' })
    .returning()
  ids.agency = agency!.id
  ids.otherAgency = otherAgency!.id

  const [mogu] = await db
    .insert(accounts)
    .values({ agencyId: agency!.id, name: 'Mogu Mogu', slug: 'mogu-mogu' })
    .returning()
  const [outsider] = await db
    .insert(accounts)
    .values({ agencyId: otherAgency!.id, name: 'Outsider', slug: 'outsider' })
    .returning()
  ids.mogu = mogu!.id
  ids.outsider = outsider!.id

  await seedUser('manager', 'account_manager', 'account', ids.mogu)
  await seedUser('director', 'account_director', 'account', ids.mogu)
  await seedUser('member', 'team_member', 'account', ids.mogu)
  await seedUser('viewer', 'viewer', 'account', ids.mogu)
  await seedUser('agencyAdmin', 'agency_admin', 'agency', ids.agency)
}, 60_000)

describe('escalation lifecycle (§8)', () => {
  it('lets a manager create an escalation', async () => {
    const caller = await callerFor('manager')
    const created = await caller.escalations.create({
      accountId: ids.mogu,
      source: 'email',
      severity: 'high',
      title: 'Missed campaign deadline',
      reportedAt: NOW,
    })

    expect(created.status).toBe('open')
    expect(created.raisedByUserId).toBe(userIds.manager)
  })

  it('refuses a team_member and a viewer', async () => {
    const entry = {
      accountId: ids.mogu,
      source: 'email' as const,
      severity: 'low' as const,
      title: 'x',
      reportedAt: NOW,
    }
    await expect((await callerFor('member')).escalations.create(entry)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect((await callerFor('viewer')).escalations.create(entry)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('refuses an out-of-scope account', async () => {
    await expect(
      (await callerFor('manager')).escalations.create({
        accountId: ids.outsider,
        source: 'email',
        severity: 'low',
        title: 'x',
        reportedAt: NOW,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('lets a manager pick up an escalation but a director resolves it (§5.3 split)', async () => {
    const manager = await callerFor('manager')
    const created = await manager.escalations.create({
      accountId: ids.mogu,
      source: 'call',
      severity: 'medium',
      title: 'Billing dispute',
      reportedAt: NOW,
    })

    // A manager may move it to in_progress...
    await manager.escalations.updateStatus({ escalationId: created.id, status: 'in_progress' })

    // ...but not declare it resolved.
    await expect(
      manager.escalations.updateStatus({ escalationId: created.id, status: 'resolved' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // A director can.
    const director = await callerFor('director')
    const resolved = await director.escalations.updateStatus({
      escalationId: created.id,
      status: 'resolved',
    })

    expect(resolved!.status).toBe('resolved')
    expect(resolved!.resolvedAt).not.toBeNull()
  })

  it('refuses a manager closing an escalation (§5.3 split)', async () => {
    const manager = await callerFor('manager')
    const created = await manager.escalations.create({
      accountId: ids.mogu,
      source: 'meeting',
      severity: 'high',
      title: 'To be closed',
      reportedAt: NOW,
    })
    const director = await callerFor('director')
    await director.escalations.updateStatus({ escalationId: created.id, status: 'in_progress' })
    await director.escalations.updateStatus({ escalationId: created.id, status: 'resolved' })

    await expect(
      manager.escalations.updateStatus({ escalationId: created.id, status: 'closed' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const closed = await director.escalations.updateStatus({
      escalationId: created.id,
      status: 'closed',
    })
    expect(closed!.status).toBe('closed')
  })

  it('refuses to skip open straight to closed', async () => {
    // A director (who may close) still cannot skip the transition.
    const caller = await callerFor('director')
    const created = await caller.escalations.create({
      accountId: ids.mogu,
      source: 'other',
      severity: 'low',
      title: 'Minor',
      reportedAt: NOW,
    })

    await expect(
      caller.escalations.updateStatus({ escalationId: created.id, status: 'closed' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('DSAT-triggers-RCA — cannot be skipped (§8)', () => {
  it('lists a DSAT response as pending an RCA the moment it exists', async () => {
    const dsatId = await seedResponse(ids.mogu, 'csat', 2)

    const pending = await (await callerFor('manager')).rca.pending()

    expect(pending.dsatResponses.map((row) => row.id)).toContain(dsatId)
  })

  it('does not list a satisfied response', async () => {
    const happyId = await seedResponse(ids.mogu, 'csat', 5)

    const pending = await (await callerFor('manager')).rca.pending()

    expect(pending.dsatResponses.map((row) => row.id)).not.toContain(happyId)
  })

  it('never lists an NPS response, however low', async () => {
    const npsId = await seedResponse(ids.mogu, 'nps', 0)

    const pending = await (await callerFor('manager')).rca.pending()

    expect(pending.dsatResponses.map((row) => row.id)).not.toContain(npsId)
  })

  it('clears the requirement only when an RCA is linked', async () => {
    const caller = await callerFor('manager')
    const dsatId = await seedResponse(ids.mogu, 'csat', 1)

    const before = await caller.rca.pending()
    expect(before.dsatResponses.map((row) => row.id)).toContain(dsatId)

    await caller.rca.create({
      accountId: ids.mogu,
      subjectType: 'dsat_response',
      responseId: dsatId,
      method: 'five_whys',
      problemStatement: 'Client felt ignored on a launch day.',
    })

    const after = await caller.rca.pending()
    expect(after.dsatResponses.map((row) => row.id)).not.toContain(dsatId)
  })

  it('lists an escalation as pending until its RCA exists', async () => {
    const caller = await callerFor('manager')
    const escalation = await caller.escalations.create({
      accountId: ids.mogu,
      source: 'meeting',
      severity: 'critical',
      title: 'Lost the account trust',
      reportedAt: NOW,
    })

    expect((await caller.rca.pending()).escalations.map((row) => row.id)).toContain(escalation.id)

    await caller.rca.create({
      accountId: ids.mogu,
      subjectType: 'escalation',
      escalationId: escalation.id,
      method: 'fishbone',
      problemStatement: 'Repeated missed deadlines eroded trust.',
    })

    expect((await caller.rca.pending()).escalations.map((row) => row.id)).not.toContain(
      escalation.id,
    )
  })

  it('scopes the pending set — an out-of-scope account never appears', async () => {
    await seedResponse(ids.outsider, 'csat', 1)

    const pending = await (await callerFor('manager')).rca.pending()

    expect(pending.dsatResponses.every((row) => row.accountId === ids.mogu)).toBe(true)
  })

  it('surfaces a DSAT entered through the real manual-entry procedure', async () => {
    // The end-to-end write path: recording a DSAT via responses.createManual —
    // the same call the UI makes — immediately makes it pending an RCA. There
    // is no step at which the requirement could be omitted.
    const caller = await callerFor('manager')
    const { response } = await caller.responses.createManual({
      accountId: ids.mogu,
      type: 'csat',
      score: 1,
      submittedAt: NOW,
    })

    const pending = await caller.rca.pending()
    expect(pending.dsatResponses.map((row) => row.id)).toContain(response.id)
  })
})

describe('RCA authoring (§8)', () => {
  it('refuses to attach an RCA to a satisfied response', async () => {
    // The rule is one-directional: an RCA belongs only to a DSAT. Allowing one
    // on a happy response would let the pending list be gamed.
    const happyId = await seedResponse(ids.mogu, 'csat', 5)

    await expect(
      (await callerFor('manager')).rca.create({
        accountId: ids.mogu,
        subjectType: 'dsat_response',
        responseId: happyId,
        method: 'five_whys',
        problemStatement: 'x',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects an RCA whose subject id belongs to another account', async () => {
    const outsiderDsat = await seedResponse(ids.outsider, 'csat', 2)

    await expect(
      (await callerFor('manager')).rca.create({
        accountId: ids.mogu,
        subjectType: 'dsat_response',
        responseId: outsiderDsat,
        method: 'five_whys',
        problemStatement: 'x',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('refuses a team_member from authoring an RCA (§5.3)', async () => {
    const dsatId = await seedResponse(ids.mogu, 'csat', 3)

    await expect(
      (await callerFor('member')).rca.create({
        accountId: ids.mogu,
        subjectType: 'dsat_response',
        responseId: dsatId,
        method: 'five_whys',
        problemStatement: 'x',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('stores a 5 Whys chain and fishbone causes, and returns them', async () => {
    const caller = await callerFor('manager')
    const escalation = await caller.escalations.create({
      accountId: ids.mogu,
      source: 'form',
      severity: 'high',
      title: 'Quality slipped',
      reportedAt: NOW,
    })
    const rca = await caller.rca.create({
      accountId: ids.mogu,
      subjectType: 'escalation',
      escalationId: escalation.id,
      method: 'five_whys',
      problemStatement: 'Quality slipped across three deliverables.',
    })

    await caller.rca.setWhys({
      rcaId: rca.id,
      whys: [
        { level: 1, question: 'Why did quality slip?', answer: 'Reviews were skipped.' },
        { level: 2, question: 'Why were reviews skipped?', answer: 'No time was allocated.' },
      ],
    })
    await caller.rca.setCauses({
      rcaId: rca.id,
      causes: [{ bucket: 'process', cause: 'No review gate in the workflow' }],
    })

    const loaded = await caller.rca.get({ rcaId: rca.id })
    expect(loaded.whys).toHaveLength(2)
    expect(loaded.whys[0]!.level).toBe(1)
    expect(loaded.causes).toHaveLength(1)
  })

  it('sets the error category as a human decision (§11)', async () => {
    const caller = await callerFor('manager')
    const dsatId = await seedResponse(ids.mogu, 'csat', 2)
    const rca = await caller.rca.create({
      accountId: ids.mogu,
      subjectType: 'dsat_response',
      responseId: dsatId,
      method: 'five_whys',
      problemStatement: 'Client unhappy with turnaround.',
    })

    const updated = await caller.rca.setErrorCategory({ rcaId: rca.id, errorCategory: 'process' })

    expect(updated!.errorCategory).toBe('process')
  })
})

describe('action items (§8, §5.3)', () => {
  it('creates an action linked to an RCA and records the source', async () => {
    const caller = await callerFor('manager')
    const dsatId = await seedResponse(ids.mogu, 'csat', 1)
    const rca = await caller.rca.create({
      accountId: ids.mogu,
      subjectType: 'dsat_response',
      responseId: dsatId,
      method: 'five_whys',
      problemStatement: 'Slow response.',
    })

    const action = await caller.actions.create({
      accountId: ids.mogu,
      title: 'Introduce a 24h response SLA',
      rcaId: rca.id,
      ownerUserId: userIds.manager,
      eta: '2026-08-15',
    })

    expect(action.sourceType).toBe('rca')
    expect(action.rcaId).toBe(rca.id)
  })

  it('lets a team_member update an action they own', async () => {
    const manager = await callerFor('manager')
    const owned = await manager.actions.create({
      accountId: ids.mogu,
      title: 'Members task',
      ownerUserId: userIds.member,
    })

    const member = await callerFor('member')
    const updated = await member.actions.update({ actionId: owned.id, status: 'in_progress' })

    expect(updated!.status).toBe('in_progress')
  })

  it("refuses a team_member updating someone else's action (§5.3)", async () => {
    const manager = await callerFor('manager')
    const notOwned = await manager.actions.create({
      accountId: ids.mogu,
      title: 'Managers task',
      ownerUserId: userIds.manager,
    })

    await expect(
      (await callerFor('member')).actions.update({ actionId: notOwned.id, status: 'done' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it("lets a director close someone else's action (§5.3)", async () => {
    const manager = await callerFor('manager')
    const task = await manager.actions.create({
      accountId: ids.mogu,
      title: 'Cross-owned task',
      ownerUserId: userIds.manager,
    })

    const director = await callerFor('director')
    const closed = await director.actions.update({ actionId: task.id, status: 'done' })

    expect(closed!.status).toBe('done')
    expect(closed!.closedAt).not.toBeNull()
  })

  it('surfaces overdue actions and excludes done ones (§6)', async () => {
    const caller = await callerFor('manager')
    await caller.actions.create({
      accountId: ids.mogu,
      title: 'Overdue task',
      ownerUserId: userIds.manager,
      eta: '2020-01-01',
    })
    const doneOverdue = await caller.actions.create({
      accountId: ids.mogu,
      title: 'Old but done',
      ownerUserId: userIds.manager,
      eta: '2020-01-01',
    })
    await caller.actions.update({ actionId: doneOverdue.id, status: 'done' })

    const overdue = await caller.actions.overdue()

    expect(overdue.some((row) => row.title === 'Overdue task')).toBe(true)
    expect(overdue.some((row) => row.title === 'Old but done')).toBe(false)
  })

  it('refuses a viewer from creating an action', async () => {
    await expect(
      (await callerFor('viewer')).actions.create({ accountId: ids.mogu, title: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('error-category breakdown for View 2 (§6, §9)', () => {
  it('shares out RCAs by people / process / product, ignoring uncategorised', async () => {
    const caller = await callerFor('manager')
    const wide = { grain: 'monthly' as const, from: '2020-01-01', to: '2030-12-31' }

    // Author three RCAs and categorise two of them.
    const makeRca = async (score: number) => {
      const dsatId = await seedResponse(ids.mogu, 'csat', score)
      return caller.rca.create({
        accountId: ids.mogu,
        subjectType: 'dsat_response',
        responseId: dsatId,
        method: 'five_whys',
        problemStatement: 'p',
      })
    }
    const a = await makeRca(1)
    const b = await makeRca(2)
    await makeRca(3) // left uncategorised

    await caller.rca.setErrorCategory({ rcaId: a.id, errorCategory: 'process' })
    await caller.rca.setErrorCategory({ rcaId: b.id, errorCategory: 'process' })

    const breakdown = await (
      await callerFor('agencyAdmin')
    ).metrics.getErrorCategoryBreakdown({ scopeType: 'agency', scopeId: ids.agency, ...wide })

    // Only the two categorised RCAs count toward the denominator.
    expect(breakdown.process.count).toBeGreaterThanOrEqual(2)
    expect(breakdown.total).toBe(
      breakdown.people.count + breakdown.process.count + breakdown.product.count,
    )
  })

  it('is scoped — refuses a sibling agency the caller cannot see', async () => {
    // The manager sees only Mogu Mogu; the "Other" agency holds Outsider, so
    // an aggregate over it must be refused.
    const caller = await callerFor('manager')

    await expect(
      caller.metrics.getErrorCategoryBreakdown({
        scopeType: 'agency',
        scopeId: ids.otherAgency,
        grain: 'monthly',
        from: '2026-01-01',
        to: '2026-12-31',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('RCA tracker for View 2 (§9)', () => {
  it('returns account name, subject, category and linked-action count', async () => {
    const caller = await callerFor('manager')
    const escalation = await caller.escalations.create({
      accountId: ids.mogu,
      source: 'form',
      severity: 'high',
      title: 'Tracked',
      reportedAt: NOW,
    })
    const rca = await caller.rca.create({
      accountId: ids.mogu,
      subjectType: 'escalation',
      escalationId: escalation.id,
      method: 'fishbone',
      problemStatement: 'p',
    })
    await caller.rca.setErrorCategory({ rcaId: rca.id, errorCategory: 'people' })
    await caller.actions.create({ accountId: ids.mogu, title: 'Fix it', rcaId: rca.id })

    const tracker = await caller.rca.tracker()
    const row = tracker.find((entry) => entry.id === rca.id)

    expect(row?.accountName).toBe('Mogu Mogu')
    expect(row?.subjectType).toBe('escalation')
    expect(row?.errorCategory).toBe('people')
    expect(Number(row?.linkedActions)).toBe(1)
  })

  it('includes an RCA with no linked actions, counted as 0', async () => {
    const caller = await callerFor('manager')
    const dsatId = await seedResponse(ids.mogu, 'csat', 2)
    const rca = await caller.rca.create({
      accountId: ids.mogu,
      subjectType: 'dsat_response',
      responseId: dsatId,
      method: 'five_whys',
      problemStatement: 'p',
    })

    const row = (await caller.rca.tracker()).find((entry) => entry.id === rca.id)
    expect(Number(row?.linkedActions)).toBe(0)
  })

  it('is scoped to visible accounts', async () => {
    // Author an RCA on the outsider account (via a caller who can see it).
    const outsiderResp = await seedResponse(ids.outsider, 'csat', 1)
    void outsiderResp

    const tracker = await (await callerFor('manager')).rca.tracker()

    expect(tracker.every((row) => row.accountId === ids.mogu)).toBe(true)
  })
})

describe('audit trail (§12)', () => {
  it('writes an audit entry for an escalation and an RCA', async () => {
    const caller = await callerFor('manager')
    const escalation = await caller.escalations.create({
      accountId: ids.mogu,
      source: 'email',
      severity: 'low',
      title: 'Audited escalation',
      reportedAt: NOW,
    })

    const entries = await db.select().from(auditLogs).where(eq(auditLogs.entityId, escalation.id))

    expect(entries.some((row) => row.action === 'escalation.create')).toBe(true)
    expect(entries[0]!.actorUserId).toBe(userIds.manager)
  })
})
