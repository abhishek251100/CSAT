import { defineConfig } from 'vitest/config'

/**
 * These suites run against an in-process Postgres (PGlite). Seeding the demo
 * dataset and the rollup fixtures does hundreds of real inserts, which can
 * exceed vitest's 5s default when the whole suite competes for CPU. Give
 * DB-backed tests and their hooks room without masking genuine hangs.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
