import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

/**
 * On Vercel (or any production build), a loopback VITE_API_URL must never be
 * inlined. That var is build-time: if someone pastes the local .env into Vercel
 * (`http://localhost:8787`), the SPA calls a machine that does not exist and
 * every sign-in shows "Could not reach the API". Same-origin (empty string) is
 * the single-domain contract — see DEPLOY.md.
 */
function sanitizeApiUrlForBuild(mode: string, env: Record<string, string>) {
  const raw = (env.VITE_API_URL ?? '').trim()
  const onVercel = process.env.VERCEL === '1'
  const isProdBuild = mode === 'production'
  const isLoopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(raw)

  if ((onVercel || isProdBuild) && isLoopback) {
    console.warn(
      `[vite] Clearing VITE_API_URL=${JSON.stringify(raw)} for ${onVercel ? 'Vercel' : 'production'} build — using same-origin /api`,
    )
    process.env.VITE_API_URL = ''
    return
  }

  if (raw !== (env.VITE_API_URL ?? '')) {
    process.env.VITE_API_URL = raw
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), '')
  sanitizeApiUrlForBuild(mode, { ...env, ...process.env })

  return {
    plugins: [
      // Must precede the react plugin: it generates routeTree.gen.ts from src/routes.
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      /**
       * Fail if 5173 is taken rather than silently moving to 5174.
       *
       * A moved web port is a broken app, not a working one: VITE_API_URL and the
       * API's CORS allowlist are both pinned to the 5173 origin, so a fallback
       * port loads a page that cannot talk to the API and shows "Could not reach
       * the API". Failing loudly points at the real problem — a stale dev server
       * still holding the port — instead of hiding it.
       */
      strictPort: true,
    },
  }
})
