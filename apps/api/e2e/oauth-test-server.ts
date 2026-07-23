import { serve } from '@hono/node-server'
import { PGlite } from '@electric-sql/pglite'
import { accounts, agencies, authSessions, networks, users } from '@zoo/db/schema'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { createApp } from '../src/app'
import { parseServerEnv } from '../src/env'

/**
 * E2E harness for the OAuth domain gate — SPEC.md §16 #4.
 *
 * Runs the REAL app (`createApp`, unmodified) against an in-process PGlite
 * database, and stubs exactly one thing: Google's token endpoint. In the OAuth
 * callback path better-auth calls `validateAuthorizationCode` (the token
 * exchange — the one server->Google call) and then `getUserInfo`, which
 * *decodes* the returned id_token locally. So stubbing the token endpoint to
 * return an id_token carrying an arbitrary email is enough to inject any
 * identity; the domain gate then runs exactly as it does in production.
 *
 * The browser side of the stub (redirecting the consent screen back to the
 * callback) is done by Playwright in the spec. Nothing here or there touches
 * production auth code.
 *
 * A test harness, not shipped code — it may add test-only routes the real app
 * never has, and it lives outside `src` so the app's build never includes it.
 */

const PORT = Number(process.env.OAUTH_TEST_PORT ?? 8799)

/** An UNSIGNED JWT. The callback path decodes, never verifies, the id_token. */
function unsignedIdToken(email: string): string {
  const encode = (object: unknown) =>
    Buffer.from(JSON.stringify(object)).toString('base64url').replace(/=+$/, '')

  const header = encode({ alg: 'none', typ: 'JWT' })
  const payload = encode({
    iss: 'https://accounts.google.com',
    aud: '000000000000-testclient.apps.googleusercontent.com',
    sub: `sub-${email}`,
    email,
    email_verified: true,
    name: email.split('@')[0],
    picture: 'https://example.invalid/avatar.png',
    iat: 1_700_000_000,
    exp: 1_900_000_000,
  })

  // Trailing dot: an unsecured JWT has an empty signature segment.
  return `${header}.${payload}.`
}

/**
 * Intercept Google's token endpoint by patching `globalThis.fetch`.
 *
 * better-auth's `betterFetch` calls the global fetch, so patching it here is
 * what actually intercepts the token exchange. undici's MockAgent does NOT work
 * for this: Node's built-in `fetch` uses Node's own bundled undici, a different
 * copy from the `undici` npm package, so `setGlobalDispatcher` from that package
 * has no effect and the request escapes to the real Google (which answers
 * `invalid_client`). Every non-token request is delegated to the real fetch.
 *
 * The authorization `code` the browser was handed IS the email to inject, so it
 * is read from the request body and an id_token minted for that address.
 */
function installGoogleTokenStub(): void {
  const TOKEN_URL = 'https://oauth2.googleapis.com/token'
  const realFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

    if (!url.startsWith(TOKEN_URL)) return realFetch(input, init)

    // betterFetch sends the token request body as a URLSearchParams object, not
    // a string, so both must be handled — reading only the string form silently
    // injects a fallback email and makes every identity look off-domain.
    const raw = init?.body
    const bodyString =
      typeof raw === 'string' ? raw : raw instanceof URLSearchParams ? raw.toString() : ''
    const email = new URLSearchParams(bodyString).get('code') ?? 'unknown@example.invalid'
    console.log(`[oauth-test-server] token exchange for code="${email}"`)

    return new Response(
      JSON.stringify({
        access_token: `access-${email}`,
        id_token: unsignedIdToken(email),
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid email profile',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
}

async function main() {
  installGoogleTokenStub()

  const client = new PGlite()
  const db = drizzle(client)
  await migrate(db, {
    migrationsFolder: fileURLToPath(new NodeURL('../../../packages/db/drizzle', import.meta.url)),
  })

  const [network] = await db
    .insert(networks)
    .values({ name: 'Zoo Media', slug: 'zoo-media' })
    .returning()
  const [agency] = await db
    .insert(agencies)
    .values({ networkId: network!.id, name: 'The Starter Labs', slug: 'tsl' })
    .returning()
  await db.insert(accounts).values({ agencyId: agency!.id, name: 'Mogu Mogu', slug: 'mogu-mogu' })

  const env = parseServerEnv({
    NODE_ENV: 'test',
    PORT: String(PORT),
    DATABASE_URL: 'postgresql://unused:unused@localhost/unused',
    BETTER_AUTH_SECRET: 'e2e-oauth-secret-at-least-32-characters',
    BETTER_AUTH_URL: `http://localhost:${PORT}`,
    WEB_ORIGIN: process.env.OAUTH_TEST_WEB_ORIGIN ?? 'http://localhost:5199',
    GOOGLE_CLIENT_ID: '000000000000-testclient.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-google-secret',
    ALLOWED_EMAIL_DOMAINS: 'thestarterlabs.com,zoomedia.com',
    SUPERADMIN_EMAIL: 'breakglass@offlist.example',
    SUPERADMIN_PASSWORD: 'break-glass-password-e2e',
  })

  // PGlite is a Postgres-dialect Drizzle client; createApp accepts any AppDb.
  const app = createApp(env, db as unknown as Parameters<typeof createApp>[1])

  /**
   * Test-only introspection, so the Playwright process can assert on server
   * state it otherwise cannot see (the DB lives in THIS process). Never part of
   * createApp.
   */
  app.get('/__test__/session-count', async (c) => {
    const email = (c.req.query('email') ?? '').toLowerCase()
    const [userRow] = await db.select().from(users).where(eq(users.email, email))

    const sessions = userRow
      ? await db.select().from(authSessions).where(eq(authSessions.userId, userRow.id))
      : []

    return c.json({ userExists: Boolean(userRow), sessionCount: sessions.length })
  })

  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`[oauth-test-server] listening on http://localhost:${PORT}`)
  })
}

main().catch((error: unknown) => {
  console.error('[oauth-test-server] failed:', error)
  process.exit(1)
})
