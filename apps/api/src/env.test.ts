import { describe, expect, it } from 'vitest'
import { parseServerEnv } from './env'

/** The minimum set that must be present for the API to boot. */
const validEnv = {
  DATABASE_URL: 'postgresql://user:pw@ep-example.us-east-2.aws.neon.tech/zoo_cx?sslmode=require',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  ALLOWED_EMAIL_DOMAINS: 'thestarterlabs.com,zoomedia.com',
  SUPERADMIN_EMAIL: 'breakglass@offlist.example',
  SUPERADMIN_PASSWORD: 'a-long-enough-password',
}

describe('parseServerEnv', () => {
  it('applies documented defaults when optional vars are absent', () => {
    const env = parseServerEnv(validEnv)

    expect(env.NODE_ENV).toBe('development')
    expect(env.PORT).toBe(8787)
    expect(env.WEB_ORIGIN).toEqual(['http://localhost:5173'])
  })

  it('parses WEB_ORIGIN as a list, so multiple front ends can be allowed', () => {
    const env = parseServerEnv({
      ...validEnv,
      WEB_ORIGIN: 'http://localhost:5173, https://cx.zoomedia.com/',
    })

    expect(env.WEB_ORIGIN).toEqual(['http://localhost:5173', 'https://cx.zoomedia.com'])
  })

  it('rejects a WEB_ORIGIN entry that is not a bare origin', () => {
    expect(() => parseServerEnv({ ...validEnv, WEB_ORIGIN: 'localhost:5173' })).toThrow(
      /WEB_ORIGIN/,
    )
    expect(() => parseServerEnv({ ...validEnv, WEB_ORIGIN: 'http://localhost:5173/app' })).toThrow(
      /WEB_ORIGIN/,
    )
  })

  it('coerces PORT from a string, as every real env source supplies it', () => {
    const env = parseServerEnv({ ...validEnv, PORT: '3000' })

    expect(env.PORT).toBe(3000)
    expect(typeof env.PORT).toBe('number')
  })

  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL/)
  })

  it('rejects a DATABASE_URL that is not a postgres connection string', () => {
    expect(() => parseServerEnv({ DATABASE_URL: 'mysql://localhost/zoo' })).toThrow(
      /postgres:\/\/ or postgresql:\/\//,
    )
  })

  it('rejects an out-of-range PORT', () => {
    expect(() => parseServerEnv({ ...validEnv, PORT: '99999' })).toThrow(/PORT/)
  })

  it('rejects an unknown NODE_ENV rather than passing it through', () => {
    expect(() => parseServerEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/)
  })

  it('rejects a malformed WEB_ORIGIN', () => {
    expect(() => parseServerEnv({ ...validEnv, WEB_ORIGIN: 'not-a-url' })).toThrow(/WEB_ORIGIN/)
  })

  it('reports every invalid var at once, not just the first', () => {
    let message = ''
    try {
      parseServerEnv({ ...validEnv, DATABASE_URL: 'mysql://x', PORT: '0', WEB_ORIGIN: 'nope' })
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toMatch(/DATABASE_URL/)
    expect(message).toMatch(/PORT/)
    expect(message).toMatch(/WEB_ORIGIN/)
  })
})

