// Vercel API function entry. A single `api/index.js` plus the
// `/api/(.*) -> /api` rewrite in vercel.json routes every `/api/**` path to
// this function. The real handler is bundled into one self-contained file by
// `server/build.mjs` (run in the Vercel build command), so the deployed
// function has no workspace/`.ts` imports for Node to resolve.
// See server/handler.ts for why.
export { default } from '../server/handler.bundle.mjs'
