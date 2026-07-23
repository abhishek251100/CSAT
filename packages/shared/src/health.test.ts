import { describe, expect, it } from 'vitest'
import { pingInputSchema, pingOutputSchema } from './health'

describe('pingInputSchema', () => {
  it('accepts a well-formed name', () => {
    const result = pingInputSchema.safeParse({ name: 'Zoo Media' })
    expect(result.success).toBe(true)
  })

  it('rejects an empty name', () => {
    expect(pingInputSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('rejects a name past the 64-char bound', () => {
    expect(pingInputSchema.safeParse({ name: 'x'.repeat(65) }).success).toBe(false)
  })

  it('rejects a missing name rather than defaulting it', () => {
    expect(pingInputSchema.safeParse({}).success).toBe(false)
  })
})

describe('pingOutputSchema', () => {
  it('accepts an ISO-8601 UTC timestamp', () => {
    const result = pingOutputSchema.safeParse({
      message: 'hello',
      receivedAt: '2026-07-20T10:30:00.000Z',
      apiVersion: '0.0.0',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-ISO timestamp', () => {
    const result = pingOutputSchema.safeParse({
      message: 'hello',
      receivedAt: '20 July 2026',
      apiVersion: '0.0.0',
    })
    expect(result.success).toBe(false)
  })
})
