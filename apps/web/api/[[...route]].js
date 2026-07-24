// Vercel catch-all API entry. Routes every `/api` and `/api/**` path (any depth,
// dots included) to one serverless function while preserving the original URL
// for Hono. The real handler is bundled into one self-contained file by
// `server/build.mjs` (run in the Vercel build command), so the deployed function
// has no workspace/`.ts` imports for Node to resolve. See server/handler.ts.
export { default } from '../server/handler.bundle.mjs'
