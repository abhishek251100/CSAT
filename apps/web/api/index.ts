import { getRequestListener } from '@hono/node-server'
import { createApp } from '@zoo/api'
import { parseServerEnv } from '@zoo/api/env'

/**
 * Vercel serverless entry point for the API — the single-domain deploy.
 *
 * This is the host adapter the Node `server.ts` comment anticipated (§16 #6):
 * the Hono app itself is untouched, and only the way it is served changes. The
 * function lives at `/api`; `vercel.json` rewrites every `/api/*` path here
 * (Vercel's file-based catch-all only matched one segment, so tRPC and auth
 * paths 404'd — an explicit rewrite is reliable at any depth). Vercel preserves
 * the original request path, so Hono routes `/api/auth/*`, `/api/trpc/*` and the
 * `/api` banner internally. The static SPA build owns every other path.
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
