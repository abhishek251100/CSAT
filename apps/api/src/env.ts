import { z } from 'zod'
import { parseDomainList } from './auth/domain-policy'
import { parseOriginList } from './auth/origins'

/**
 * Server env contract (SPEC.md §12: "Secrets in env, validated at boot").
 *
 * `parseServerEnv` takes its source as an argument instead of reaching for
 * `process.env` directly. That is what keeps the API host-portable: the Node
 * entry passes `process.env`, and a Workers entry would pass its bindings
 * object, with no change to this file or to anything downstream of it.
 * (Section 16 #6 is still open — see README.)
 */
/**
 * The minimum a database-only process needs.
 *
 * Split out so background jobs validate only what they use. The rollup cron
 * touches no auth, and failing it because Google SSO is misconfigured means an
 * unrelated outage takes the metrics pipeline down with it.
 */
export const databaseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Neon Postgres. Validated for shape; connectivity is proven by using it. */
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    ),
})

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>

/**
 * The full contract for the API server, which serves auth and therefore needs
 * every variable.
 */
export const serverEnvSchema = databaseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),

  /**
   * Browser origins permitted to call this API (CORS + better-auth trusted
   * origins). Comma-separated; a single value is the common case.
   *
   * Outside production the loopback spellings (localhost, 127.0.0.1, [::1]) are
   * treated as equivalent, because Vite advertises more than one and opening
   * the wrong one yields a bare "Failed to fetch" against a healthy server.
   */
  WEB_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((value, ctx) => {
      try {
        return parseOriginList(value)
      } catch (error) {
        ctx.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message : 'Invalid WEB_ORIGIN',
        })

        return z.NEVER
      }
    }),

  // ---- auth (SPEC.md §5, §16 #4) ---------------------------------------

  /**
   * Signs session cookies. Rotating it invalidates every session.
   * 32 chars minimum — better-auth warns below that, and a weak secret here
   * undermines every other control in §12.
   */
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),

  /**
   * Public origin of *this API*, used to build the OAuth callback URL. It must
   * match the redirect URI registered in Google Cloud Console exactly.
   */
  BETTER_AUTH_URL: z.url().default('http://localhost:8787'),

  /**
   * Google OAuth credentials — optional at boot, on purpose.
   *
   * These are NOT validated here, unlike everything else in this schema. A
   * malformed or missing Google config disables the Google button and nothing
   * else (see auth/google-config.ts): the API still starts and break-glass
   * sign-in still works, which is the whole point of having a break-glass
   * account. Failing the boot would let a broken SSO config destroy the only
   * way back in.
   *
   * `resolveGoogleConfig` does the shape checking and reports the problem at
   * boot, on the API root banner, and to anyone who clicks the button.
   */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  /**
   * Comma-separated allowlist of email domains permitted to sign in via Google.
   * Bare domains, no scheme or '@' — 'thestarterlabs.com,zoomedia.com'.
   *
   * The Google consent screen is External, so any Google account can complete
   * the OAuth handshake. This list is the only thing that turns them away,
   * which is why it is parsed strictly and fails the boot rather than being
   * quietly coerced.
   *
   * There is no open registration: a matching domain gets an account, but an
   * account with no membership still sees nothing (§5.2, closed by default).
   */
  ALLOWED_EMAIL_DOMAINS: z.string().transform((value, ctx) => {
    try {
      return parseDomainList(value)
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid ALLOWED_EMAIL_DOMAINS',
      })

      return z.NEVER
    }
  }),

  /**
   * Break-glass super_admin, signing in with email and password rather than
   * Google — the way back in when SSO itself is broken. Deliberately exempt
   * from the domain restriction, since it may well be off-domain.
   */
  SUPERADMIN_EMAIL: z.email().transform((value) => value.toLowerCase()),
  SUPERADMIN_PASSWORD: z.string().min(12, 'SUPERADMIN_PASSWORD must be at least 12 characters'),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

function parseWith<T>(
  schema: { safeParse: (input: unknown) => { success: boolean; data?: T; error?: z.ZodError } },
  source: Record<string, string | undefined>,
  label: string,
): T {
  const result = schema.safeParse(source)

  if (!result.success || !result.data) {
    const details = (result.error?.issues ?? [])
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')

    throw new Error(
      `Invalid ${label}. Fix these and restart:\n${details}\n\n` +
        'Copy .env.example to .env at the repo root if you have not already.',
    )
  }

  return result.data
}

/**
 * Parses and validates the full server environment, throwing rather than
 * starting a half-configured process.
 */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  return parseWith<ServerEnv>(serverEnvSchema, source, 'server environment')
}

/**
 * Validates only the database configuration — for CLIs and cron jobs.
 *
 * Deliberately narrower than `parseServerEnv`: a job that only reads and writes
 * Postgres should not refuse to run because an OAuth client id is wrong.
 */
export function parseDatabaseEnv(source: Record<string, string | undefined>): DatabaseEnv {
  return parseWith<DatabaseEnv>(databaseEnvSchema, source, 'database environment')
}
