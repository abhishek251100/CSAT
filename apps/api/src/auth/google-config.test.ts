import { describe, expect, it } from 'vitest'
import { resolveGoogleConfig } from './google-config'

/**
 * The governing rule: a broken Google configuration must never take down the
 * API, because break-glass sign-in is what you reach for when Google is broken.
 */
const VALID_ID = '514707741417-a1b2c3d4e5f6g7h8i9j0.apps.googleusercontent.com'

describe('resolveGoogleConfig — enabled', () => {
  it('accepts a full client id and secret', () => {
    const config = resolveGoogleConfig(VALID_ID, 'GOCSPX-secret')

    expect(config).toEqual({ enabled: true, clientId: VALID_ID, clientSecret: 'GOCSPX-secret' })
  })

  it('trims surrounding whitespace, which .env files collect', () => {
    const config = resolveGoogleConfig(`  ${VALID_ID}  `, '  GOCSPX-secret  ')

    expect(config).toMatchObject({ enabled: true, clientId: VALID_ID })
  })
})

describe('resolveGoogleConfig — disabled rather than fatal', () => {
  it('reports a bare project number instead of accepting it', () => {
    // Google answers this with "401 invalid_client" on a redirect page, which
    // says nothing about .env — so name it precisely here.
    const config = resolveGoogleConfig('514707741417', 'GOCSPX-secret')

    expect(config.enabled).toBe(false)
    expect(config.enabled === false && config.problem).toMatch(/not an OAuth client id/)
    expect(config.enabled === false && config.problem).toMatch(/514707741417/)
  })

  it('reports missing credentials', () => {
    expect(resolveGoogleConfig(undefined, undefined)).toMatchObject({ enabled: false })
    expect(resolveGoogleConfig('', '')).toMatchObject({ enabled: false })
  })

  it('distinguishes a missing id from a missing secret', () => {
    const noId = resolveGoogleConfig('', 'GOCSPX-secret')
    const noSecret = resolveGoogleConfig(VALID_ID, '')

    expect(noId.enabled === false && noId.problem).toMatch(/GOOGLE_CLIENT_ID/)
    expect(noSecret.enabled === false && noSecret.problem).toMatch(/GOOGLE_CLIENT_SECRET/)
  })

  it('never throws, whatever it is handed', () => {
    // Throwing here would propagate into boot and defeat the whole point.
    for (const value of ['', ' ', 'nonsense', 'http://x', '@'] as const) {
      expect(() => resolveGoogleConfig(value, value)).not.toThrow()
    }
  })

  it('rejects a client id with the right suffix in the wrong place', () => {
    const config = resolveGoogleConfig('.apps.googleusercontent.com.evil.net', 'secret')

    expect(config.enabled).toBe(false)
  })
})
