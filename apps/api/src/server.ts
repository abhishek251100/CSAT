import { serve } from '@hono/node-server'
import { loadRootEnv } from '@zoo/db'
import { createApp } from './app'
import { googleDisabledWarning, resolveGoogleConfig } from './auth/google-config'
import { parseServerEnv } from './env'

/**
 * Node entry point — the only file that assumes a Node runtime.
 *
 * Swapping hosts (Section 16 #6) means replacing this file, not the app:
 *   - Vercel functions: export the Hono app's fetch handler.
 *   - Cloudflare Workers: `export default { fetch, scheduled }`, passing the
 *     Workers bindings object to `parseServerEnv` instead of `process.env`.
 */
/**
 * Load the repo-root .env into process.env before validating it.
 *
 * This is the Node entry's job, not `parseServerEnv`'s: that function takes its
 * source as an argument precisely so it stays host-portable, and a Workers
 * entry would hand it bindings instead. Without this line the server only ever
 * sees variables exported in the shell.
 */
loadRootEnv(import.meta.url)

const env = parseServerEnv(process.env)
const app = createApp(env)

const google = resolveGoogleConfig(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET)

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`)
  console.log(`[api] tRPC endpoint at http://localhost:${info.port}/api/trpc`)
  console.log(`[api] CORS origins allowed: ${env.WEB_ORIGIN.join(', ')}`)
  console.log(`[api] sign-in domains: ${env.ALLOWED_EMAIL_DOMAINS.join(', ')}`)

  if (google.enabled) {
    console.log(`[api] Google sign-in enabled`)
  } else {
    // Loud, but not fatal: break-glass still works, so nobody is locked out.
    console.warn(
      googleDisabledWarning(google.problem, `${env.BETTER_AUTH_URL}/api/auth/callback/google`),
    )
  }
})

/**
 * Turn the raw EADDRINUSE stack trace into one actionable line.
 *
 * It happens whenever a previous `dev` process is still holding the port —
 * usually because two `dev` commands were started, or an earlier one did not
 * exit. The default is a multi-frame Node stack that buries the cause; this
 * says what to do instead.
 */
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `\n[api] Port ${env.PORT} is already in use.\n` +
        '[api] Another API process is still running — you do not need a second one.\n' +
        `[api] Stop it, or free the port:  npx kill-port ${env.PORT}\n`,
    )
    process.exit(1)
  }

  throw error
})
