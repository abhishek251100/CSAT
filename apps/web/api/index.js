// Vercel API function entry. The real handler is bundled into one
// self-contained file by `server/build.mjs` (run in the Vercel build command),
// so the deployed function has no workspace/`.ts` imports for Node to resolve.
// See server/handler.ts for why.
export { default } from '../server/handler.bundle.mjs'
