import { describe, expect, it } from 'vitest'
import {
  canTransitionAction,
  canTransitionEscalation,
  createActionInputSchema,
  createEscalationInputSchema,
  createRcaInputSchema,
  isDsatScore,
  rcaWhysInputSchema,
  requiresRca,
} from './workflow'

describe('isDsatScore — the DSAT-triggers-RCA trigger (§1, §8)', () => {
  it('is true for CSAT 1, 2 and 3', () => {
    expect(isDsatScore('csat', 1)).toBe(true)
    expect(isDsatScore('csat', 2)).toBe(true)
    expect(isDsatScore('csat', 3)).toBe(true)
  })

  it('is false for CSAT 4 and 5', () => {
    expect(isDsatScore('csat', 4)).toBe(false)
    expect(isDsatScore('csat', 5)).toBe(false)
  })

  it('is never true for an NPS response, however low', () => {
    // A low NPS score is a detractor, not a DSAT — conflating them would demand
    // an RCA for every detractor, which the spec does not.
    expect(isDsatScore('nps', 0)).toBe(false)
    expect(isDsatScore('nps', 3)).toBe(false)
  })
})

describe('requiresRca (§8: "RCA required for all escalations and CSAT 1,2,3")', () => {
  it('flags a DSAT response as needing an RCA when none is linked', () => {
    expect(requiresRca({ kind: 'dsat_response', type: 'csat', score: 2, hasRca: false })).toBe(true)
  })

  it('is satisfied once an RCA is linked', () => {
    // The requirement is derived from data, so authoring the RCA is the only
    // way to clear it — there is no dismissible flag.
    expect(requiresRca({ kind: 'dsat_response', type: 'csat', score: 2, hasRca: true })).toBe(false)
  })

  it('does not flag a satisfied CSAT response', () => {
    expect(requiresRca({ kind: 'dsat_response', type: 'csat', score: 5, hasRca: false })).toBe(
      false,
    )
  })

  it('does not flag an NPS response', () => {
    expect(requiresRca({ kind: 'dsat_response', type: 'nps', score: 0, hasRca: false })).toBe(false)
  })

  it('flags every escalation without an RCA, regardless of score', () => {
    expect(requiresRca({ kind: 'escalation', hasRca: false })).toBe(true)
    expect(requiresRca({ kind: 'escalation', hasRca: true })).toBe(false)
  })
})

describe('canTransitionEscalation (§4.2 escalation_status)', () => {
  it('walks forward open -> in_progress -> resolved -> closed', () => {
    expect(canTransitionEscalation('open', 'in_progress')).toBe(true)
    expect(canTransitionEscalation('in_progress', 'resolved')).toBe(true)
    expect(canTransitionEscalation('resolved', 'closed')).toBe(true)
  })

  it('allows reopening a resolved escalation that turned out unfixed', () => {
    expect(canTransitionEscalation('resolved', 'in_progress')).toBe(true)
  })

  it('refuses to skip straight from open to closed', () => {
    // Closing without resolving would hide an unresolved escalation.
    expect(canTransitionEscalation('open', 'closed')).toBe(false)
  })

  it('refuses to move out of the terminal closed state', () => {
    expect(canTransitionEscalation('closed', 'open')).toBe(false)
    expect(canTransitionEscalation('closed', 'in_progress')).toBe(false)
  })

  it('treats a no-op transition as allowed', () => {
    expect(canTransitionEscalation('open', 'open')).toBe(true)
  })
})

describe('canTransitionAction (§4.2 action_status)', () => {
  it('allows the working states to move between each other', () => {
    expect(canTransitionAction('open', 'in_progress')).toBe(true)
    expect(canTransitionAction('in_progress', 'blocked')).toBe(true)
    expect(canTransitionAction('blocked', 'in_progress')).toBe(true)
    expect(canTransitionAction('in_progress', 'done')).toBe(true)
  })

  it('allows reopening a done action', () => {
    // Corrective actions sometimes prove insufficient and must reopen.
    expect(canTransitionAction('done', 'in_progress')).toBe(true)
  })

  it('does not allow blocking an already-done action', () => {
    expect(canTransitionAction('done', 'blocked')).toBe(false)
  })
})

