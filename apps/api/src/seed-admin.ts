import { createDb, loadRootEnv } from '@zoo/db'
import { createAuth } from './auth/auth'
import { seedBreakGlassAdmin } from './auth/seed-admin'
import { parseServerEnv } from './env'

/**
 * CLI wrapper for the break-glass admin seed (SPEC.md §16 #4).
 *
 * Run with:  pnpm --filter @zoo/api auth:seed-admin
 * Rotate:    pnpm --filter @zoo/api auth:seed-admin -- --rotate-password
 *
 * Requires the org seed to have run first, since the super_admin membership is
 * granted at network tier.
 */

loadRootEnv(import.meta.url)

async function main() {
  const env = parseServerEnv(process.env)
  const db = createDb(env.DATABASE_URL)
  const auth = createAuth(db, env, env.WEB_ORIGIN)

  const result = await seedBreakGlassAdmin(db, auth, {
    email: env.SUPERADMIN_EMAIL,
    password: env.SUPERADMIN_PASSWORD,
    rotatePassword: process.argv.includes('--rotate-password'),
  })

  console.log(`[admin] ${result.created ? 'created' : 'already present'}: ${env.SUPERADMIN_EMAIL}`)
  console.log(`[admin] super_admin membership: ${result.membershipGranted ? 'granted' : 'ok'}`)

  if (result.passwordRotated) {
    console.log('[admin] password rotated from SUPERADMIN_PASSWORD')
  } else if (!result.created) {
    console.log('[admin] password left unchanged — pass --rotate-password to reset it')
  }
}

/**
 * Sets exitCode rather than calling process.exit(), so the Neon driver's HTTP
 * handles can drain. A hard exit trips a libuv assertion on Windows.
 */
main().catch((error: unknown) => {
  console.error('[admin] failed:', error)
  process.exitCode = 1
})
