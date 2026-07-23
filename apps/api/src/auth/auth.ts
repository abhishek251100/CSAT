import type { AppDb } from '@zoo/db'
import { authAccounts, authSessions, authVerifications, users } from '@zoo/db/schema'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { ServerEnv } from '../env'
import { describeAllowedDomains, isSignInAllowed, type SignInPolicy } from './domain-policy'
import { resolveGoogleConfig } from './google-config'

/**
 * better-auth configuration — SPEC.md §5, §16 #4.
 *
 * Sign-in paths, and only these two:
 *   1. Google SSO, restricted to the ALLOWED_EMAIL_DOMAINS allowlist.
 *   2. One break-glass super_admin on email and password, for when SSO breaks.
 *
 * The consent screen is External, so Google authenticates any account that
 * reaches it — personal gmail.com included — and hands back a verified
 * identity. Nothing upstream filters by organisation, so the two gates below
 * are the entire domain wall.
 *
 * There is no open registration. `disableSignUp` closes the credential path to
 * everyone, and the break-glass user is created by the seed rather than by a
 * public endpoint. Google sign-in does create a user row on first visit, but
 * only for an address on the allowed domain — and a user with no membership
 * still sees nothing (§5.2 is closed by default). Admission is not authority.
 */
export function createAuth(db: AppDb, env: ServerEnv, trustedOrigins: readonly string[]) {
  const policy: SignInPolicy = {
    allowedDomains: new Set(env.ALLOWED_EMAIL_DOMAINS),
    breakGlassEmail: env.SUPERADMIN_EMAIL,
  }

  const allowedList = describeAllowedDomains(policy)
  const google = resolveGoogleConfig(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET)

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    // Must match the CORS allowlist, loopback expansion included, or better-auth
    // rejects the very requests CORS just permitted.
    trustedOrigins: [...trustedOrigins],

    database: drizzleAdapter(db, {
      provider: 'pg',
      /**
       * Explicit model-to-table mapping. better-auth calls its credential model
       * `account`, which would collide with the `accounts` table in §4.3 — a
       * completely different concept (a client brand).
       */
      schema: {
        users,
        auth_sessions: authSessions,
        auth_accounts: authAccounts,
        auth_verifications: authVerifications,
      },
    }),

    /**
     * Map better-auth's `user` model onto the existing §4.3 users table rather
     * than letting it create a second identity table.
     */
    user: {
      modelName: 'users',
      fields: {
        // better-auth calls it `image`; §4.3 calls it avatar_url.
        image: 'avatarUrl',
      },
    },
    session: { modelName: 'auth_sessions' },
    account: { modelName: 'auth_accounts' },
    verification: { modelName: 'auth_verifications' },

    advanced: {
      database: {
        /**
         * better-auth's default ids are not UUIDs, and every id column in this
         * schema is `uuid` (§4.1). uuidv7 keeps them time-ordered like the rest.
         */
        generateId: () => uuidv7(),
      },
    },

    emailAndPassword: {
      enabled: true,
      /**
       * The credential path exists solely for the seeded break-glass admin.
       * Closing sign-up means no one can create an account through it, even if
       * the endpoint is reachable.
       */
      disableSignUp: true,
    },

    /**
     * Registered only when the credentials are usable. With a broken config the
     * provider is absent entirely, so better-auth rejects the attempt cleanly
     * instead of bouncing the user to a Google error page — and, crucially, the
     * rest of the server including break-glass carries on working.
     */
    socialProviders: google.enabled
      ? { google: { clientId: google.clientId, clientSecret: google.clientSecret } }
      : {},

    databaseHooks: {
      user: {
        create: {
          /**
           * Gate 1 — account creation. Stops an identity on a domain outside
           * the allowlist from ever getting a row.
           *
           * This fires for Google sign-ins because the consent screen is
           * External: Google will happily authenticate a personal gmail.com
           * account and hand back a verified identity. Nothing upstream filters
           * by organisation.
           */
          before: async (user) => {
            if (!isSignInAllowed(user.email, policy)) {
              throw new APIError('FORBIDDEN', {
                message: `Sign-in is restricted to ${allowedList} accounts.`,
              })
            }

            return { data: user }
          },
        },
      },
      session: {
        create: {
          /**
           * Gate 2 — session creation, which every sign-in passes through
           * including returning users and the credential path.
           *
           * Gate 1 alone is not enough: it only fires on first sign-in, so a
           * user created before the domain was restricted, or one deactivated
           * afterwards, would keep getting sessions. Checking here means access
           * is re-evaluated on every sign-in rather than once, ever.
           */
          before: async (session) => {
            const [account] = await db
              .select({ email: users.email, isActive: users.isActive })
              .from(users)
              .where(eq(users.id, session.userId))
              .limit(1)

            if (!account) {
              throw new APIError('UNAUTHORIZED', { message: 'User not found.' })
            }

            if (!account.isActive) {
              throw new APIError('FORBIDDEN', { message: 'This account has been deactivated.' })
            }

            if (!isSignInAllowed(account.email, policy)) {
              throw new APIError('FORBIDDEN', {
                message: `Sign-in is restricted to ${allowedList} accounts.`,
              })
            }

            return { data: session }
          },
          /** Record the sign-in for the audit trail (§12). */
          after: async (session) => {
            await db
              .update(users)
              .set({ lastLoginAt: new Date() })
              .where(eq(users.id, session.userId))
          },
        },
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
