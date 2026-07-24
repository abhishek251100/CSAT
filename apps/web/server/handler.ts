import { handle } from 'hono/vercel'
import { createApp } from '@zoo/api'
import { parseServerEnv } from '@zoo/api/env'

/**
 * Source for the Vercel API function. This is NOT deployed directly — Vercel's
 * file tracer resolves `@zoo/api` to its raw `.ts` source, which Node cannot
 * load at runtime (ERR_MODULE_NOT_FOUND on app.ts). Instead `server/build.mjs`
 * esbuild-bundles this file into a single self-contained `handler.bundle.mjs`
 * (every workspace + npm dependency inlined), and `apps/web/api/[[...route]].js`
 * re-exports that bundle. So the deployed function has no workspace or `.ts`
 * imports left to resolve.
 *
 * Uses Hono's Vercel adapter (`handle`) which accepts the Web `Request` Vercel
 * passes through. Paired with the filesystem catch-all `api/[[...route]].js`,
 * the original path (`/api/auth/callback/google`, `/api/trpc/...`) is preserved
 * for Hono routing — unlike rewriting every `/api/*` onto a bare `/api` entry.
 *
 * Built once at module scope and reused across warm invocations. Env comes from
 * Vercel project settings via `process.env`; a missing required var throws here
 * at load, failing loudly.
 */
const app = createApp(parseServerEnv(process.env))

export default handle(app)