describe('parseServerEnv — auth configuration (§5, §16 #4)', () => {
  it('defaults BETTER_AUTH_URL to the local API origin', () => {
    expect(parseServerEnv(validEnv).BETTER_AUTH_URL).toBe('http://localhost:8787')
  })

  it('rejects a short BETTER_AUTH_SECRET', () => {
    // A weak signing secret undermines every other control in §12.
    expect(() => parseServerEnv({ ...validEnv, BETTER_AUTH_SECRET: 'too-short' })).toThrow(
      /BETTER_AUTH_SECRET/,
    )
  })

  /**
   * Google credentials are the one deliberate exception to fail-fast.
   *
   * Break-glass sign-in exists for when Google is unavailable. If a malformed
   * client id refused the boot, a broken SSO config would also destroy the only
   * way back in — so it disables the Google button and nothing else. See
   * auth/google-config.test.ts for the validation itself.
   */
  it('still boots when the Google credentials are missing', () => {
    expect(() =>
      parseServerEnv({ ...validEnv, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }),
    ).not.toThrow()
  })

  it('still boots when GOOGLE_CLIENT_ID is a bare project number', () => {
    // Google answers this with "401 invalid_client"; the API must survive it so
    // an admin can sign in and fix the configuration.
    expect(() => parseServerEnv({ ...validEnv, GOOGLE_CLIENT_ID: '514707741417' })).not.toThrow()
  })

  it('passes the Google values through untouched for the resolver to judge', () => {
    const env = parseServerEnv({
      ...validEnv,
      GOOGLE_CLIENT_ID: '514707741417-a1b2c3d4e5f6g7h8i9j0.apps.googleusercontent.com',
    })

    expect(env.GOOGLE_CLIENT_ID).toBe(
      '514707741417-a1b2c3d4e5f6g7h8i9j0.apps.googleusercontent.com',
    )
  })

  it('still fails fast on things with no working degraded mode', () => {
    // The contrast that makes the Google exception deliberate rather than lax.
    expect(() => parseServerEnv({ ...validEnv, DATABASE_URL: '' })).toThrow(/DATABASE_URL/)
    expect(() => parseServerEnv({ ...validEnv, BETTER_AUTH_SECRET: 'short' })).toThrow(
      /BETTER_AUTH_SECRET/,
    )
    expect(() => parseServerEnv({ ...validEnv, ALLOWED_EMAIL_DOMAINS: '' })).toThrow(
      /ALLOWED_EMAIL_DOMAINS/,
    )
  })

  it('parses ALLOWED_EMAIL_DOMAINS into a normalised list', () => {
    const env = parseServerEnv({
      ...validEnv,
      ALLOWED_EMAIL_DOMAINS: ' TheStarterLabs.COM , zoomedia.com ,',
    })

    expect(env.ALLOWED_EMAIL_DOMAINS).toEqual(['thestarterlabs.com', 'zoomedia.com'])
  })

  it('refuses to boot on an empty allowlist', () => {
    // An empty list would admit nobody; failing at boot beats a silent lockout.
    expect(() => parseServerEnv({ ...validEnv, ALLOWED_EMAIL_DOMAINS: '' })).toThrow(
      /ALLOWED_EMAIL_DOMAINS/,
    )
    expect(() => parseServerEnv({ ...validEnv, ALLOWED_EMAIL_DOMAINS: ' , ,' })).toThrow(
      /ALLOWED_EMAIL_DOMAINS/,
    )
  })

  it('refuses to boot on a malformed allowlist entry', () => {
    // The consent screen is External, so a mis-parsed list means the whole wall
    // has failed. Easy to get wrong in a .env.
    for (const bad of ['@tsl.com', 'https://tsl.com/', 'localhost', '*.tsl.com', 'tsl.com.']) {
      expect(() => parseServerEnv({ ...validEnv, ALLOWED_EMAIL_DOMAINS: bad })).toThrow(
        /ALLOWED_EMAIL_DOMAINS/,
      )
    }
  })

  it('refuses the whole list when any single entry is malformed', () => {
    expect(() =>
      parseServerEnv({
        ...validEnv,
        ALLOWED_EMAIL_DOMAINS: 'thestarterlabs.com,@bad,zoomedia.com',
      }),
    ).toThrow(/ALLOWED_EMAIL_DOMAINS/)
  })

  it('lowercases SUPERADMIN_EMAIL to match the break-glass comparison', () => {
    const env = parseServerEnv({ ...validEnv, SUPERADMIN_EMAIL: 'BreakGlass@Zoo.example' })

    expect(env.SUPERADMIN_EMAIL).toBe('breakglass@zoo.example')
  })

  it('rejects a weak SUPERADMIN_PASSWORD', () => {
    expect(() => parseServerEnv({ ...validEnv, SUPERADMIN_PASSWORD: 'short' })).toThrow(
      /SUPERADMIN_PASSWORD/,
    )
  })
})
