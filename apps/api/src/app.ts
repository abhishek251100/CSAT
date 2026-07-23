import { trpcServer } from '@hono/trpc-server'
import { createDb, type AppDb } from '@zoo/db'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { createAuth } from './auth/auth'
import { expandLoopbackOrigins } from './auth/origins'
import { resolveGoogleConfig } from './auth/google-config'
import { resolveVisibleAccounts } from './auth/scope'
import type { ApiContext, AuthenticatedSession } from './context'
import type { ServerEnv } from './env'
import { appRouter } from './routers/_app'

/**
 * Builds the Hono application.
 *
 * A factory over validated env rather than a module-level singleton, which is
 * what makes the API host-portable (§16 #6 remains open): the Node entry calls
 * it with `process.env`, and a Vercel or Workers entry would call it with their
 * own env source. No global state, no import-time side effects, and directly
 * testable. `db` is injectable so tests can supply an in-process Postgres.
 */
export function createApp(env: ServerEnv, db: AppDb = createDb(env.DATABASE_URL)) {
  const app = new Hono()

  /**
   * Outside production, localhost / 127.0.0.1 / [::1] are accepted
   * interchangeably. They are the same machine but different CORS origins, and
   * Vite advertises more than one — opening the spelling that was not
   * configured produces a bare "Failed to fetch" with a healthy API behind it.
   * Production takes the configured list verbatim.
   */
  const allowedOrigins =
    env.NODE_ENV === 'production' ? env.WEB_ORIGIN : expandLoopbackOrigins(env.WEB_ORIGIN)

  const auth = createAuth(db, env, allowedOrigins)

  app.use('*', logger())

  app.use(
    '*',
    cors({
      origin: allowedOrigins,
      // Required: better-auth carries the session in a cookie, so the browser
      // must be allowed to send it cross-origin.
      credentials: true,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }),
  )

  /** Plain HTTP liveness probe for load balancers, which do not speak tRPC. */
  app.get('/api/health', (c) => c.json({ status: 'ok' }))

  /**
   * Temporary diagnostic: proves whether THIS process can actually reach the
   * database, with a short timeout so a bad DATABASE_URL fails fast instead of
   * hanging the whole function. Unauthenticated but harmless (SELECT 1, no data).
   */
  app.get('/api/db-check', async (c) => {
    const started = Date.now()
    try {
      await Promise.race([
        db.execute(sql`select 1 as ok`),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('DB query timed out after 8s')), 8000),
        ),
      ])
      return c.json({ ok: true, ms: Date.now() - started })
    } catch (error) {
      return c.json(
        {
          ok: false,
          ms: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      )
    }
  })

  /**
   * The whole HTTP surface lives under /api so a single-domain host (Vercel)
   * can route every server call to one catch-all function and hand everything
   * else to the static SPA. `GET /api` is the "is it up?" banner the sign-in
   * page probes; a bare 404 there would read as "not running".
   */
  app.get('/api', (c) => {
    const google = resolveGoogleConfig(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET)

    return c.json({
      service: 'zoo-cx-api',
      status: 'ok',
      endpoints: { health: '/api/health', auth: '/api/auth', trpc: '/api/trpc' },
      allowedOrigins,
      /**
       * Status only. This route is unauthenticated, so it reports *whether*
       * Google sign-in works, never why — the diagnostic detail (including the
       * offending value) stays in the boot log where only an operator sees it.
       * The sign-in page uses this to avoid offering a button that cannot work.
       */
      signIn: {
        google: google.enabled ? 'enabled' : 'disabled',
        breakGlass: 'enabled',
      },
    })
  })

  /**
   * better-auth owns everything under /api/auth: the Google redirect, the OAuth
   * callback, session lookup and sign-out. The Google redirect URI to register
   * is `${BETTER_AUTH_URL}/api/auth/callback/google`.
   */
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  app.use(
    '/api/trpc/*',
    trpcServer({
      router: appRouter,
      endpoint: '/api/trpc',
      createContext: async (_opts, c): Promise<ApiContext> => {
        const requestId = c.req.header('x-request-id') ?? crypto.randomUUID()

        /**
         * Identity comes from the session cookie alone. Nothing about who the
         * caller is or what they can see is ever read from the request body —
         * §12 forbids trusting client-sent scope.
         */
        // Build the Headers from Hono's own typed `header()` (a Record) rather
        // than `c.req.raw.headers`. Hono types `raw` as the ambient global
        // `Request`, whose `headers` property disappears in a compile that can't
        // resolve @types/node's fetch types (e.g. a stray `tsc` over this package
        // where `undici-types` isn't resolved) — see TS2339 on `Request.headers`.
        const authenticated = await auth.api.getSession({ headers: new Headers(c.req.header()) })

        if (!authenticated) {
          return { env, db, requestId, session: null }
        }

        /**
         * Scope is resolved once per request and carried on the context, so
         * every procedure filters against the same set and none of them can
         * forget to (§5.2).
         */
        const scope = await resolveVisibleAccounts(db, authenticated.user.id)

        const session: AuthenticatedSession = {
          userId: authenticated.user.id,
          email: authenticated.user.email,
          name: authenticated.user.name,
          roles: scope.roles,
          visibleAccountIds: scope.visibleAccountIds,
          canViewNetwork: scope.canViewNetwork,
        }

        return { env, db, requestId, session }
      },
    }),
  )

  return app
}

export type App = ReturnType<typeof createApp>