describe('createEscalationInputSchema', () => {
  const valid = {
    accountId: '019f0000-0000-7000-8000-000000000001',
    source: 'email' as const,
    severity: 'high' as const,
    title: 'Missed campaign deadline',
    reportedAt: new Date('2026-07-20T10:00:00.000Z'),
  }

  it('accepts a well-formed escalation', () => {
    expect(createEscalationInputSchema.safeParse(valid).success).toBe(true)
  })

  it('requires a non-empty title', () => {
    expect(createEscalationInputSchema.safeParse({ ...valid, title: '' }).success).toBe(false)
  })

  it('rejects a future reportedAt', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    expect(createEscalationInputSchema.safeParse({ ...valid, reportedAt: future }).success).toBe(
      false,
    )
  })

  it('rejects an unknown severity', () => {
    expect(
      createEscalationInputSchema.safeParse({ ...valid, severity: 'catastrophic' }).success,
    ).toBe(false)
  })
})

describe('createRcaInputSchema — one-of subject (§4.3)', () => {
  const base = {
    accountId: '019f0000-0000-7000-8000-000000000001',
    method: 'five_whys' as const,
    problemStatement: 'Deadline missed because of unclear ownership',
  }

  it('accepts an escalation subject with only an escalation id', () => {
    const result = createRcaInputSchema.safeParse({
      ...base,
      subjectType: 'escalation',
      escalationId: '019f0000-0000-7000-8000-0000000000aa',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a dsat_response subject with only a response id', () => {
    const result = createRcaInputSchema.safeParse({
      ...base,
      subjectType: 'dsat_response',
      responseId: '019f0000-0000-7000-8000-0000000000bb',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an escalation subject that also carries a response id', () => {
    // Mirrors the Postgres one-of CHECK so the API rejects before the DB does.
    const result = createRcaInputSchema.safeParse({
      ...base,
      subjectType: 'escalation',
      escalationId: '019f0000-0000-7000-8000-0000000000aa',
      responseId: '019f0000-0000-7000-8000-0000000000bb',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a subject with no id at all', () => {
    expect(createRcaInputSchema.safeParse({ ...base, subjectType: 'escalation' }).success).toBe(
      false,
    )
  })

  it('rejects a subject_type that disagrees with the id provided', () => {
    const result = createRcaInputSchema.safeParse({
      ...base,
      subjectType: 'escalation',
      responseId: '019f0000-0000-7000-8000-0000000000bb',
    })
    expect(result.success).toBe(false)
  })
})

describe('rcaWhysInputSchema', () => {
  it('accepts an ordered chain of whys', () => {
    const result = rcaWhysInputSchema.safeParse({
      rcaId: '019f0000-0000-7000-8000-0000000000cc',
      whys: [
        { level: 1, question: 'Why was the deadline missed?', answer: 'The brief arrived late.' },
        { level: 2, question: 'Why did the brief arrive late?', answer: 'No owner was assigned.' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a chain longer than five', () => {
    const whys = Array.from({ length: 6 }, (_, index) => ({
      level: index + 1,
      question: 'Why?',
      answer: 'Because.',
    }))
    const rcaId = '019f0000-0000-7000-8000-0000000000cc'
    expect(rcaWhysInputSchema.safeParse({ rcaId, whys }).success).toBe(false)
  })
})

describe('createActionInputSchema', () => {
  const valid = {
    accountId: '019f0000-0000-7000-8000-000000000001',
    title: 'Assign a single owner per campaign',
  }

  it('accepts a minimal action', () => {
    expect(createActionInputSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts an ISO eta date', () => {
    expect(createActionInputSchema.safeParse({ ...valid, eta: '2026-08-15' }).success).toBe(true)
  })

  it('rejects a non-ISO eta', () => {
    expect(createActionInputSchema.safeParse({ ...valid, eta: '15/08/2026' }).success).toBe(false)
  })

  it('requires a title', () => {
    expect(createActionInputSchema.safeParse({ ...valid, title: '' }).success).toBe(false)
  })
})
