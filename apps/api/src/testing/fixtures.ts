import { parseServerEnv, type ServerEnv } from '../env'

/**
 * Shared test fixtures for apps/api.
 *
 * Not test code itself, so it lives outside a .test.ts file and is typechecked
 * and linted with the rest of the source. Nothing here is imported by runtime
 * code paths.
 */

/** A complete, valid server env. Override individual keys per test. */
export function testServerEnv(overrides: Record<string, string> = {}): ServerEnv {
  return parseServerEnv({
    DATABASE_URL: 'postgresql://user:pw@ep-test.us-east-2.aws.neon.tech/zoo_cx?sslmode=require',
    BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
    GOOGLE_CLIENT_ID: '000000000000-test0client0id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    ALLOWED_EMAIL_DOMAINS: 'thestarterlabs.com,zoomedia.com',
    // Deliberately off-list, so the break-glass exemption is exercised rather
    // than incidentally satisfied by the allowlist.
    SUPERADMIN_EMAIL: 'breakglass@offlist.example',
    SUPERADMIN_PASSWORD: 'break-glass-password',
    ...overrides,
  })
}
