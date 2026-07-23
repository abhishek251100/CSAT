import { pingOutputSchema } from '@zoo/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ApiContext } from '../context'
import { createTestDb } from '../testing/db'
import { testServerEnv } from '../testing/fixtures'
import { createCallerFactory } from '../trpc'
import { appRouter } from './_app'

/**
 * health.ping touches no data, but the context type requires a real database
 * handle. Supplying one rather than casting keeps the context honest — if a
 * future procedure starts reading, this test does not silently pass on a stub.
 */
const makeCaller = (ctx: ApiContext) => createCallerFactory(appRouter)(ctx)

let caller: ReturnType<typeof makeCaller>

beforeAll(async () => {
  caller = makeCaller({
    env: testServerEnv(),
    db: await createTestDb(),
    requestId: 'test-request',
    session: null,
  })
}, 60_000)

describe('health.ping', () => {
  it('echoes the supplied name', async () => {
    const result = await caller.health.ping({ name: 'Zoo Media' })

    expect(result.message).toContain('Zoo Media')
    expect(result.apiVersion).toBe('0.0.0')
  })

  it('returns a payload satisfying the shared output schema', async () => {
    const result = await caller.health.ping({ name: 'TSL' })

    expect(pingOutputSchema.safeParse(result).success).toBe(true)
  })

  it('rejects input that violates the shared input schema', async () => {
    await expect(caller.health.ping({ name: '' })).rejects.toThrow()
  })
})
