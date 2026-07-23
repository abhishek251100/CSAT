import { getRequestListener } from '@hono/node-server'
import { createApp } from '@zoo/api'
import { parseServerEnv } from '@zoo/api/env'

/**
 * Source for the Vercel API function. This is NOT deployed directly — Vercel's
 * file tracer resolves `@zoo/api` to its raw `.ts` source, which Node cannot
 * load at runtime (ERR_MODULE_NOT_FOUND on app.ts). Instead `server/build.mjs`
 * esbuild-bundles this file into a single self-contained `handler.bundle.mjs`
 * (every workspace + npm dependency inlined), and the committed
 * `apps/web/api/index.js` re-exports that bundle. So the deployed function has
 * no workspace or `.ts` imports left to resolve.
 *
 * The Hono app is unchanged; `getRequestListener` adapts its Web `fetch` handler
 * to Vercel's Node `(req, res)` signature. Built once at module scope and reused
 * across warm invocations. Env comes from Vercel project settings via
 * `process.env`; a missing required var throws here at load, failing loudly.
 */
const app = createApp(parseServerEnv(process.env))

export default getRequestListener(app.fetch)
