import { getRequestListener } from '@hono/node-server'
import { createApp } from '@zoo/api'
import { parseServerEnv } from '@zoo/api/env'

/**
 * Vercel serverless entry point for the API — the single-domain deploy.
 *
 * This is the host adapter the Node `server.ts` comment anticipated (§16 #6):
 * the Hono app itself is untouched, and only the way it is served changes. As a
 * catch-all under `/api`, Vercel routes every `/api/*` request here — auth, tRPC
 * and the status banner — while the static SPA build owns every other path.
 *
 * Env comes from the Vercel project settings via `process.env`; there is no
 * repo-root `.env` in the deployment, so — unlike `server.ts` — this never calls
 * `loadRootEnv`. A missing or invalid required variable throws here at module
 * load, failing every `/api` call loudly rather than starting half-configured.
 *
 * `getRequestListener` turns Hono's Web `fetch` handler into the Node
 * `(req, res)` signature Vercel's Node.js runtime invokes (the default runtime,
 * so no `config` export is needed). The app is built once at module scope so it
 * is reused across warm invocations.
 */
const app = createApp(parseServerEnv(process.env))

export default getRequestListener(app.fetch)
