import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Bundles the Vercel API function into ONE self-contained ESM file.
 *
 * Vercel's default tracer leaves `@zoo/api` (and its workspace deps) as external
 * imports pointing at `.ts` source, which Node cannot load at runtime. Inlining
 * every dependency here removes all runtime module resolution: the deployed
 * `api/index.js` re-exports this bundle and nothing else is looked up.
 *
 * `platform: node` keeps Node built-ins external; the banner shims `require`,
 * `__dirname` and `__filename` for any bundled CommonJS dependency that expects
 * them in the ESM output.
 */
const here = dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [resolve(here, 'handler.ts')],
  outfile: resolve(here, 'handler.bundle.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'info',
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __pathDirname } from 'node:path';",
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __pathDirname(__filename);',
    ].join('\n'),
  },
})

console.log('[build-api] bundled server/handler.ts -> server/handler.bundle.mjs')
