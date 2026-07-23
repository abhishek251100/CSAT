import { defineConfig, devices } from '@playwright/test'

/**
 * E2E config — SPEC.md §12 (Playwright for E2E).
 *
 * Two servers, both test-only and isolated from `pnpm dev`:
 *  - the OAuth test API on :8799, running the real app over in-process Postgres
 *    with Google's token endpoint stubbed (e2e/support/oauth-test-server.mjs)
 *  - a Vite dev server on :5199 pointed at that API via VITE_API_URL
 *
 * Using dedicated ports means the suite never collides with a running dev
 * session and needs no Neon connection, so it runs in CI.
 */
const WEB_PORT = 5199
const API_PORT = 8799
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Runs in the @zoo/api package context so its deps (@hono/node-server,
      // drizzle, pglite, undici) resolve.
      command: 'pnpm --filter @zoo/api exec tsx e2e/oauth-test-server.ts',
      port: API_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        OAUTH_TEST_PORT: String(API_PORT),
        OAUTH_TEST_WEB_ORIGIN: WEB_ORIGIN,
      },
    },
    {
      command: `vite --port ${WEB_PORT} --strictPort`,
      port: WEB_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        VITE_API_URL: `http://localhost:${API_PORT}`,
      },
    },
  ],
})
