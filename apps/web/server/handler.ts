import { createApp } from '@zoo/api'
import { parseServerEnv } from '@zoo/api/env'

/**
 * Source for the Vercel API function. This is NOT deployed directly — Vercel's
 * file tracer resolves `@zoo/api` to its raw `.ts` source, which Node cannot
 * load at runtime (ERR_MODULE_NOT_FOUND on app.ts). Instead `server/build.mjs`
 * esbuild-bundles this file into a single self-contained `handler.bundle.mjs`
 * (every workspace + npm dependency inlined), and `apps/web/api/index.js`
 * re-exports that bundle. So the deployed function has no workspace or `.ts`
 * imports left to resolve.
 *
 * Export shape matters on Vercel Node:
 *   - A single-arg `(request: Request) => Response` is the Web Handler form.
 *     Vercel builds a real Web `Request` with the POST body already attached.
 *   - `@hono/node-server`'s `getRequestListener` is the classic `(req, res)`
 *     form. GET works, but POST hangs forever on Vercel because the platform
 *     has already buffered `req.body` and the IncomingMessage stream never
 *     ends the way Node's http.Server would — that is the 504 on
 *     `/api/auth/sign-in/*`.
 *   - `hono/vercel`'s `handle()` is also a Web Handler, but exporting an
 *     explicit named async function is the clearest signal to the runtime.
 *
 * `vercel.json` rewrites `/api/*` onto this one function; Vercel keeps the
 * original request URL, so Hono still sees `/api/auth/*` and `/api/trpc/*`.
 *
 * Built once at module scope and reused across warm invocations. Env comes from
 * Vercel project settings via `process.env`; a missing required var throws here
 * at load, failing loudly.
 */
const app = createApp(parseServerEnv(process.env))

export default async function handler(request: Request): Promise<Response> {
  return app.fetch(request)
}
